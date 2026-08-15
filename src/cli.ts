#!/usr/bin/env node
/** One-command executable front door for the managed Claude-like TUI profile. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { constants, homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILE_NAME = 'claude-tui'
const BASE_BUNDLE = '@deepseek-ai/dsh-base'
const TUI_BUNDLE = 'dsh-claude-tui'
const MANAGED_STATE_FILENAME = '.dsh-claude-tui-managed.json'
const PROFILE_PATCH = `# User patch layer for the managed claude-tui profile.
# This file is never rewritten by dsh-claude-tui after first-run creation.
[]
`
const PROFILE_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

const HELP = `Usage: dsh-claude-tui [options] [prompt...]

Run the Claude Code-style terminal interface over DeepSeek Harness.

Options:
  -h, --help       show this help
  -V, --version    output the version number

All other options and arguments are forwarded to the TUI.
`

interface PackageManifest {
  version?: unknown
  bin?: string | Record<string, string>
  dsh?: { profile?: { bundles?: unknown } }
  [key: string]: unknown
}

interface PackageIdentity {
  root: string
  version: string
}

interface ManagedState {
  schemaVersion: 1
  package: typeof TUI_BUNDLE
  profile: typeof PROFILE_NAME
  version: string
}

/** Fail before touching Harness state when npm only warned about an invalid engine. */
function assertSupportedNodeVersion(): void {
  const [majorText, minorText] = process.versions.node.split('.')
  const major = Number(majorText)
  const minor = Number(minorText)
  const supported = (major === 22 && minor >= 19) || major >= 24
  if (!supported) {
    throw new Error(
      `Node.js ${process.versions.node} is unsupported; install Node.js 22.19+ or 24+`,
    )
  }
}

/** Read the executing package identity without importing runtime dependencies. */
function packageIdentity(): PackageIdentity {
  const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error(`package manifest ${manifestPath} contains no valid version`)
  }
  return {
    root: dirname(manifestPath),
    version: manifest.version,
  }
}

