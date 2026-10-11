/** Exercise security fixes through the dependency owners in a given installation. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { gte } from 'semver'

type DependencyRequire = ReturnType<typeof createRequire>

interface ZipLibrary {
  zipSync(files: Record<string, Uint8Array>): Uint8Array
  unzipSync(bytes: Uint8Array): Record<string, Uint8Array>
  strToU8(value: string): Uint8Array
  strFromU8(value: Uint8Array): string
}

interface UriResolver {
  parse(value: string): { scheme?: string; host?: string; path?: string }
  normalize(value: string): string
  equal(left: string, right: string): boolean
}

interface AjvInstance {
  opts: { uriResolver: UriResolver }
  compile(schema: Record<string, unknown>): (value: unknown) => boolean
}

interface Zip64Result {
  rejected: boolean
  code?: number
}

function assertDependencyVersion(owner: DependencyRequire, name: string, expected: string): void {
  const manifestPath = owner.resolve(`${name}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string }
  assert.equal(manifest.version, expected, `${manifestPath} must resolve the reviewed version`)
}

function assertNativeVersion(versions: Record<string, string | undefined>, name: string, minimum: string): void {
  const version = versions[name]
  assert.ok(version, `Sharp must expose its actual ${name} native library version`)
  assert.ok(gte(version, minimum), `Sharp ${name} ${version} must be at least ${minimum}`)
}

async function verifySharp(attachmentRequire: DependencyRequire): Promise<void> {
  const sharp = attachmentRequire('sharp') as typeof import('sharp').default
  assert.equal(sharp.versions.sharp, '0.35.5')
  // Sharp names these loaded libraries heif/rsvg, rather than libheif/librsvg.
  // https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c
  // https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w
  assertNativeVersion(sharp.versions, 'heif', '1.23.2')
  assertNativeVersion(sharp.versions, 'rsvg', '2.63.2')

  const input = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
    raw: { width: 2, height: 1, channels: 3 },
  }).png().toBuffer()
  const resized = await sharp(input).resize(4, 2, { kernel: 'nearest' }).png().toBuffer()
  const metadata = await sharp(resized).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 4)
  assert.equal(metadata.height, 2)
  const pixels = await sharp(resized).removeAlpha().raw().toBuffer()
  assert.deepEqual([...pixels.subarray(0, 3)], [255, 0, 0])
  assert.deepEqual([...pixels.subarray(9, 12)], [0, 0, 255])

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">'
    + '<rect width="2" height="2" fill="#0080ff"/></svg>',
  )
  const rendered = await sharp(svg).png().toBuffer()
  const decoded = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(decoded.info.width, 2)
  assert.equal(decoded.info.height, 2)
  assert.deepEqual([...decoded.data.subarray(0, 4)], [0, 128, 255, 255])
}

/** Add valid ZIP64 directory records, but omit the first entry's required ZIP64 extra field. */
function missingZip64Extra(archive: Uint8Array): Buffer {
  const original = Buffer.from(archive)
  const endOffset = original.length - 22
  assert.equal(original.readUInt32LE(endOffset), 0x06054b50)
  assert.equal(original.readUInt16LE(endOffset + 20), 0)
  const centralOffset = original.readUInt32LE(endOffset + 16)
  assert.equal(original.readUInt32LE(centralOffset), 0x02014b50)
  assert.equal(original.readUInt16LE(centralOffset + 30), 0)

  const body = Buffer.from(original.subarray(0, endOffset))
  // The size sentinel requires tag 0x0001; fflate 0.8.2 loops when that tag is absent.
  body.writeUInt32LE(0xffffffff, centralOffset + 20)
  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  const entries = BigInt(original.readUInt16LE(endOffset + 10))
  zip64End.writeBigUInt64LE(entries, 24)
  zip64End.writeBigUInt64LE(entries, 32)
  zip64End.writeBigUInt64LE(BigInt(original.readUInt32LE(endOffset + 12)), 40)
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(body.length), 8)
  locator.writeUInt32LE(1, 16)
  const end = Buffer.from(original.subarray(endOffset))
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([body, zip64End, locator, end])
}

