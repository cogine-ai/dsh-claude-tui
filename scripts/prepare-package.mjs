/** Bundle the complete DSH closure so external hoisting cannot bypass repaired owners. */
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
const closure = JSON.parse(readFileSync(join(root, 'scripts/dsh-bundle.json'), 'utf8'))
manifest.bundleDependencies = closure.map(spec => spec.name)
manifest.dependencies = JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8')).packages[''].dependencies
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination)
for (const name of ['lib', 'docs', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md', 'DISCLAIMER.md', 'LICENSE', 'cordis.patch.yml', 'npm-shrinkwrap.json']) {
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
const missing = closure.filter(original => !specs.some(spec => spec.name === original.name)
  && !existsSync(cachedArchive(original)))
if (missing.length) {
  // npm fetches these tarballs concurrently and retains them for subsequent packs.
  // Each archive is still checked against its canonical SHA-512 below.
  execFileSync('npm', ['cache', 'add', ...missing.map(original => original.url), '--cache', cache, '--ignore-scripts'], {
    stdio: 'inherit',
  })
}
for (const original of closure) {
  const spec = specs.find(spec => spec.name === original.name)
  let bytes
  let integrity
  if (spec) {
    bytes = readFileSync(join(root, 'vendor/security', spec.filename))
    integrity = provenance.packages.find(record => record.package === spec.name)?.repacked.integrity
  } else {
    integrity = original.integrity
    bytes = readFileSync(cachedArchive(original))
  }
  if (sha512(bytes) !== integrity) throw new Error(`DSH archive integrity differs: ${original.name}`)
  const target = join(destination, 'node_modules', original.name)
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', '-', '--strip-components=1', '-C', target], { input: bytes })
  const installed = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (installed.name !== original.name || installed.version !== original.version
    || (spec && installed.dependencies[spec.dependency] !== spec.after)) throw new Error(`DSH manifest differs: ${original.name}`)
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) inventory[path.slice(destination.length + 1)] = {
        sha512: sha512(readFileSync(path)), mode: statSync(path).mode & 0o777,
      }
      else throw new Error(`Unexpected DSH archive member: ${path}`)
    }
  }
  visit(target)
}
writeFileSync(join(destination, 'vendor/security/bundle-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
manifest.files.push('vendor/security/bundle-inventory.json')
delete manifest.scripts
delete manifest.devDependencies
delete manifest.publishConfig.directory
delete manifest.publishConfig.linkDirectory
writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Staged ${closure.length} integrity-verified DSH packages with ${specs.length - 1} manifest-only repairs`)
