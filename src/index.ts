/** Cordis entry point for the Claude Code-like Harness terminal profile. */
import { randomUUID } from 'node:crypto'
import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { ClaudeTuiApplication } from './app.ts'
import { listLocalWorkspaceEntries } from './files.ts'
import { ClaudeSessionPicker, loadSessionPickerEntries } from './session-picker.ts'
import { createPalette } from './theme.ts'
import {
  Config as ConfigSchema,
  resolveConfig,
  type Config as ClaudeTuiConfig,
  type ResolvedConfig,
} from './config.ts'
import type { ClaudeTuiStartupValues } from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'claude-tui'

/** Services required by the one-terminal, one-root-Agent application. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'sessions',
  'sessionQuery',
  'commands',
  'approval',
  'userQuestions',
  'claudeTuiStartup',
]

/** Loader-validated plugin configuration. */
export const Config = ConfigSchema
export type Config = ClaudeTuiConfig

/** Replaceable process boundary used by keyless integration tests. */
export const internals: {
  createTerminal(): Terminal
  isTty(): boolean
  cwd(): string
  stderr: { write(chunk: string): unknown }
} = {
  createTerminal: () => new ProcessTerminal(),
  isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  cwd: () => process.cwd(),
  stderr: process.stderr,
}

/** Owned resources created after Loader settlement. */
interface MountedRuntime {
  dispose(): Promise<void>
}

/** Report a startup failure and request a bounded failing exit. */
function fail(exit: (code: number) => void, error: unknown): void {
  internals.stderr.write(`dsh-claude-tui: ${errorChain(error)}\n`)
  exit(1)
}

/** Resolve the optional invocation override over the live default. */
function initialSelection(
  defaults: ModelSelection,
  startup: ClaudeTuiStartupValues,
): { initial: ModelSelection; override: ModelSelection | undefined } {
  if (startup.provider === undefined || startup.model === undefined) {
    return { initial: defaults, override: undefined }
  }
  const override: ModelSelection = {
    provider: startup.provider,
    model: startup.model,
    ...defaults.reasoningEffort === undefined ? {} : { reasoningEffort: defaults.reasoningEffort },
  }
  return { initial: override, override }
}

/** Install a selection whose persisted request header wins unless this invocation overrides it. */
function selectionSetup(
  defaults: ModelSelection,
  override: ModelSelection | undefined,
): (agentCtx: Context) => void {
  return (agentCtx) => {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('claude-tui: Agent setup has no scoped Agent')
    let picked = override
    const selection: ModelSelectionRef = {
      get current(): ModelSelection {
        if (picked !== undefined) return picked
        const logged = agent.session.requestHeader()?.config
        if (logged === undefined) return defaults
        return {
          provider: logged.provider,
          model: logged.model,
          ...logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort },
        }
      },
      set current(next: ModelSelection | undefined) {
        picked = next
      },
      assembled: undefined,
    }
    installModelSelection(agentCtx, selection)
  }
}

/**
 * Wait for this plugin's containing entry tree to settle.
 *
 * A plugin mounted inside cordis:include must not await the root Loader: the
 * root owns that Include entry and cannot settle until this plugin returns
 * from apply(). Direct mounts have no entry tree, so they retain the root
 * Loader fallback.
 */
export async function awaitCompositionSettlement(ctx: Context): Promise<void> {
  const tree = ctx.fiber.entry?.parent.tree
  if (tree !== undefined) {
    await tree.await()
    return
  }
  await ctx.get('loader')?.await()
}

/** Create or resume the terminal-owned root Agent after all Loader siblings settle. */
async function boot(
  ctx: Context,
  config: ClaudeTuiConfig,
  startup: ClaudeTuiStartupValues,
  signal: AbortSignal,
  exit: (code: number) => void,
): Promise<MountedRuntime | undefined> {
  await awaitCompositionSettlement(ctx)
  if (signal.aborted) return undefined

  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return undefined

  const defaults = defaultModel.currentSelection()
  const selected = initialSelection(defaults, startup)
  const setup = selectionSetup(defaults, selected.override)
  const agentOptions = { provider: selected.initial.provider, model: selected.initial.model }
  const resolved = resolveConfig(config)
  const appConfig: ResolvedConfig = {
    ...resolved,
    color: resolved.color && startup.color,
  }
  const terminal = internals.createTerminal()
  let resumeSessionId = startup.resumeSessionId
  let handle: AgentHandle | undefined
  try {
    if (startup.resumePicker) {
      const entries = await loadSessionPickerEntries(ctx, signal)
      const picker = new ClaudeSessionPicker(terminal, createPalette(appConfig.color), {
        cwd: internals.cwd(),
        signal,
      })
      resumeSessionId = await picker.run(entries)
      if (signal.aborted) return undefined
      if (resumeSessionId === undefined) {
        exit(1)
        return undefined
      }
      terminal.clearScreen()
    }

    handle = resumeSessionId === undefined
      ? await agents.create({
          sessionId: SessionId(startup.sessionId ?? `session-${randomUUID()}`),
          meta: { cwd: internals.cwd() },
          agentOptions,
          setup,
          signal,
        })
      : await agents.resume({
          resumeSessionId: SessionId(resumeSessionId),
          agentOptions,
          setup,
          signal,
        })
    if (signal.aborted) {
      await handle.dispose()
      return undefined
    }
    await handle.agent.whenIdle()
    if (signal.aborted) {
      await handle.dispose()
      return undefined
    }

    let exitRequested = false
    const app = new ClaudeTuiApplication(ctx, handle.agent, appConfig, {
      terminal,
      listWorkspaceEntries: listLocalWorkspaceEntries,
      exit: async (code) => {
        if (exitRequested) return
        exitRequested = true
        let finalCode = code
        try {
          await sessions.flush(handle!.agent.session)
        } catch (error: unknown) {
          internals.stderr.write(`dsh-claude-tui: failed to flush session: ${errorChain(error)}\n`)
          finalCode = 1
        }
        exit(finalCode)
      },
    })
    try {
      await app.start(startup.initialPrompt)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    const mountedHandle = handle
    return {
      async dispose(): Promise<void> {
        await app.dispose()
        await mountedHandle.dispose()
      },
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      await handle?.dispose()
      return undefined
    }
    throw error
  }
}

/** Mount the deferred application lifecycle. */
export function apply(ctx: Context, config: ClaudeTuiConfig): void {
  if (!internals.isTty()) {
    throw new Error('claude-tui: both stdin and stdout must be TTYs; use a headless profile for pipes')
  }
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('claude-tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const startup = ctx.claudeTuiStartup
  ctx.effect(() => {
    const controller = new AbortController()
    const mounted = boot(ctx, config, startup, controller.signal, exit).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(exit, error)
      return undefined
    })
    return async () => {
      controller.abort(new Error('Claude-like TUI owner disposed'))
      const runtime = await mounted
      await runtime?.dispose()
    }
  }, 'claude-tui.lifecycle()')
}
