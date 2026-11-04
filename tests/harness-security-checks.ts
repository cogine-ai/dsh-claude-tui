/** Bounded malicious inputs and legitimate controls through the installed DSH owners. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { gzipSync } from 'node:zlib'
import { verifyUndiciAsyncSurvival, verifyUndiciParserBounds } from './undici-security-variants.ts'

function harnessRequire(packageJsonPath: string): NodeRequire {
  const consumer = createRequire(packageJsonPath)
  return createRequire(consumer.resolve('@deepseek-ai/dsh/package.json'))
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  server.closeAllConnections()
  await stopped
}

/** Oversized durable checkpoint chunks must fail before per-element allocation. */
export async function verifyZodSecurity(packageJsonPath: string): Promise<void> {
  const dsh = harnessRequire(packageJsonPath)
  const agent = createRequire(dsh.resolve('@deepseek-ai/dsh-agent/package.json'))
  const chunked = createRequire(agent.resolve('@deepseek-ai/dsh-chunked-list/package.json'))
  const z = (chunked('zod') as typeof import('zod')).z
  const { chunkedListSchema } = await import(pathToFileURL(chunked.resolve('@deepseek-ai/dsh-chunked-list')).href) as {
    chunkedListSchema: (element: import('zod').ZodType) => import('zod').ZodType
  }
  let visits = 0
  const element = z.any().superRefine((_value, context) => {
    visits++
    context.addIssue({ code: 'custom', message: 'bounded invalid fixture element' })
  })
  const oversized = chunkedListSchema(element).safeParse({ values: Array(1000).fill('invalid') })
  assert.equal(oversized.success, false)
  assert.equal(visits, 0, 'Oversized DSH checkpoint must reject before walking its elements')
  assert.equal(oversized.error!.issues.length, 1)
  assert.equal(oversized.error!.issues[0]?.code, 'too_big')
  const checkpoint = chunkedListSchema(z.string())
  assert.equal(checkpoint.safeParse({ values: Array(64).fill('valid') }).success, true)
  assert.equal(checkpoint.safeParse({ values: [] }).success, false)
  assert.equal(checkpoint.safeParse({ values: ['valid', 1] }).success, false)

  for (const jitless of [false, true]) {
    const object = z.object({ values: z.array(element).max(2) })
    assert.equal(object.safeParse({ values: [1, 2, 3] }, { jitless }).success, false)
    assert.equal(visits, 0, 'Compiled and interpreter array paths must both enforce leading bounds')
  }
  for (const [schema, value] of [
    [z.set(element).max(2), new Set([1, 2, 3])],
    [z.map(element, element).max(2), new Map([[1, 1], [2, 2], [3, 3]])],
  ] as const) {
    assert.equal(schema.safeParse(value).success, false)
    assert.equal(visits, 0, 'Alternate constrained collections must reject before element parsing')
  }
  assert.deepEqual(z.array(z.number()).overwrite(values => values.slice(0, 2)).max(2).parse([1, 2, 3]), [1, 2])
  assert.equal(chunked('zod/package.json').version, '4.6.6')
}

/** A hostile coding chain must reject without an orphaned stream killing its process. */
export async function verifyEncodingSurvival(ownerPath: string, url: string): Promise<void> {
  const worker = new Worker(`
    const { createRequire } = require('node:module')
    const { parentPort, workerData } = require('node:worker_threads')
    const { fetch, Agent } = createRequire(workerData.ownerPath)('undici')
    const agent = new Agent()
    ;(async () => {
      try {
        let rejected = false
        try { await (await fetch(workerData.url + '/encodings', { dispatcher: agent, signal: AbortSignal.timeout(5000) })).text() }
        catch { rejected = true }
        await new Promise(resolve => setTimeout(resolve, 100))
        const control = await (await fetch(workerData.url + '/body', { dispatcher: agent, signal: AbortSignal.timeout(5000) })).text()
        parentPort.postMessage({ rejected, control })
      } finally { await agent.close() }
    })().catch(error => { throw error })
  `, { eval: true, workerData: { ownerPath, url }, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 } })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<{ rejected: boolean; control: string }>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('undici encoding regression timed out')), 8000)
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`undici worker exited without a result (${code})`)))
    })
    assert.deepEqual(result, { rejected: true, control: 'safe fixture body' })
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}

