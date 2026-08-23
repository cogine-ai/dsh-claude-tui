import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DshRuntime, RuntimeProbe } from './launch-plan.ts'
import { PROFILE_NAME } from './launch-plan.ts'
import { ensureManagedProfile, type PackageIdentity } from './managed-profile.ts'
import type { CompatibilityProbeResult } from './probe-contract.ts'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024
const PROBE_TOKEN_ENV = 'DSH_CLAUDE_TUI_PROBE_TOKEN'
const PROBE_RESULT_PREFIX = 'DSH_CLAUDE_TUI_PROBE_RESULT '

export const runtimeProbeInternals = {
  removeProbeRoot(path: string): void {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  },
}

export interface RuntimeProbeOptions {
  environment?: NodeJS.ProcessEnv | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
}

interface ProbeProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  failure?: string
}

function isolatedEnvironment(
  source: NodeJS.ProcessEnv,
  root: string,
  home: string,
  dshHome: string,
  token: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
  ]) {
    if (source[key] !== undefined) environment[key] = source[key]
  }
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    TMPDIR: root,
    TEMP: root,
    TMP: root,
    TERM: 'dumb',
    NO_COLOR: '1',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_TOOLS_MODE: 'code',
    AWS_EC2_METADATA_DISABLED: 'true',
    [PROBE_TOKEN_ENV]: token,
  }
}

async function runProbeProcess(
  runtime: DshRuntime,
  profile: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  outputLimitBytes: number,
): Promise<ProbeProcessResult> {
  return await new Promise<ProbeProcessResult>((resolveResult) => {
    const child = spawn(
      process.execPath,
      [runtime.executable, '--profile', profile],
      {
        cwd,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    )
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let failure: string | undefined
    let settled = false

    const stop = (reason: string): void => {
      if (failure !== undefined) return
      failure = reason
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
          return
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
          failure += `; could not terminate probe process group: ${String(error)}`
        }
      }
      try {
        child.kill('SIGKILL')
      } catch (error) {
        failure += `; could not terminate probe process: ${String(error)}`
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > outputLimitBytes) {
        stop(`probe stdout exceeded the ${outputLimitBytes}-byte output limit`)
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > outputLimitBytes) {
        stop(`probe stderr exceeded the ${outputLimitBytes}-byte output limit`)
        return
      }
      stderr += chunk.toString('utf8')
    })

    const timeout = setTimeout(() => {
      stop(`probe timed out after ${timeoutMs}ms`)
    }, timeoutMs)
    const finish = (result: ProbeProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveResult(result)
    }
    child.once('error', (error) => {
      finish({
        code: null,
        signal: null,
        stdout,
        stderr,
        failure: failure ?? `could not start probe: ${String(error)}`,
      })
    })
    child.once('exit', (code, signal) => {
      finish({
        code,
        signal,
        stdout,
        stderr,
        ...(failure === undefined ? {} : { failure }),
      })
    })
  })
}

function parseProbeResult(stdout: string): unknown {
  const start = stdout.indexOf(PROBE_RESULT_PREFIX)
  if (start === -1) return undefined
  const payloadStart = start + PROBE_RESULT_PREFIX.length
  const newline = stdout.indexOf('\n', payloadStart)
  const raw = stdout.slice(payloadStart, newline === -1 ? undefined : newline).trim()
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function expectedProbeResult(
  value: unknown,
  token: string,
  version: string,
): value is CompatibilityProbeResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Partial<CompatibilityProbeResult>
  return result.token === token
    && result.package === 'dsh-claude-tui'
    && result.version === version
    && Array.isArray(result.services)
    && result.services.length === 5
    && result.services[0] === 'agentDefaultModel'
    && result.services[1] === 'agents'
    && result.services[2] === 'attachments'
    && result.services[3] === 'commands'
    && result.services[4] === 'sessions'
}

function briefOutput(stderr: string): string {
  const normalized = stderr.replaceAll(/\s+/gu, ' ').trim()
  return normalized === '' ? '' : `: ${normalized.slice(0, 2_000)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Probe one candidate in disposable state, with no provider credentials or user patches. */
export async function probeRuntimeCompatibility(
  runtime: DshRuntime,
  identity: PackageIdentity,
  options: RuntimeProbeOptions = {},
): Promise<RuntimeProbe> {
  let probeRoot: string | undefined
  let result: RuntimeProbe
  try {
    probeRoot = mkdtempSync(join(tmpdir(), 'dsh-claude-tui-probe-'))
    const dshHome = join(probeRoot, 'dsh-home')
    const userHome = join(probeRoot, 'user-home')
    const workspace = join(probeRoot, 'workspace')
    const token = randomUUID()
    mkdirSync(userHome)
    mkdirSync(workspace)
    ensureManagedProfile(
      dshHome,
      { name: PROFILE_NAME, action: 'create' },
      identity,
    )
    const environment = isolatedEnvironment(
      options.environment ?? process.env,
      probeRoot,
      userHome,
      dshHome,
      token,
    )
    const outcome = await runProbeProcess(
      runtime,
      PROFILE_NAME,
      workspace,
      environment,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    )
    if (outcome.failure !== undefined) {
      result = { compatible: false, reason: outcome.failure }
    } else if (outcome.code !== 0) {
      const status = outcome.signal === null
        ? `exit code ${String(outcome.code)}`
        : `signal ${outcome.signal}`
      result = {
        compatible: false,
        reason: `probe exited with ${status}${briefOutput(outcome.stderr)}`,
      }
    } else if (!expectedProbeResult(parseProbeResult(outcome.stdout), token, identity.version)) {
      result = {
        compatible: false,
        reason: 'unexpected probe result; the selected DSH did not load this TUI artifact',
      }
    } else {
      result = { compatible: true }
    }
  } catch (error) {
    result = {
      compatible: false,
      reason: `probe setup failed: ${errorMessage(error)}`,
    }
  }

  if (probeRoot !== undefined) {
    try {
      runtimeProbeInternals.removeProbeRoot(probeRoot)
    } catch (error) {
      const priorFailure = result.compatible ? '' : `${result.reason}; `
      return {
        compatible: false,
        reason: `${priorFailure}probe cleanup failed: ${errorMessage(error)}`,
      }
    }
  }
  return result
}
