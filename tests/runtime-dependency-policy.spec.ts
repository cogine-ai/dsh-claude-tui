import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertPatchedDshDependencies } from '../src/runtime-dependency-policy.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function writePackage(root: string, manifest: object): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
}
function fixture(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-security-'))
  roots.push(root)
  const versions = { zod: '4.6.6', undici: '8.12.2', '@modelcontextprotocol/client': '2.3.0', '@modelcontextprotocol/core': '2.3.0', ...overrides }
  writePackage(root, { name: '@deepseek-ai/dsh', dependencies: versions })
  for (const [name, version] of Object.entries(versions)) writePackage(join(root, 'node_modules', name), { name, version })
  return root
}

it('accepts the complete repaired DSH graph selected by the actual workspace', () => {
  const root = dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
  expect(() => assertPatchedDshDependencies(root)).not.toThrow()
})

it.each([
  ['zod', '4.4.3'], ['undici', '8.11.2'],
  ['@modelcontextprotocol/client', '2.2.0'], ['@modelcontextprotocol/core', '2.2.0'],
])('rejects the advisory-affected external %s@%s', (name, version) => {
  expect(() => assertPatchedDshDependencies(fixture({ [name]: version }))).toThrow(`resolves ${name}@${version}`)
})

it('checks a nested DSH owner rather than allowing a patched root copy to hide it', () => {
  const root = fixture()
  writePackage(root, { name: '@deepseek-ai/dsh', dependencies: {
    zod: '4.6.6', undici: '8.12.2', '@modelcontextprotocol/client': '2.3.0', '@modelcontextprotocol/core': '2.3.0',
    '@deepseek-ai/dsh-child': '0.2.2-rc.1',
  } })
  const child = join(root, 'node_modules/@deepseek-ai/dsh-child')
  writePackage(child, { name: '@deepseek-ai/dsh-child', dependencies: { zod: '4.4.3' } })
  writePackage(join(child, 'node_modules/zod'), { name: 'zod', version: '4.4.3' })
  expect(() => assertPatchedDshDependencies(root)).toThrow('resolves zod@4.4.3')
})
