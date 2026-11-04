/** Resolve manifest-only repairs locally, then describe their portable bundled representation. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const specs = JSON.parse(readFileSync(join(root, 'scripts/security-repacks.json'), 'utf8'))
const closure = JSON.parse(readFileSync(join(root, 'scripts/dsh-bundle.json'), 'utf8'))
const owners = specs.filter(spec => spec.name.startsWith('@deepseek-ai/dsh-'))
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-security-lock-')))
try {
  const resolver = structuredClone(manifest)
  delete resolver.devDependencies
  delete resolver.scripts
  delete resolver.bundleDependencies
  delete resolver.publishConfig.directory
  delete resolver.publishConfig.linkDirectory
  resolver.overrides = { 'fast-uri': '3.1.9', qs: '6.16.1' }
  for (const owner of owners) {
    resolver.dependencies[owner.name] = `file:${join(root, 'vendor/security', owner.filename)}`
  }
  writeFileSync(join(temporary, 'package.json'), `${JSON.stringify(resolver, null, 2)}\n`)
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
    cwd: temporary, stdio: 'inherit',
  })
  const lock = JSON.parse(readFileSync(join(temporary, 'package-lock.json'), 'utf8'))
  // npm treats bundled owners' children as physically bundled. Declare external
  // required entries at the root as well, so ordinary installs fetch them.
  lock.packages[''].dependencies = {
    ...Object.fromEntries(Object.entries(lock.packages)
      .filter(([path, entry]) => /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path) && !entry.optional)
      .map(([path, entry]) => [path.slice('node_modules/'.length), entry.version])),
    ...manifest.dependencies,
  }
  lock.packages[''].bundleDependencies = closure.map(spec => spec.name)
  for (const owner of owners) {
    const entry = lock.packages[`node_modules/${owner.name}`]
    if (entry?.version !== owner.version || entry.dependencies?.[owner.dependency] !== owner.after) {
      throw new Error(`Resolver did not load the repaired manifest: ${owner.name}`)
    }
  }
  for (const spec of closure) {
    const entry = lock.packages[`node_modules/${spec.name}`]
    if (entry?.version !== spec.version) throw new Error(`Missing DSH closure member: ${spec.name}`)
    delete entry.resolved
    delete entry.integrity
    entry.inBundle = true
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if ((path !== '' && !path.startsWith('node_modules/')) || entry.resolved?.startsWith('file:')) {
      throw new Error(`Source-relative dependency escaped the bundle: ${path}`)
    }
  }
  writeFileSync(join(root, 'npm-shrinkwrap.json'), `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`Pinned ${owners.length} bundled owner repairs and ${Object.keys(lock.packages).length - 1} dependency entries`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
