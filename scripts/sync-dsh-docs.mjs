#!/usr/bin/env node
/** Mirror official documentation from the release pinned by package.json. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repository = 'https://github.com/deepseek-ai/deepseek-harness'
const website = 'https://deepseek-harness.github.io/deepseek-harness/'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotPath = 'docs/upstream/dsh/snapshot'
const metadataFiles = new Set(['MANIFEST.json', 'INDEX.md'])

/** Include bilingual guides, catalogs, package READMEs, and their license notices. */
export function isOfficialDocument(path) {
  if (path.startsWith('.') || ['AGENTS.md', 'CLAUDE.md'].includes(basename(path))) return false
  if (path.startsWith('docs/')) return true
  if (['LICENSE', 'THIRD_PARTY_NOTICES.md', 'apps/cli/composition.md'].includes(path)) return true
  if (!path.includes('/')) return /^(README|SAFETY|CONTRIBUTING|BRAND_GUIDELINES)(\.[\w-]+)*\.(md|yaml)$/.test(path)
  return /^(apps|packages|python|native|vendor)\//.test(path)
    && /^(README(?:\.[\w-]+)*\.(md|yaml)|LICENSE(?:\.[\w-]+)?)$/.test(basename(path))
}

function git(source, args, input) {
  return execFileSync('git', ['-C', source, ...args], {
    input, maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
  })
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function walk(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`Documentation mirror contains a symlink: ${path}`)
    return entry.isDirectory() ? walk(root, path) : [path]
  }).sort()
}

function pinnedVersion(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = manifest.dependencies?.['@deepseek-ai/dsh']
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    throw new Error('package.json must pin an exact @deepseek-ai/dsh version')
  }
  return version
}

function catalog(manifest) {
  const lines = [
    '# Official DSH documentation index / 官方文档索引', '',
    `Release: [${manifest.ref}](${repository}/releases/tag/${manifest.ref}) · Commit: \`${manifest.commit}\``, '',
    'These files are unmodified upstream copies. Links to source code, Agent Notes, or remote media may require the upstream page. Every document below has a pinned upstream link.', '',
    '以下文件保留上游原文。源码、Agent Notes 和远程媒体不属于离线镜像；原文涉及这些内容时，可使用每篇文档旁的固定版本上游链接。', '',
  ]
  let group
  for (const path of Object.keys(manifest.files).filter(path => path.endsWith('.md'))) {
    const nextGroup = path.includes('/') ? path.split('/')[0] : 'Overview / 总览'
    if (nextGroup !== group) {
      group = nextGroup
      lines.push(`## ${group}`, '')
    }
    lines.push(`- [${path}](./${path}) · [upstream / 上游](${repository}/blob/${manifest.commit}/${path})`)
  }
  return `${lines.join('\n')}\n`
}

/** Check every managed byte without network access or rewriting local edits. */
export function checkSnapshot(root = projectRoot, {
  matchRuntime = true, snapshotDirectory = join(root, snapshotPath),
} = {}) {
  const target = snapshotDirectory
  if (lstatSync(target).isSymbolicLink()) throw new Error('Documentation snapshot must not be a symlink')
  const manifest = JSON.parse(readFileSync(join(target, 'MANIFEST.json'), 'utf8'))
  if (manifest.format !== 1 || manifest.repository !== repository || !/^[a-f\d]{40}$/.test(manifest.commit)) {
    throw new Error('Invalid official documentation manifest')
  }
  if (manifest.ref !== `dsh-v${manifest.harnessVersion}`) throw new Error('Documentation tag/version mismatch')
  if (matchRuntime && manifest.harnessVersion !== pinnedVersion(root)) {
    throw new Error('Documentation version differs from @deepseek-ai/dsh; run pnpm docs:dsh:sync')
  }
  const paths = Object.keys(manifest.files)
  const expected = [...paths, ...metadataFiles].sort()
  if (JSON.stringify(walk(target)) !== JSON.stringify(expected)) {
    throw new Error('Documentation files are missing or untracked; preserve local work before syncing')
  }
  for (const path of paths) {
    if (path.startsWith('/') || path.split('/').includes('..') || !isOfficialDocument(path)) {
      throw new Error(`Invalid documentation path: ${path}`)
    }
    const bytes = readFileSync(join(target, path))
    const entry = manifest.files[path]
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes || blob !== entry.blob) {
      throw new Error(`Documentation was edited: ${path}; preserve the edit outside snapshot before syncing`)
    }
  }
  if (!manifest.files.LICENSE || !manifest.files['README.md'] || !manifest.files['README.zh.md']) {
    throw new Error('Documentation snapshot is missing its license or bilingual entry points')
  }
  if (readFileSync(join(target, 'INDEX.md'), 'utf8') !== catalog(manifest)) {
    throw new Error('Generated documentation index differs from its manifest')
  }
  return manifest
}

