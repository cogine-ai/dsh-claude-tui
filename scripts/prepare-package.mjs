/** Bundle the immutable required runtime graph; fetch only exact platform optionals. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(root, 'dist')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(root, 'vendor/security/provenance.json'), 'utf8'))
const specs = JSON.parse(readFileSync(join(root, 'scripts/security-repacks.json'), 'utf8'))
const dshClosure = JSON.parse(readFileSync(join(root, 'scripts/dsh-bundle.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8'))
manifest.dependencies = lock.packages[''].dependencies
manifest.bundleDependencies = Object.keys(manifest.dependencies)
manifest.optionalDependencies = Object.fromEntries(Object.entries(lock.packages)
  .filter(([path, entry]) => path.startsWith('node_modules/')
    && !path.slice('node_modules/'.length).includes('/node_modules/') && entry.optional)
  .map(([path, entry]) => [path.slice('node_modules/'.length), entry.version]))
const closure = Object.entries(lock.packages)
  .filter(([path, entry]) => path !== '' && !entry.optional)
  .map(([path, entry]) => {
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const dsh = dshClosure.find(spec => spec.name === name && spec.version === entry.version)
    return { path, name, version: entry.version,
      url: dsh?.url ?? entry.resolved, integrity: dsh?.integrity ?? entry.integrity }
  }).sort((a, b) => a.path.split('/node_modules/').length - b.path.split('/node_modules/').length)
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination)
for (const name of ['lib', 'docs', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md', 'DISCLAIMER.md', 'LICENSE', 'cordis.patch.yml']) {
  cpSync(join(root, name), join(destination, name), {
    recursive: true,
    filter: path => !path.startsWith(join(root, 'docs/upstream')) && !path.endsWith('.map'),
  })
}
mkdirSync(join(destination, 'vendor/security'), { recursive: true })
for (const name of ['README.md', 'provenance.json']) cpSync(join(root, 'vendor/security', name), join(destination, 'vendor/security', name))
const inventory = {}
const sha512 = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const cache = process.env.DSH_CLAUDE_TUI_NPM_CACHE ?? join(homedir(), '.npm')
const cachedArchive = original => {
  const hex = Buffer.from(original.integrity.slice(7), 'base64').toString('hex')
  return join(cache, '_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4))
}
const missing = closure.filter(original => !specs.some(spec => spec.name === original.name && spec.version === original.version)
  && !existsSync(cachedArchive(original)))
if (missing.length) {
  // npm fetches these tarballs concurrently and retains them for subsequent packs.
  // Each archive is still checked against its canonical SHA-512 below.
  execFileSync('npm', ['cache', 'add', ...missing.map(original => original.url), '--cache', cache, '--ignore-scripts'], {
    stdio: 'inherit',
  })
}
for (const original of closure) {
  const spec = specs.find(spec => spec.name === original.name && spec.version === original.version)
  let bytes
  let integrity
  if (spec) {
    bytes = readFileSync(join(root, 'vendor/security', spec.filename))
    integrity = provenance.packages.find(record => record.package === spec.name)?.repacked.integrity
  } else {
    integrity = original.integrity
    bytes = readFileSync(cachedArchive(original))
  }
  if (sha512(bytes) !== integrity) throw new Error(`Archive integrity differs: ${original.path}`)
  const target = join(destination, original.path)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', '-', '--strip-components=1', '-C', target], { input: bytes })
  const installed = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (installed.name !== original.name || installed.version !== original.version
    || (spec && installed.dependencies[spec.dependency] !== spec.after)) throw new Error(`Manifest differs: ${original.path}`)
}
const visit = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (entry.isFile()) inventory[path.slice(destination.length + 1)] = {
      sha512: sha512(readFileSync(path)), mode: statSync(path).mode & 0o777,
    }
    else throw new Error(`Unexpected archive member: ${path}`)
  }
}
visit(join(destination, 'node_modules'))
writeFileSync(join(destination, 'vendor/security/bundle-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
// Never expose this partial-platform lock as npm's root shrinkwrap: registry
// inflation treats transitive nodes of bundled dependencies as already present.
// Every required node is physically bundled; platform optionals stay exact-pinned.
lock.packages[''].bundleDependencies = manifest.bundleDependencies
lock.packages[''].optionalDependencies = manifest.optionalDependencies
for (const item of closure) lock.packages[item.path].inBundle = true
writeFileSync(join(destination, 'vendor/security/runtime-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
manifest.files = manifest.files.filter(path => path !== 'npm-shrinkwrap.json')
manifest.files = [...new Set([...manifest.files, 'vendor/security/bundle-inventory.json', 'vendor/security/runtime-lock.json'])]
delete manifest.scripts
delete manifest.devDependencies
delete manifest.publishConfig.directory
delete manifest.publishConfig.linkDirectory
writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
// npm reapplies upstream `files` allowlists to bundled packages, omitting some
// root changelogs that older npm versions included. Inventory the published
// members, but fail closed if packing would discard any other upstream file.
const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', destination], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}))
const packed = new Set(files.map(file => file.path))
for (const path of Object.keys(inventory)) {
  if (packed.has(path)) continue
  if (!closure.some(item => path === `${item.path}/CHANGELOG.md`)) {
    throw new Error(`npm packing omitted upstream file: ${path}`)
  }
  delete inventory[path]
}
writeFileSync(join(destination, 'vendor/security/bundle-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
console.log(`Staged ${closure.length} required package nodes (${dshClosure.length} DSH packages) with ${specs.length} manifest-only repairs; ${Object.keys(manifest.optionalDependencies).length} exact platform optionals`)