/** Match Harness' empty-value and tilde rules for its user-data root. */
function resolveDshHome(): string {
  const configured = process.env.DSH_HOME
  const selected = configured === undefined || configured.trim() === ''
    ? join(homedir(), '.dsh')
    : configured
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

/** Read JSON with a path-specific, actionable diagnostic. */
function readJson(path: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} at ${path} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** Detect a directory entry without following a possibly dangling symlink. */
function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Replace one existing text file atomically without changing its permissions. */
function writeTextAtomic(path: string, content: string, mode: number): void {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' })
    chmodSync(temporaryPath, mode & 0o777)
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

/** Create the launcher-owned package link used by Harness bundle resolution. */
function createBundleLink(link: string, packageRoot: string): void {
  symlinkSync(packageRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Build a complete first-run profile off to the side, then publish it once. */
function createManagedProfile(profileDirectory: string, identity: PackageIdentity): void {
  const profilesDirectory = dirname(profileDirectory)
  mkdirSync(profilesDirectory, { recursive: true })
  const stagingDirectory = mkdtempSync(join(profilesDirectory, `.${PROFILE_NAME}-${randomUUID()}-`))
  try {
    const manifest: PackageManifest = {
      name: `dsh-profile-${PROFILE_NAME}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [BASE_BUNDLE, TUI_BUNDLE] } },
    }
    writeFileSync(join(stagingDirectory, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    writeFileSync(join(stagingDirectory, 'cordis.patch.yml'), PROFILE_PATCH)
    writeFileSync(join(stagingDirectory, 'pnpm-workspace.yaml'), PROFILE_WORKSPACE)
    const modulesDirectory = join(stagingDirectory, 'node_modules')
    mkdirSync(modulesDirectory)
    createBundleLink(join(modulesDirectory, TUI_BUNDLE), identity.root)
    const state: ManagedState = {
      schemaVersion: 1,
      package: TUI_BUNDLE,
      profile: PROFILE_NAME,
      version: identity.version,
    }
    writeFileSync(
      join(stagingDirectory, MANAGED_STATE_FILENAME),
      `${JSON.stringify(state, undefined, 2)}\n`,
    )
    renameSync(stagingDirectory, profileDirectory)
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error(
        `profile ${profileDirectory} appeared during setup; rerun after the other launcher exits`,
      )
    }
    throw error
  }
}

/** Validate ownership before changing only the launcher-owned bundle registration. */
function reconcileManagedProfile(profileDirectory: string, identity: PackageIdentity): void {
  const directoryStat = lstatSync(profileDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`managed profile path ${profileDirectory} must be a real directory`)
  }

  const statePath = join(profileDirectory, MANAGED_STATE_FILENAME)
  if (!pathEntryExists(statePath)) {
    throw new Error(
      `profile ${profileDirectory} already exists but is not launcher-managed; `
      + 'rename it or choose another DSH_HOME instead of letting this launcher overwrite it',
    )
  }
  const stateStat = lstatSync(statePath)
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
    throw new Error(`managed state ${statePath} must be a regular file`)
  }
  const state = readJson(statePath, 'managed state')
  if (state.schemaVersion !== 1 || state.package !== TUI_BUNDLE || state.profile !== PROFILE_NAME) {
    throw new Error(
      `managed state ${statePath} is not a supported ${TUI_BUNDLE} profile marker; refusing to overwrite it`,
    )
  }

  const manifestPath = join(profileDirectory, 'package.json')
  if (!pathEntryExists(manifestPath)) {
    throw new Error(`managed profile is missing ${manifestPath}; refusing to reconstruct user state`)
  }
  const manifestStat = lstatSync(manifestPath)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`profile manifest ${manifestPath} must be a regular file`)
  }
  const manifest = readJson(manifestPath, 'profile manifest') as PackageManifest
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`profile manifest ${manifestPath} must declare dsh.profile.bundles as strings`)
  }
  if (!bundles.includes(BASE_BUNDLE)) {
    throw new Error(
      `managed profile ${manifestPath} no longer contains ${BASE_BUNDLE}; refusing to guess the user's composition`,
    )
  }

  const modulesDirectory = join(profileDirectory, 'node_modules')
  if (pathEntryExists(modulesDirectory)) {
    const modulesStat = lstatSync(modulesDirectory)
    if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
      throw new Error(`profile modules path ${modulesDirectory} must be a real directory`)
    }
  }
  const bundleLink = join(modulesDirectory, TUI_BUNDLE)
  let staleBundleLink = false
  try {
    const linkStat = lstatSync(bundleLink)
    if (!linkStat.isSymbolicLink()) {
      throw new Error(
        `launcher-owned bundle path ${bundleLink} is not a symlink; refusing to overwrite it`,
      )
    }
    staleBundleLink = resolve(dirname(bundleLink), readlinkSync(bundleLink)) !== identity.root
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    staleBundleLink = true
  }

  let seen = false
  const reconciledBundles = bundles.filter((bundle) => {
    if (bundle !== TUI_BUNDLE) return true
    if (seen) return false
    seen = true
    return true
  })
  if (!seen) reconciledBundles.push(TUI_BUNDLE)
  if (reconciledBundles.length !== bundles.length || !seen) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: reconciledBundles },
    }
    writeTextAtomic(
      manifestPath,
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      manifestStat.mode,
    )
  }

  if (staleBundleLink) {
    mkdirSync(modulesDirectory, { recursive: true })
    try {
      unlinkSync(bundleLink)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    createBundleLink(bundleLink, identity.root)
  }
  if (state.version !== identity.version) {
    const reconciledState: ManagedState = {
      schemaVersion: 1,
      package: TUI_BUNDLE,
      profile: PROFILE_NAME,
      version: identity.version,
    }
    writeTextAtomic(
      statePath,
      `${JSON.stringify(reconciledState, undefined, 2)}\n`,
      stateStat.mode,
    )
  }
}

/** Ensure first-run state exists without adopting an unowned profile. */
function ensureManagedProfile(identity: PackageIdentity): void {
  const profileDirectory = join(resolveDshHome(), 'profiles', PROFILE_NAME)
  if (!pathEntryExists(profileDirectory)) {
    createManagedProfile(profileDirectory, identity)
    return
  }
  reconcileManagedProfile(profileDirectory, identity)
}

/** Resolve the pinned Harness bin from this package's dependency closure. */
function dshExecutable(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (typeof entry !== 'string') {
    throw new Error(`installed @deepseek-ai/dsh at ${manifestPath} exposes no dsh executable`)
  }
  return resolve(dirname(manifestPath), entry)
}

/** Run Harness in the foreground while preserving the caller's process boundary. */
async function runHarness(args: readonly string[]): Promise<number> {
  const executable = dshExecutable()
  const environment = {
    ...process.env,
    DSH_TOOLS_MODE: process.env.DSH_TOOLS_MODE ?? 'code',
  }

  // Supported POSIX Node lines expose execve: replacing this process gives
  // Harness the original PID, TTY, signals, and exit semantics without a
  // wrapper process that could die before terminal restoration completes.
  if (process.execve !== undefined) {
    process.execve(
      process.execPath,
      [process.execPath, executable, '--profile', PROFILE_NAME, ...args],
      environment,
    )
  }

  // Windows has no POSIX execve. Keep one foreground child and forward the
  // two process signals Node supports there, waiting for Harness to dispose.
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [executable, '--profile', PROFILE_NAME, ...args],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: 'inherit',
      },
    )
    const forward = (signal: 'SIGINT' | 'SIGTERM'): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    }
    const onSigint = (): void => { forward('SIGINT') }
    const onSigterm = (): void => { forward('SIGTERM') }
    const cleanup = (): void => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      if (code !== null) {
        resolveExit(code)
        return
      }
      const signalNumber = signal === null ? undefined : constants.signals[signal]
      resolveExit(typeof signalNumber === 'number' ? 128 + signalNumber : 1)
    })
  })
}

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
  process.stdout.write(HELP)
} else if (args.length === 1 && (args[0] === '-V' || args[0] === '--version')) {
  process.stdout.write(`${packageIdentity().version}\n`)
} else {
  try {
    assertSupportedNodeVersion()
    const identity = packageIdentity()
    ensureManagedProfile(identity)
    process.exitCode = await runHarness(args)
  } catch (error) {
    process.stderr.write(`dsh-claude-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
