#!/usr/bin/env node
/** One-command executable front door for the managed Claude-like TUI profile. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { constants, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createLaunchPlanner,
  type LaunchPlan,
  type LaunchPlannerAdapter,
  type LaunchRequest,
  type RuntimePreference,
} from './launch-plan.ts'
import {
  ensureManagedProfile,
  inspectManagedProfiles,
  type PackageIdentity,
} from './managed-profile.ts'
import {
  discoverExternalRuntimes,
  resolveBundledDshRuntime,
} from './runtime-discovery.ts'
import { probeRuntimeCompatibility } from './runtime-probe.ts'
import type { DshToolsMode } from './runtime-snapshot.ts'

const BUNDLED_DSH_VERSION = '0.1.0-rc.6'
const RUNTIME_ENV = 'DSH_CLAUDE_TUI_RUNTIME'
const LAUNCH_NOTICE_ENV = 'DSH_CLAUDE_TUI_LAUNCH_NOTICE'
const PROBE_TOKEN_ENV = 'DSH_CLAUDE_TUI_PROBE_TOKEN'
const RUNTIME_SNAPSHOT_ENV = 'DSH_CLAUDE_TUI_RUNTIME_SNAPSHOT'

const HELP = `Usage: dsh-claude-tui [options] [prompt...]

Run the Claude Code-style terminal interface over DeepSeek Harness.

Options:
  -h, --help       show this help
  -V, --version    output the version number

Environment:
  DSH_CLAUDE_TUI_RUNTIME=auto|system|bundled
                     select automatic, compatible system, or bundled DSH

All other options and arguments are forwarded to the TUI.
`

interface PackageManifest {
  version?: unknown
}

function isDshToolsMode(value: string): value is DshToolsMode {
  return value === 'native' || value === 'code' || value === 'both'
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

/** Match Harness' empty-value and tilde rules for a user-data root. */
function expandHome(path: string): string {
  const expanded = path === '~'
    ? homedir()
    : path.startsWith('~/') || path.startsWith('~\\')
      ? join(homedir(), path.slice(2))
      : path
  return resolve(expanded)
}

function runtimePreference(): RuntimePreference {
  const value = process.env[RUNTIME_ENV]?.trim() || 'auto'
  if (value === 'auto' || value === 'system' || value === 'bundled') return value
  throw new Error(
    `${RUNTIME_ENV} must be one of auto, system, or bundled; received ${JSON.stringify(value)}`,
  )
}

function launchRequest(): LaunchRequest {
  const configured = process.env.DSH_HOME
  const explicitHome = configured !== undefined && configured.trim() !== ''
  return {
    runtimePreference: runtimePreference(),
    sharedHome: expandHome(explicitHome ? configured : join(homedir(), '.dsh')),
    isolatedHome: expandHome(join(homedir(), '.dsh-claude-tui')),
    explicitHome,
  }
}

function launchAdapter(identity: PackageIdentity): LaunchPlannerAdapter {
  const bundled = resolveBundledDshRuntime(import.meta.url)
  if (bundled.version !== BUNDLED_DSH_VERSION) {
    throw new Error(
      `bundled DeepSeek Harness is ${bundled.version}; expected pinned ${BUNDLED_DSH_VERSION}`,
    )
  }
  return {
    inspectHome: inspectManagedProfiles,
    discoverExternalRuntimes: async home => discoverExternalRuntimes({
      home,
      pathEnvironment: process.env.PATH,
      bundledPackageRoot: bundled.packageRoot,
    }),
    bundledRuntime: () => bundled,
    probeRuntime: async runtime => await probeRuntimeCompatibility(runtime, identity),
  }
}

/** Run Harness in the foreground while preserving the caller's process boundary. */
async function runHarness(plan: LaunchPlan, args: readonly string[]): Promise<number> {
  const toolsMode = process.env.DSH_TOOLS_MODE ?? 'code'
  const snapshotToolsMode = toolsMode.trim()
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: plan.home.path,
    DSH_TOOLS_MODE: toolsMode,
  }
  delete environment[PROBE_TOKEN_ENV]
  delete environment[LAUNCH_NOTICE_ENV]
  delete environment[RUNTIME_SNAPSHOT_ENV]
  if (plan.notices.length > 0) environment[LAUNCH_NOTICE_ENV] = plan.notices.join(' ')
  if (isDshToolsMode(snapshotToolsMode)) {
    environment[RUNTIME_SNAPSHOT_ENV] = JSON.stringify({
      harnessVersion: plan.runtime.version,
      runtimeKind: plan.runtime.kind,
      homeKind: plan.home.kind,
      homePath: plan.home.path,
      toolsMode: snapshotToolsMode,
    })
  }
  const harnessArgs = [plan.runtime.executable, '--profile', plan.profile.name, ...args]

  // Supported POSIX Node lines expose execve: replacing this process gives
  // Harness the original PID, TTY, signals, and exit semantics without a
  // wrapper process that could die before terminal restoration completes.
  if (process.execve !== undefined) {
    process.execve(process.execPath, [process.execPath, ...harnessArgs], environment)
  }

  // Windows has no POSIX execve. Keep one foreground child and forward the
  // two process signals Node supports there, waiting for Harness to dispose.
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, harnessArgs, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    })
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
    const plan = await createLaunchPlanner(launchAdapter(identity)).resolve(launchRequest())
    ensureManagedProfile(plan.home.path, plan.profile, identity)
    for (const notice of plan.notices) process.stderr.write(`dsh-claude-tui: ${notice}\n`)
    process.exitCode = await runHarness(plan, args)
  } catch (error) {
    process.stderr.write(`dsh-claude-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
