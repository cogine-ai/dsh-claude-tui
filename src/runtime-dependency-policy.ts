/** Keep automatic external-runtime selection from bypassing the bundled security repairs. */
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { satisfies } from 'semver'

const patched = new Map([
  ['zod', '>=4.6.6 <5'],
  ['undici', '>=8.12.2 <9'],
  ['@modelcontextprotocol/client', '>=2.3.0 <3'],
  ['@modelcontextprotocol/core', '>=2.3.0 <3'],
])

interface Manifest { name: string; version: string; dependencies?: Record<string, string> }
const read = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest

function dependencyManifest(owner: NodeRequire, name: string): string {
  try { return owner.resolve(`${name}/package.json`) } catch {
    // MCP's exports hide package.json; locate its manifest from its resolved entry.
    for (let path = dirname(owner.resolve(name)); ; path = dirname(path)) {
      try {
        if (read(join(path, 'package.json')).name === name) return join(path, 'package.json')
      } catch { /* The entry may be under a directory without its own manifest. */ }
      if (dirname(path) === path) throw new Error(`Cannot locate dependency manifest: ${name}`)
    }
  }
}

/** Read the actual owner-resolved graph without executing external package code. */
export function assertPatchedDshDependencies(packageRoot: string): void {
  const pending = [join(packageRoot, 'package.json')]
  const visited = new Set<string>()
  const checked = new Set<string>()
  while (pending.length) {
    const path = realpathSync(pending.pop()!)
    if (visited.has(path)) continue
    visited.add(path)
    const owner = createRequire(path)
    for (const name of Object.keys(read(path).dependencies ?? {})) {
      const range = patched.get(name)
      if (!name.startsWith('@deepseek-ai/dsh') && range === undefined) continue
      const child = dependencyManifest(owner, name)
      const manifest = read(child)
      if (range !== undefined) {
        if (!satisfies(manifest.version, range)) {
          throw new Error(`external DSH resolves ${name}@${manifest.version}; security repairs require ${range}. Use DSH_CLAUDE_TUI_RUNTIME=bundled or repair the external runtime.`)
        }
        checked.add(name)
      }
      pending.push(child)
    }
  }
  for (const name of patched.keys()) {
    if (!checked.has(name)) throw new Error(`external DSH is missing the security-qualified ${name} dependency owner`)
  }
}