/** Exercise both dependency owners, not a root copy that might mask an older library. */
export async function verifyUndiciSecurity(packageJsonPath: string): Promise<void> {
  const dsh = harnessRequire(packageJsonPath)
  const body = 'safe fixture body'
  const server = createServer((request, response) => {
    if (request.url === '/compressed') {
      response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('x'.repeat(4096)))
      return
    }
    if (request.url === '/encodings') {
      response.writeHead(200, { 'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip', 'content-length': '100' })
      response.flushHeaders()
      response.socket!.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/plain' }).end(body)
  })
  const url = await listen(server)
  try {
    for (const name of ['@deepseek-ai/dsh-http-proxy', '@deepseek-ai/dsh-web-fetch-http']) {
      const ownerPath = dsh.resolve(`${name}/package.json`)
      const owner = createRequire(ownerPath)
      const undici = owner('undici') as typeof import('undici')
      const dispatcher = new undici.Agent()
      try {
        for (const algorithm of ['sha256', 'SHA256', 'Sha256', 'SHA384', 'sHa512']) {
          const correct = createHash(algorithm.toLowerCase()).update(body).digest('base64')
          const wrong = createHash(algorithm.toLowerCase()).update('different body').digest('base64')
          assert.equal(await (await undici.fetch(`${url}/body`, {
            dispatcher, integrity: `${algorithm}-${correct}`, signal: AbortSignal.timeout(5000),
          })).text(), body)
          await assert.rejects(undici.fetch(`${url}/body`, {
            dispatcher, integrity: `${algorithm}-${wrong}`, signal: AbortSignal.timeout(5000),
          }), /fetch failed|integrity/)
        }
      } finally { await dispatcher.close() }
      await verifyEncodingSurvival(ownerPath, url)
      await verifyUndiciAsyncSurvival(ownerPath, url)
      await verifyUndiciParserBounds(ownerPath)
      await verifyTlsPin(undici)
      await verifyRedirectCache(undici)
      assert.equal(owner('undici/package.json').version, '8.12.2')
    }
  } finally { await close(server) }
}

export async function verifyTlsPin(undici: typeof import('undici')): Promise<void> {
  const cert = readFileSync(fileURLToPath(new URL('./fixtures/tls/localhost-cert.pem', import.meta.url)), 'utf8')
  const key = readFileSync(fileURLToPath(new URL('./fixtures/tls/localhost-key.pem', import.meta.url)), 'utf8')
  const server = createTlsServer({ cert, key }, (_request, response) => response.end('TLS control'))
  const httpUrl = await listen(server)
  const url = httpUrl.replace('http:', 'https:')
  let checks = 0
  // tls is a legacy JavaScript option (excluded by current typings), and is the audited path.
  const legacyAgent = (options: unknown): import('undici').Agent => Reflect.construct(undici.Agent, [options])
  const allowed = legacyAgent({ tls: { ca: cert } })
  const pinned = legacyAgent({ tls: {
    ca: cert,
    checkServerIdentity: () => { checks++; return new Error('fixture certificate pin rejected') },
  } })
  try {
    assert.equal(await (await undici.fetch(url, { dispatcher: allowed, signal: AbortSignal.timeout(5000) })).text(), 'TLS control')
    await assert.rejects(undici.fetch(url, { dispatcher: pinned, signal: AbortSignal.timeout(5000) }), error => {
      return error instanceof Error && error.cause instanceof Error && error.cause.message.includes('fixture certificate pin rejected')
    })
    assert(checks > 0, 'Agent must preserve the custom TLS verification function')
  } finally {
    await Promise.all([allowed.close(), pinned.close()])
    await close(server)
  }
}

export async function verifyRedirectCache(undici: typeof import('undici')): Promise<void> {
  let sourceRequests = 0
  let targetRequests = 0
  let sameRequests = 0
  let privateRequests = 0
  const target = createServer((request, response) => {
    if (request.url === '/secret' || request.url === '/public') {
      response.writeHead(200, { 'cache-control': 'public, max-age=3600' }).end(request.url.slice(1))
      return
    }
    targetRequests++
    response.writeHead(200, { 'cache-control': 'public, max-age=3600' }).end(`target ${targetRequests}`)
  })
  const targetUrl = await listen(target)
  const source = createServer((request, response) => {
    if (request.url === '/cross') {
      sourceRequests++
      response.writeHead(302, { location: `${targetUrl}/body` }).end()
    } else if (request.url === '/private') {
      privateRequests++
      const location = request.headers['x-fixture-auth'] ? '/secret' : '/public'
      response.writeHead(302, { location: `${targetUrl}${location}`, 'cache-control': 'private, no-store' }).end()
    } else {
      sameRequests++
      response.writeHead(200, { 'cache-control': 'public, max-age=3600' }).end('same-origin cache control')
    }
  })
  const sourceUrl = await listen(source)
  const dispatcher = new undici.Agent().compose(
    undici.interceptors.redirect({ maxRedirections: 3 }),
    undici.interceptors.cache({ store: new undici.cacheStores.MemoryCacheStore(), type: 'shared' }),
  )
  try {
    const fetchText = async (path: string) => (await undici.request(`${sourceUrl}${path}`, {
      dispatcher, signal: AbortSignal.timeout(5000),
    })).body.text()
    assert.equal(await fetchText('/cross'), 'target 1')
    assert.match(await fetchText('/cross'), /^target [12]$/)
    assert.equal(sourceRequests, 2, 'A cross-origin response must not be cached under the source URL')
    assert.equal(await fetchText('/same'), 'same-origin cache control')
    assert.equal(await fetchText('/same'), 'same-origin cache control')
    assert.equal(sameRequests, 1, 'Ordinary same-origin caching must remain usable')
    const authorized = await undici.request(`${sourceUrl}/private`, {
      dispatcher, headers: { 'x-fixture-auth': 'local-fixture' }, signal: AbortSignal.timeout(5000),
    })
    assert.equal(await authorized.body.text(), 'secret')
    assert.equal(await fetchText('/private'), 'public', 'A private redirect hop must not disclose its cached target to another caller')
    assert.equal(privateRequests, 2)
  } finally {
    await dispatcher.close()
    await Promise.all([close(source), close(target)])
  }
}