async function verifyZip64Rejection(ownerPath: string, archive: Uint8Array): Promise<void> {
  const worker = new Worker(`
    const { createRequire } = require('node:module')
    const { parentPort, workerData } = require('node:worker_threads')
    const { unzipSync } = createRequire(workerData.ownerPath)('fflate')
    try {
      unzipSync(workerData.archive, { filter: entry => entry.name === 'word/document.xml' })
      parentPort.postMessage({ rejected: false })
    } catch (error) {
      parentPort.postMessage({ rejected: true, code: error.code })
    }
  `, {
    eval: true,
    workerData: { ownerPath, archive },
    env: {},
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 32 },
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<Zip64Result>((resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`ZIP64 parsing did not reject within 5 seconds: ${ownerPath}`))
      }, 5_000)
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`ZIP64 worker exited without a result (${code})`)))
    })
    assert.equal(result.rejected, true, 'Missing ZIP64 extra fields must be rejected')
    assert.equal(result.code, 13, 'fflate must report InvalidZipData')
  } finally {
    clearTimeout(timeout)
    await worker.terminate()
  }
}

async function verifyOfficeZip(kitPath: string): Promise<void> {
  const kitRequire = createRequire(kitPath)
  assertDependencyVersion(kitRequire, 'fflate', '0.8.3')
  const zip = kitRequire('fflate') as ZipLibrary
  const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
    + 'package/2006/content-types"><Override PartName="/word/document.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  const document = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
    + 'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>security regression</w:t>'
    + '</w:r></w:p></w:body></w:document>'
  const files = {
    '[Content_Types].xml': zip.strToU8(contentTypes),
    'word/document.xml': zip.strToU8(document),
  }
  const archive = zip.zipSync(files)
  const extracted = zip.unzipSync(archive)
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(files).sort())
  assert.equal(zip.strFromU8(extracted['[Content_Types].xml']!), contentTypes)
  assert.equal(zip.strFromU8(extracted['word/document.xml']!), document)
  // https://github.com/advisories/GHSA-px8p-9vwx-vf98
  await verifyZip64Rejection(kitPath, missingZip64Extra(archive))
}

function verifyFastUri(appBootRequire: DependencyRequire): void {
  const ajvPath = appBootRequire.resolve('ajv/package.json')
  const ajvRequire = createRequire(ajvPath)
  assertDependencyVersion(ajvRequire, 'fast-uri', '3.1.8')
  const fastUri = ajvRequire('fast-uri') as UriResolver
  const Ajv = appBootRequire('ajv') as new () => AjvInstance
  const ajv = new Ajv()
  assert.equal(ajv.opts.uriResolver, fastUri, 'AJV must use the reviewed fast-uri resolver')
  // Official regression from GHSA-hrr3-gc8f-f4qj: %41 must be decoded before host case folding.
  // https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj
  for (const reference of ['//%41.com', '//A.com', '//a.com']) {
    assert.equal(ajv.opts.uriResolver.parse(reference).host, 'a.com')
    assert.equal(ajv.opts.uriResolver.normalize(reference), '//a.com')
    assert.equal(ajv.opts.uriResolver.equal(reference, '//a.com'), true)
  }
  assert.equal(fastUri.normalize('HTTPS://EXAMPLE.COM:443/a/../b?x=1#fragment'),
    'https://example.com/b?x=1#fragment')
  const validate = ajv.compile({
    type: 'object',
    properties: { value: { $ref: '#/definitions/positive' } },
    required: ['value'],
    definitions: { positive: { type: 'integer', minimum: 1 } },
  })
  assert.equal(validate({ value: 1 }), true)
  assert.equal(validate({ value: 0 }), false)
}

/** Verify both the workspace and a final packed installation without starting DSH services. */
export async function verifySecurityDependencies(packageJsonPath: string): Promise<void> {
  const installedRequire = createRequire(packageJsonPath)
  const dshRequire = createRequire(installedRequire.resolve('@deepseek-ai/dsh/package.json'))
  const attachmentRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-attachment-local/package.json'))
  const skillRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-skill-office/package.json'))
  const appBootRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-app-boot/package.json'))
  await verifySharp(attachmentRequire)
  await verifyOfficeZip(skillRequire.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  verifyFastUri(appBootRequire)
}
