/** Command-line provider for the Claude-like TUI profile. */
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { ClaudeTuiRuntimeSnapshot, DshToolsMode } from './runtime-snapshot.ts'

const RUNTIME_SNAPSHOT_ENV = 'DSH_CLAUDE_TUI_RUNTIME_SNAPSHOT'

/** Stable Cordis plugin name. */
export const name = 'claude-tui-startup'

/** The launcher-provided argument snapshot must exist before parsing. */
export const inject = ['cmdlineArgs']

/** Service key consumed by the terminal application row. */
export const CLAUDE_TUI_STARTUP_SERVICE = 'claudeTuiStartup'

/** Parsed invocation values. */
export interface ClaudeTuiStartupValues {
  readonly resumePicker: boolean
  readonly resumeSessionId?: string
  readonly sessionId?: string
  readonly provider?: string
  readonly model?: string
  readonly initialPrompt?: string
  readonly launchNotice?: string
  readonly runtimeSnapshot?: ClaudeTuiRuntimeSnapshot
  readonly color: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed values owned by the Claude-like terminal application. */
    claudeTuiStartup: ClaudeTuiStartupValues
  }
}

/** Split `provider/model` without guessing a provider for a bare model id. */
function parseModelTarget(program: Command, raw: string | undefined): Pick<ClaudeTuiStartupValues, 'provider' | 'model'> {
  if (raw === undefined) return {}
  const separator = raw.indexOf('/')
  if (separator <= 0 || separator === raw.length - 1) {
    program.error('error: --model must use provider/model, for example deepseek/deepseek-chat')
  }
  return { provider: raw.slice(0, separator), model: raw.slice(separator + 1) }
}

function isDshToolsMode(value: string): value is DshToolsMode {
  return value === 'native' || value === 'code' || value === 'both'
}

/** Parse the internal environment boundary without trusting inherited process state. */
function parseRuntimeSnapshot(raw: string | undefined): ClaudeTuiRuntimeSnapshot | undefined {
  if (raw === undefined || raw.length === 0 || raw.length > 4_096) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const harnessVersion = candidate.harnessVersion
  const runtimeKind = candidate.runtimeKind
  const homeKind = candidate.homeKind
  const homePath = candidate.homePath
  const toolsMode = candidate.toolsMode
  if (
    typeof harnessVersion !== 'string'
    || harnessVersion.trim() === ''
    || harnessVersion.length > 128
    || (runtimeKind !== 'system' && runtimeKind !== 'bundled')
    || (homeKind !== 'shared' && homeKind !== 'isolated')
    || typeof homePath !== 'string'
    || homePath.trim() === ''
    || homePath.length > 2_000
    || typeof toolsMode !== 'string'
    || !isDshToolsMode(toolsMode)
  ) return undefined
  return Object.freeze({ harnessVersion, runtimeKind, homeKind, homePath, toolsMode })
}

/** Build a fresh Commander program for one invocation. */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile claude-tui')
    .description('Run a Claude Code-like main-screen terminal over DeepSeek Harness.')
    .helpOption('-h, --help', 'show this help')
    .option('-r, --resume [session-id]', 'pick a persisted Harness session, or resume an exact id')
    .option('--session-id <session-id>', 'use an exact id for a new session')
    .option('--model <provider/model>', 'override the default provider and model')
    .option('--no-color', 'disable ANSI color styling')
    .argument('[prompt...]', 'optional prompt submitted after the terminal becomes ready')
    .addHelpText('after', `
Examples:
  dsh --profile claude-tui
  dsh --profile claude-tui --resume session-123
  dsh --profile claude-tui --model deepseek/deepseek-chat "inspect this repository"
`)
}

/** Parse the app-owned flags and publish an immutable startup service. */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{
      resume?: true | string
      sessionId?: string
      model?: string
      color: boolean
    }>()
    if (options.resume !== undefined && options.sessionId !== undefined) {
      program.error('error: --resume and --session-id cannot be used together')
    }
    const prompt = program.args.join(' ').trim()
    const launchNotice = process.env.DSH_CLAUDE_TUI_LAUNCH_NOTICE?.trim()
    const runtimeSnapshot = parseRuntimeSnapshot(process.env[RUNTIME_SNAPSHOT_ENV])
    const target = parseModelTarget(program, options.model)
    ctx.provide(CLAUDE_TUI_STARTUP_SERVICE, Object.freeze({
      resumePicker: options.resume === true,
      ...(typeof options.resume === 'string' ? { resumeSessionId: options.resume } : {}),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...target,
      ...(prompt === '' ? {} : { initialPrompt: prompt }),
      ...(launchNotice === undefined || launchNotice === ''
        ? {}
        : { launchNotice: launchNotice.slice(0, 2_000) }),
      ...(runtimeSnapshot === undefined ? {} : { runtimeSnapshot }),
      color: options.color,
    } satisfies ClaudeTuiStartupValues))
  })
  parseCmdline(ctx, program)
}
