import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import valid from 'semver/functions/valid.js'
import type { DshRuntime, RuntimeDiscovery, RuntimeSource } from './launch-plan.ts'

const DSH_PACKAGE = '@deepseek-ai/dsh'

interface DshManifest {
  name?: unknown
  version?: unknown
  bin?: unknown
}

export interface RuntimeDiscoveryRequest {
  home: string
  pathEnvironment?: string | undefined
  bundledPackageRoot?: string | undefined
  platform?: NodeJS.Platform | undefined
}

/** Resolve the pinned DSH shipped in this launcher's own dependency closure. */
export function resolveBundledDshRuntime(anchor: string | URL = import.meta.url): DshRuntime {
  const require = createRequire(anchor)
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  return inspectDshPackage(dirname(manifestPath), 'bundled', 'bundled')
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function readManifest(packageRoot: string): DshManifest {
  const manifestPath = join(packageRoot, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${manifestPath}: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package manifest ${manifestPath} must contain a JSON object`)
  }
  return parsed as DshManifest
}

function binEntry(manifest: DshManifest): string | undefined {
  if (typeof manifest.bin === 'string') return manifest.bin
  if (manifest.bin === null || typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)) {
    return undefined
  }
  const entry = (manifest.bin as Record<string, unknown>).dsh
  return typeof entry === 'string' ? entry : undefined
}

/** Validate a candidate package without importing or executing any of its code. */
export function inspectDshPackage(
  packageRoot: string,
  kind: DshRuntime['kind'],
  source: RuntimeSource,
): DshRuntime {
  const physicalRoot = realpathSync(packageRoot)
  const rootStat = lstatSync(physicalRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`package root ${packageRoot} must resolve to a real directory`)
  }
  const manifest = readManifest(physicalRoot)
  if (manifest.name !== DSH_PACKAGE) {
    throw new Error(
      `expected package name ${DSH_PACKAGE} at ${physicalRoot}, received ${String(manifest.name)}`,
    )
  }
  if (typeof manifest.version !== 'string' || valid(manifest.version) === null) {
    throw new Error(`${DSH_PACKAGE} at ${physicalRoot} has an invalid semantic version`)
  }
  const entry = binEntry(manifest)
  if (entry === undefined || entry.trim() === '') {
    throw new Error(`${DSH_PACKAGE} at ${physicalRoot} exposes no dsh executable`)
  }
  const executable = resolve(physicalRoot, entry)
  const relativeExecutable = relative(physicalRoot, executable)
  if (
    relativeExecutable === ''
    || relativeExecutable === '..'
    || relativeExecutable.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(relativeExecutable)
  ) {
    throw new Error(`${DSH_PACKAGE} bin ${entry} resolves outside its package root`)
  }
  const executableStat = lstatSync(executable)
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
    throw new Error(`${DSH_PACKAGE} executable ${executable} must be a regular file`)
  }
  return {
    kind,
    source,
    version: manifest.version,
    packageRoot: physicalRoot,
    executable,
  }
}

function pathExecutables(
  pathEnvironment: string,
  platform: NodeJS.Platform,
): string[] {
  const executables: string[] = []
  const names = platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh']
  for (const directory of pathEnvironment.split(delimiter)) {
    if (directory.trim() === '') continue
    for (const name of names) {
      const candidate = join(directory, name)
      try {
        accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
        executables.push(candidate)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'EACCES') throw error
      }
    }
  }
  return executables
}

function packageRootFromExecutable(executable: string): string | undefined {
  const physicalExecutable = realpathSync(executable)
  let cursor = dirname(physicalExecutable)
  while (true) {
    const manifestPath = join(cursor, 'package.json')
    if (pathEntryExists(manifestPath)) {
      try {
        if (readManifest(cursor).name === DSH_PACKAGE) return cursor
      } catch {
        // Continue upward; discovery reports a useful error when no DSH package is found.
      }
    }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  // npm and pnpm put command shims beside the package namespace. This path is
  // accepted only after the package manifest and its own bin are validated.
  const adjacent = resolve(dirname(executable), '..', '@deepseek-ai/dsh')
  return pathEntryExists(adjacent) ? adjacent : undefined
}

function diagnostic(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Ignored ${label} DeepSeek Harness candidate: ${message}`
}

/** Discover only explicit, locally associated DSH installations; never scan caches. */
export function discoverExternalRuntimes(request: RuntimeDiscoveryRequest): RuntimeDiscovery {
  const runtimes: DshRuntime[] = []
  const diagnostics: string[] = []
  const seen = new Set<string>()
  let excludedRoot: string | undefined
  if (request.bundledPackageRoot !== undefined) {
    try {
      excludedRoot = realpathSync(request.bundledPackageRoot)
    } catch {
      // Bundled resolution reports its own fatal error; exclusion is best effort here.
    }
  }

  const add = (packageRoot: string, source: 'home' | 'path'): void => {
    try {
      const runtime = inspectDshPackage(packageRoot, 'system', source)
      if (runtime.packageRoot === excludedRoot || seen.has(runtime.packageRoot)) return
      seen.add(runtime.packageRoot)
      runtimes.push(runtime)
    } catch (error) {
      diagnostics.push(diagnostic(source, error))
    }
  }

  const associated = join(request.home, 'profiles/node_modules/@deepseek-ai/dsh')
  if (pathEntryExists(associated)) add(associated, 'home')

  const commands = pathExecutables(
    request.pathEnvironment ?? process.env.PATH ?? '',
    request.platform ?? process.platform,
  )
  for (const command of commands) {
    try {
      const packageRoot = packageRootFromExecutable(command)
      if (packageRoot === undefined) {
        throw new Error(`${command} is not associated with a verifiable ${DSH_PACKAGE} package`)
      }
      add(packageRoot, 'path')
    } catch (error) {
      diagnostics.push(diagnostic('path', error))
    }
  }

  return { runtimes, diagnostics }
}
