import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverExternalRuntimes,
  inspectDshPackage,
  resolveBundledDshRuntime,
} from '../src/runtime-discovery.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-runtime-discovery-'))
  temporaryDirectories.push(path)
  return path
}

function fakeDsh(root: string, version: string, name = '@deepseek-ai/dsh'): string {
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name,
    version,
    type: 'module',
    bin: { dsh: 'lib/bin.js' },
  }, undefined, 2)}\n`)
  writeFileSync(join(root, 'lib/bin.js'), '#!/usr/bin/env node\n')
  chmodSync(join(root, 'lib/bin.js'), 0o755)
  return root
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('DeepSeek Harness runtime discovery', () => {
  it('resolves the launcher-pinned bundled runtime from its dependency closure', () => {
    expect(resolveBundledDshRuntime()).toMatchObject({
      kind: 'bundled',
      source: 'bundled',
      version: '0.1.1-rc.2',
    })
  })

  it('returns the DSH-home-associated runtime before the PATH runtime', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const homePackage = fakeDsh(
      join(home, 'profiles/node_modules/@deepseek-ai/dsh'),
      '0.1.1-rc.2',
    )
    const pathPackage = fakeDsh(join(root, 'path/node_modules/@deepseek-ai/dsh'), '0.1.0')
    const binDirectory = join(root, 'path/node_modules/.bin')
    mkdirSync(binDirectory, { recursive: true })
    symlinkSync('../@deepseek-ai/dsh/lib/bin.js', join(binDirectory, 'dsh'))

    const discovery = discoverExternalRuntimes({
      home,
      pathEnvironment: binDirectory,
    })

    expect(discovery.diagnostics).toEqual([])
    expect(discovery.runtimes.map(runtime => ({
      source: runtime.source,
      version: runtime.version,
      packageRoot: runtime.packageRoot,
    }))).toEqual([
      { source: 'home', version: '0.1.1-rc.2', packageRoot: realpathSync(homePackage) },
      { source: 'path', version: '0.1.0', packageRoot: realpathSync(pathPackage) },
    ])
  })

  it('rejects lookalike packages and reports a bounded diagnostic', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    fakeDsh(
      join(home, 'profiles/node_modules/@deepseek-ai/dsh'),
      '0.1.0',
      '@example/lookalike',
    )

    const discovery = discoverExternalRuntimes({ home, pathEnvironment: '' })

    expect(discovery.runtimes).toEqual([])
    expect(discovery.diagnostics.join('\n')).toContain('expected package name @deepseek-ai/dsh')
  })

  it('reports a malformed DSH home without aborting discovery', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home-file')
    writeFileSync(home, 'not a directory')

    const discovery = discoverExternalRuntimes({ home, pathEnvironment: '' })

    expect(discovery.runtimes).toEqual([])
    expect(discovery.diagnostics).toEqual([
      expect.stringMatching(/Ignored home DeepSeek Harness candidate:.*home-file/u),
    ])
  })

  it('reports a malformed PATH entry without aborting discovery', () => {
    const root = temporaryDirectory()
    const pathEntry = join(root, 'path-file')
    writeFileSync(pathEntry, 'not a directory')

    const discovery = discoverExternalRuntimes({
      home: join(root, 'home'),
      pathEnvironment: pathEntry,
    })

    expect(discovery.runtimes).toEqual([])
    expect(discovery.diagnostics).toEqual([
      expect.stringMatching(/Ignored path DeepSeek Harness candidate:.*path-file/u),
    ])
  })

  it('deduplicates a PATH entry that resolves to the home-associated package', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const packageRoot = fakeDsh(
      join(home, 'profiles/node_modules/@deepseek-ai/dsh'),
      '0.1.0',
    )
    const binDirectory = join(root, 'bin')
    mkdirSync(binDirectory)
    symlinkSync(join(packageRoot, 'lib/bin.js'), join(binDirectory, 'dsh'))

    const discovery = discoverExternalRuntimes({ home, pathEnvironment: binDirectory })

    expect(discovery.runtimes).toHaveLength(1)
    expect(discovery.runtimes[0]?.source).toBe('home')
  })

  it('excludes the launcher bundled package from external candidates', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const packageRoot = fakeDsh(
      join(home, 'profiles/node_modules/@deepseek-ai/dsh'),
      '0.1.1-rc.2',
    )

    const discovery = discoverExternalRuntimes({
      home,
      pathEnvironment: '',
      bundledPackageRoot: packageRoot,
    })

    expect(discovery).toEqual({ runtimes: [], diagnostics: [] })
  })

  it('continues past an npx-prepended bundled shim to a later system DSH', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const bundledRoot = fakeDsh(join(root, 'bundled/@deepseek-ai/dsh'), '0.1.1-rc.2')
    const bundledBin = join(root, 'bundled/.bin')
    mkdirSync(bundledBin)
    symlinkSync('../@deepseek-ai/dsh/lib/bin.js', join(bundledBin, 'dsh'))
    const systemRoot = fakeDsh(join(root, 'system/@deepseek-ai/dsh'), '0.1.0')
    const systemBin = join(root, 'system/.bin')
    mkdirSync(systemBin)
    symlinkSync('../@deepseek-ai/dsh/lib/bin.js', join(systemBin, 'dsh'))

    const discovery = discoverExternalRuntimes({
      home,
      pathEnvironment: `${bundledBin}${delimiter}${systemBin}`,
      bundledPackageRoot: bundledRoot,
    })

    expect(discovery.runtimes).toHaveLength(1)
    expect(discovery.runtimes[0]).toMatchObject({
      source: 'path',
      packageRoot: realpathSync(systemRoot),
    })
  })

  it('validates the package name, semantic version, bin declaration, and executable', () => {
    const root = temporaryDirectory()
    const packageRoot = fakeDsh(join(root, 'dsh'), 'not-a-version')

    expect(() => inspectDshPackage(packageRoot, 'system', 'path'))
      .toThrow(/invalid semantic version/u)

    writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.0',
      bin: { dsh: '../outside.js' },
    })}\n`)
    expect(() => inspectDshPackage(packageRoot, 'system', 'path'))
      .toThrow(/outside its package root/u)
  })
})