/** Read tracked release blobs; working-tree modifications never enter the mirror. */
export function readOfficialSnapshot(source, version) {
  const ref = `dsh-v${version}`
  const commit = git(source, ['rev-parse', '--verify', `refs/tags/${ref}^{commit}`]).toString().trim()
  const cli = JSON.parse(git(source, ['show', `${commit}:apps/cli/package.json`]).toString())
  if (cli.name !== '@deepseek-ai/dsh' || cli.version !== version) {
    throw new Error('Upstream CLI manifest does not match the requested runtime version')
  }
  const entries = git(source, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString()
    .split('\0').filter(Boolean).map(line => {
      const [header, path] = line.split('\t')
      const [mode, type, blob] = header.split(' ')
      return { path, mode, type, blob }
    }).filter(entry => isOfficialDocument(entry.path)).sort((a, b) => a.path.localeCompare(b.path, 'en'))
  for (const entry of entries) {
    if (entry.type !== 'blob' || entry.mode !== '100644') {
      throw new Error(`Expected a regular, non-executable documentation file: ${entry.path}`)
    }
  }
  const batch = git(source, ['cat-file', '--batch'], `${entries.map(entry => entry.blob).join('\n')}\n`)
  let offset = 0
  const files = {}
  const contents = new Map()
  for (const entry of entries) {
    const end = batch.indexOf(10, offset)
    const [blob, type, size] = batch.subarray(offset, end).toString().split(' ')
    if (blob !== entry.blob || type !== 'blob' || !/^\d+$/.test(size)) throw new Error('Invalid git blob response')
    const bytes = batch.subarray(end + 1, end + 1 + Number(size))
    offset = end + 2 + bytes.length
    files[entry.path] = { blob, sha256: digest(bytes), bytes: bytes.length }
    contents.set(entry.path, bytes)
  }
  return {
    manifest: { format: 1, repository, website, ref, commit, harnessVersion: version, files },
    contents,
  }
}

/** Replace only a verified, generated snapshot; never overwrite local documentation edits. */
export function syncSnapshot(root, snapshot) {
  const target = join(root, snapshotPath)
  const parent = dirname(target)
  mkdirSync(parent, { recursive: true })
  if (existsSync(target)) checkSnapshot(root, { matchRuntime: false })
  const stage = mkdtempSync(join(parent, '.dsh-docs-stage-'))
  const backup = `${stage}.previous`
  try {
    for (const [path, bytes] of snapshot.contents) {
      const destination = join(stage, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
    writeFileSync(join(stage, 'MANIFEST.json'), `${JSON.stringify(snapshot.manifest, null, 2)}\n`)
    writeFileSync(join(stage, 'INDEX.md'), catalog(snapshot.manifest))
    checkSnapshot(root, { snapshotDirectory: stage })
    if (existsSync(target)) renameSync(target, backup)
    try {
      renameSync(stage, target)
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, target)
      throw error
    }
    rmSync(backup, { recursive: true, force: true })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  return checkSnapshot(root)
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: 'boolean' }, source: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('node scripts/sync-dsh-docs.mjs [--check] [--source /path/to/deepseek-harness]\nUses the exact DSH release pinned by package.json. --check is offline; --source also verifies against release blobs.')
    return
  }
  const version = pinnedVersion(projectRoot)
  let temporary
  try {
    let source = values.source === undefined ? undefined : resolve(values.source)
    if (!values.check && source === undefined) {
      temporary = mkdtempSync(join(tmpdir(), 'dsh-official-docs-'))
      git(temporary, ['init', '--bare', '--quiet'])
      git(temporary, ['fetch', '--quiet', '--depth=1', `${repository}.git`, `refs/tags/dsh-v${version}:refs/tags/dsh-v${version}`])
      source = temporary
    }
    const snapshot = source === undefined ? undefined : readOfficialSnapshot(source, version)
    const manifest = values.check ? checkSnapshot() : syncSnapshot(projectRoot, snapshot)
    if (snapshot !== undefined && JSON.stringify(manifest) !== JSON.stringify(snapshot.manifest)) {
      throw new Error('Documentation manifest differs from the complete official release snapshot')
    }
    console.log(`DSH ${manifest.harnessVersion}: ${Object.keys(manifest.files).length} official files verified at ${manifest.commit}`)
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
