/** Cordis entry point for the Claude Code-like Harness terminal profile. */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-attachment'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { ClaudeTuiApplication } from './app.ts'
import { readSystemClipboardImage } from './clipboard.ts'
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
import type { CompatibilityProbeResult } from './probe-contract.ts'

const PROBE_TOKEN_ENV = 'DSH_CLAUDE_TUI_PROBE_TOKEN'
const PROBE_RESULT_PREFIX = 'DSH_CLAUDE_TUI_PROBE_RESULT '
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

/** Stable Cordis plugin name. */
export const name = 'claude-tui'

/** Services required by the one-terminal, one-root-Agent application. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'sessions',
  'sessionQuery',
  'commands',
  'attachments',
  'credentials',
  'approval',
  'llm',
  'settings',
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
  stdout: { write(chunk: string): unknown }
} = {
  createTerminal: () => new ProcessTerminal(),
  isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  cwd: () => process.cwd(),
  stderr: process.stderr,
  stdout: process.stdout,
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
): { setup(agentCtx: Context): void; selection: ModelSelectionRef } {
  let agent: Agent | undefined
  let picked = override
  const selection: ModelSelectionRef = {
    get current(): ModelSelection {
      if (picked !== undefined) return picked
      const logged = agent?.session.requestHeader()?.config
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
  return {
    selection,
    setup(agentCtx: Context): void {
      agent = agentCtx.agent
      if (agent === undefined) throw new Error('claude-tui: Agent setup has no scoped Agent')
      installModelSelection(agentCtx, selection)
    },
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

/** Read the mounted plugin's version, not the host DSH package version. */
function packageVersion(): string {
  const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error(`claude-tui: package manifest ${manifestPath} contains no valid version`)
  }
  return manifest.version
}

/** Exercise the injected Agent, command, and Session contracts without a model request. */
export async function runCompatibilityProbe(
  ctx: Context,
  token: string,
  version: string,
  signal: AbortSignal,
): Promise<CompatibilityProbeResult> {
  await awaitCompositionSettlement(ctx)
  signal.throwIfAborted()

  const agents = ctx.get('agents')
  const attachments = ctx.get('attachments')
  const commands = ctx.get('commands')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (
    agents === undefined
    || attachments === undefined
    || commands === undefined
    || defaultModel === undefined
    || sessions === undefined
  ) {
    throw new Error(
      'claude-tui: compatibility probe is missing Agent, attachment, command, or Session services',
    )
  }

  const [imageRef] = await attachments.saveImages([{
    data: PROBE_PNG,
    mediaType: 'image/png',
    name: 'probe.png',
  }])
  if (imageRef === undefined) {
    throw new Error('claude-tui: compatibility probe attachment was not persisted')
  }
  const storedImage = await attachments.readImage(imageRef, signal)
  if (storedImage.ref.attachmentId !== imageRef.attachmentId || storedImage.data.byteLength === 0) {
    throw new Error('claude-tui: compatibility probe attachment could not be read back')
  }

  const defaults = defaultModel.currentSelection()
  const modelRuntime = selectionSetup(defaults, undefined)
  let commandInvoked = false
  const unregisterCommand = commands.register({
    name: 'dsh-claude-tui-probe',
    description: 'Verify the dsh-claude-tui command adapter contract',
    handler: ({ attachments, signal: commandSignal }) => {
      commandSignal.throwIfAborted()
      if (attachments.length !== 0) {
        throw new Error('claude-tui: compatibility probe received unexpected attachments')
      }
      commandInvoked = true
      return { kind: 'success' }
    },
  })
  let handle: AgentHandle | undefined
  try {
    handle = await agents.create({
      sessionId: SessionId(`dsh-claude-tui-probe-${randomUUID()}`),
      meta: { cwd: internals.cwd() },
      agentOptions: { provider: defaults.provider, model: defaults.model },
      setup: modelRuntime.setup,
      signal,
    })
    signal.throwIfAborted()
    await handle.agent.whenIdle()
    signal.throwIfAborted()
    const execution = await commands.execute(
      handle.agent,
      '/dsh-claude-tui-probe',
      [],
      signal,
    )
    if (!commandInvoked || execution?.result.kind !== 'success') {
      throw new Error('claude-tui: compatibility probe command did not execute successfully')
    }
    const session = handle.agent.session
    const previousEnd = session.seq
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'dsh-claude-tui session probe' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (
      session.seq !== previousEnd + 1
      || session.eventAt(event.seq) !== event
      || session.snapshotEvents(previousEnd).at(-1) !== event
    ) {
      throw new Error('claude-tui: compatibility probe could not read the appended Session event')
    }
    await sessions.flush(session)
  } finally {
    try {
      unregisterCommand()
    } finally {
      await handle?.dispose()
    }
  }

  return {
    token,
    package: 'dsh-claude-tui',
    version,
    services: ['agentDefaultModel', 'agents', 'attachments', 'commands', 'sessions'],
  }
}

function compatibilityProbeToken(): string | undefined {
  const token = process.env[PROBE_TOKEN_ENV]
  if (token === undefined) return undefined
  if (!/^[a-f\d-]{16,128}$/iu.test(token)) {
    throw new Error(`claude-tui: ${PROBE_TOKEN_ENV} is invalid`)
  }
  return token
}

function mountCompatibilityProbe(
  ctx: Context,
  token: string,
  exit: (code: number) => void,
): void {
  ctx.effect(() => {
    const controller = new AbortController()
    const completed = runCompatibilityProbe(
      ctx,
      token,
      packageVersion(),
      controller.signal,
    ).then((result) => {
      internals.stdout.write(`${PROBE_RESULT_PREFIX}${JSON.stringify(result)}\n`)
      exit(0)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(exit, error)
    })
    return async () => {
      controller.abort(new Error('Claude-like TUI compatibility probe disposed'))
      await completed
    }
  }, 'claude-tui.compatibility-probe()')
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
  const modelRuntime = selectionSetup(defaults, selected.override)
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
          setup: modelRuntime.setup,
          signal,
        })
      : await agents.resume({
          resumeSessionId: SessionId(resumeSessionId),
          agentOptions,
          setup: modelRuntime.setup,
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
      modelSelection: modelRuntime.selection,
      listWorkspaceEntries: listLocalWorkspaceEntries,
      readClipboardImage: readSystemClipboardImage,
      welcomeExpanded: resumeSessionId === undefined,
      tuiVersion: packageVersion(),
      ...(startup.runtimeSnapshot === undefined
        ? {}
        : { runtimeSnapshot: startup.runtimeSnapshot }),
      ...(startup.launchNotice === undefined ? {} : { launchNotice: startup.launchNotice }),
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
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('claude-tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const probeToken = compatibilityProbeToken()
  if (probeToken !== undefined) {
    mountCompatibilityProbe(ctx, probeToken, exit)
    return
  }
  if (!internals.isTty()) {
    throw new Error('claude-tui: both stdin and stdout must be TTYs; use a headless profile for pipes')
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
