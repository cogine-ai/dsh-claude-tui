/** Main-screen terminal application over one live Harness Agent. */
import { homedir } from 'node:os'
import { sep } from 'node:path'
import {
  Editor,
  Key,
  Spacer,
  TuiMainScreen,
  isKeyRelease,
  matchesKey,
  type Terminal,
  type TuiInputListenerResult,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { EncodedImageAttachment, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, errorChain, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ResolvedConfig } from './config.ts'
import type { ReadClipboardImage } from './clipboard.ts'
import { ModalQueue, askApproval, askUserQuestions } from './dialogs.ts'
import type { ListWorkspaceEntries, WorkspaceEntry } from './files.ts'
import { confirmModelSwitch, loadModelCatalog, showModelPicker } from './model-picker.ts'
import {
  loadProviderCatalog,
  showApiKeyInput,
  showProviderInfo,
  showProviderPicker,
  soleMissingCredential,
  type ProviderEntry,
} from './providers.ts'
import type { ClaudeTuiRuntimeSnapshot } from './runtime-snapshot.ts'
import { ClaudePromptEditorComponent, HeaderComponent, PromptContextComponent } from './surface.ts'
import { displayText } from './text.ts'
import { createPalette, editorTheme } from './theme.ts'
import {
  TranscriptComponent,
  TranscriptModel,
  isSubagentTool,
  subagentToolLabel,
} from './transcript.ts'

/** Process-facing effects kept replaceable for terminal integration tests. */
export interface ClaudeTuiRuntime {
  /** Raw terminal implementation. */
  terminal: Terminal
  /** Flush the owned session and request bounded process exit. */
  exit(code: number): Promise<void> | void
  /** Clock used for the double-interrupt exit gesture. */
  now?(): number
  /** Read-only workspace index used by the file-mention completion surface. */
  listWorkspaceEntries?: ListWorkspaceEntries
  /** Agent-scoped DSH selection; the loop snapshots it for the next model request. */
  modelSelection?: ModelSelectionRef
  /** Launcher-only fallback notice; rendered locally and never persisted to the Session. */
  launchNotice?: string
  /** New Sessions use Claude's expanded welcome surface; resumed Sessions stay compact. */
  welcomeExpanded?: boolean
  /** Executing TUI package version shown only in the expanded welcome identity. */
  tuiVersion?: string
  /** Launcher-verified DSH provenance; absent for direct profile launches. */
  runtimeSnapshot?: ClaudeTuiRuntimeSnapshot
  /** Desktop image clipboard boundary bound to Ctrl+V, separate from terminal text paste. */
  readClipboardImage?: ReadClipboardImage
}

/** Inline reverse-search state matching Claude Code's prompt-history surface. */
interface HistorySearchState {
  readonly draft: string
  query: string
  matches: string[]
  selected: number
}

/** Process-local live delegation state projected from Harness lifecycle events. */
interface ActiveSubagent {
  readonly runId: string
  readonly toolKey?: string
  readonly provider: string
  readonly label: string
}

/** Second-gesture boundary measured from Claude Code 2.1.227's real PTY. */
const EXIT_CONFIRMATION_WINDOW_MS = 800

/** Read one plan-mode event without requiring the optional plan package's types. */
function planModeEvent(event: unknown): boolean | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const candidate = event as { type?: unknown; data?: { active?: unknown } }
  return candidate.type === 'plan/mode' && typeof candidate.data?.active === 'boolean'
    ? candidate.data.active
    : undefined
}

/** Durable last-event-wins fold shared by initial replay and live updates. */
function foldPlanMode(events: readonly unknown[]): boolean {
  let active = false
  for (const event of events) active = planModeEvent(event) ?? active
  return active
}

const toolsModeLabels = {
  native: 'Standard',
  code: 'PTC',
  both: 'Both (Native + PTC)',
} as const

/** Keep user-home provenance concise without changing the actual DSH_HOME. */
function displayHome(path: string): string {
  const userHome = homedir()
  if (path === userHome) return '~'
  const prefix = `${userHome}${sep}`
  return path.startsWith(prefix) ? `~${sep}${path.slice(prefix.length)}` : path
}

/** Translate verified Harness semantics into the product-facing welcome vocabulary. */
function welcomeRuntime(snapshot: ClaudeTuiRuntimeSnapshot | undefined) {
  if (snapshot === undefined) return undefined
  return {
    primary: displayText(
      `Harness ${snapshot.harnessVersion} · ${snapshot.runtimeKind} · ${toolsModeLabels[snapshot.toolsMode]}`,
    ),
    secondary: displayText(`Home ${displayHome(snapshot.homePath)} · ${snapshot.homeKind}`),
  }
}

/** Mounted terminal channel and its complete interaction lifecycle. */
export class ClaudeTuiApplication {
  readonly transcript = new TranscriptModel()
  private readonly palette
  private readonly tui: TuiMainScreen
  private readonly transcriptView: TranscriptComponent
  private readonly editor: Editor
  private readonly promptEditor: ClaudePromptEditorComponent
  private readonly modalQueue = new ModalQueue()
  private readonly promptHistory: string[] = []
  private readonly interactionAbort = new AbortController()
  private readonly commandControllers = new Set<AbortController>()
  private readonly disposers: Array<() => unknown> = []
  private started = false
  private closed = false
  private lastEmptyInterrupt: number | undefined
  private lastEmptyExit: number | undefined
  private promptNotice: string | undefined
  private shutdownPromise: Promise<void> | undefined
  private exitPromise: Promise<void> | undefined
  private historySearch: HistorySearchState | undefined
  private slashSelection = 0
  private slashMenuDismissed = false
  private workspaceEntries: readonly WorkspaceEntry[] = []
  private fileSelection = 0
  private fileMenuDismissed = false
  private planModeActive = false
  private readonly activeSubagents = new Map<string, ActiveSubagent>()
  private agentsVisible = true
  private readonly pendingImages: SaveImageAttachment[] = []
  private imagePasteQueue: Promise<void> = Promise.resolve()
  private readonly imagePasteControllers = new Set<AbortController>()
  private imageSubmissionToken: symbol | undefined
  private composerGeneration = 0
  private imageCommandController: AbortController | undefined

  /** Build the component tree without touching the terminal. */
  constructor(
    private readonly ctx: Context,
    readonly agent: Agent,
    private readonly config: ResolvedConfig,
    private readonly runtime: ClaudeTuiRuntime,
  ) {
    this.transcript.replay(agent.session.events)
    if (runtime.launchNotice !== undefined) {
      this.transcript.addNotice(runtime.launchNotice, 'warning')
    }
    this.planModeActive = foldPlanMode(agent.session.events)
    for (const item of this.transcript.items) {
      if (item.kind === 'user' && item.text.trim() !== '') this.promptHistory.push(item.text)
    }
    this.palette = createPalette(config.color)
    this.tui = new TuiMainScreen(runtime.terminal, true)
    this.transcriptView = new TranscriptComponent(
      this.transcript,
      this.palette,
      config.maxTranscriptRows,
      config.maxToolOutputLines,
      config.showReasoning,
    )
    this.editor = new Editor(this.tui, editorTheme(this.palette), { paddingX: 0 })
    this.promptEditor = new ClaudePromptEditorComponent(
      this.editor,
      this.palette,
      () => this.historySearch !== undefined,
      () => this.selectedHistory(),
      () => this.pendingImages.length,
    )

    const safeTitle = displayText(config.title)
    const promptContext = new PromptContextComponent(() => {
      const slashMenu = this.slashMenuView()
      const fileMenu = this.fileMentionView()
      const historyMatch = this.selectedHistory()
      const selectedModel = this.runtime.modelSelection?.current
      return {
        status: this.agent.status,
        provider: selectedModel?.provider ?? this.transcript.provider ?? this.agent.options.provider,
        model: selectedModel?.model ?? this.transcript.model ?? this.agent.options.model,
        transcriptExpanded: this.transcriptView.transcriptExpanded,
        reasoningVisible: this.transcriptView.reasoningVisible,
        usage: this.transcript.usage,
        performance: this.transcript.performance,
        planModeActive: this.planModeActive,
        ...(this.agentsVisible && this.activeSubagents.size > 0
          ? {
              activeAgents: [...this.activeSubagents.values()].map(item => ({
                provider: item.provider,
                label: item.label,
              })),
            }
          : {}),
        ...(this.promptNotice === undefined ? {} : { notice: this.promptNotice }),
        ...(slashMenu === undefined ? {} : { slashMenu }),
        ...(fileMenu === undefined ? {} : { fileMenu }),
        ...(this.historySearch === undefined
          ? {}
          : {
              historySearch: {
                query: this.historySearch.query,
                ...(historyMatch === undefined ? {} : { match: historyMatch }),
              },
            }),
      }
    }, this.palette)
    const runtimeDetails = welcomeRuntime(this.runtime.runtimeSnapshot)
    this.tui.addChild(new HeaderComponent({
      title: safeTitle,
      ...(this.runtime.tuiVersion === undefined
        ? {}
        : { version: displayText(this.runtime.tuiVersion) }),
      sessionId: displayText(String(agent.id)),
      cwd: displayText(agent.session.header.cwd ?? process.cwd()),
      model: () => {
        const selected = this.runtime.modelSelection?.current
        if (selected === undefined) {
          return displayText(`${agent.options.provider}/${agent.options.model}`)
        }
        const effort = selected.reasoningEffort
        return displayText(
          `${selected.provider}/${selected.model}${effort === undefined ? '' : ` · ${effort}`}`,
        )
      },
      ...(runtimeDetails === undefined ? {} : { runtime: runtimeDetails }),
      expanded: () => this.runtime.welcomeExpanded === true && this.runtime.terminal.rows >= 24,
    }, this.palette))
    this.tui.addChild(new Spacer(2))
    this.tui.addChild(this.transcriptView)
    this.tui.addChild(this.promptEditor)
    this.tui.addChild(promptContext)
  }

  /** Enter raw mode, install interaction providers, and optionally submit a first prompt. */
  async start(initialPrompt?: string): Promise<void> {
    if (this.started || this.closed) throw new Error('claude-tui: terminal application cannot be started twice')
    this.installListeners()
    this.editor.onChange = () => {
      this.resetExitGesture()
      this.slashMenuDismissed = false
      this.slashSelection = 0
      this.fileMenuDismissed = false
      this.fileSelection = 0
      this.tui.requestRender()
    }
    this.editor.onSubmit = value => { this.submit(value) }
    this.tui.setFocus(this.promptEditor)
    try {
      this.tui.start()
      this.started = true
      this.loadWorkspaceEntries()
      this.runtime.terminal.setTitle(displayText(this.config.title))
      this.runtime.terminal.setProgress(this.agent.status === 'running')
      void this.beginStartup(initialPrompt)
    } catch (error: unknown) {
      await this.dispose()
      throw error
    }
  }

  /** Stop accepting input, restore the terminal, and settle pending UI work. */
  dispose(): Promise<void> {
    return (this.shutdownPromise ??= this.shutdown())
  }

  /** Request the same graceful path used by Ctrl+D and `/exit`. */
  requestExit(code = 0): Promise<void> {
    return (this.exitPromise ??= (async () => {
      let exitCode = code
      if (this.agent.status === 'running') {
        this.transcript.addNotice('Cancelling the active turn before exit…', 'warning')
        this.tui.requestRender()
        this.agent.cancel({ kind: 'user' })
        try {
          await this.agent.whenIdle()
        } catch {
          exitCode = 1
        }
      }
      try {
        await this.dispose()
      } catch {
        exitCode = 1
      }
      await this.runtime.exit(exitCode)
    })())
  }

  /** Register all live event and interaction contributions. */
  private installListeners(): void {
    this.disposers.push(this.tui.addInputListener(data => this.handleGlobalInput(data)))
    this.disposers.push(this.agent.ctx.on('session/event', (session, event) => {
      if (session !== this.agent.session || this.closed) return
      this.transcript.apply(event)
      const planMode = planModeEvent(event)
      if (planMode !== undefined) this.planModeActive = planMode
      this.tui.requestRender()
    }))
    this.disposers.push(this.agent.ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== this.agent || this.closed) return
      this.runtime.terminal.setProgress(status === 'running')
      this.tui.requestRender()
    }))
    this.disposers.push(this.agent.ctx.on('subagent/start', (info) => {
      if (this.closed) return
      const presentation = this.unclaimedSubagentPresentation()
      this.activeSubagents.set(String(info.runId), {
        runId: String(info.runId),
        ...(presentation?.toolKey === undefined ? {} : { toolKey: presentation.toolKey }),
        provider: displayText(info.provider),
        label: presentation?.label ?? displayText(String(info.id)),
      })
      this.agentsVisible = true
      this.tui.requestRender()
    }))
    this.disposers.push(this.agent.ctx.on('subagent/end', (info) => {
      if (this.closed) return
      this.activeSubagents.delete(String(info.runId))
      this.tui.requestRender()
    }))
    this.disposers.push(this.agent.ctx.on('approval/request', async (request, next) => {
      if (request.agent !== this.agent) return next()
      if (this.closed) return 'cancelled'
      return this.modalQueue.run(() => askApproval(
        this.tui,
        this.palette,
        this.approvalRequest(request),
        this.approvalPresentation(request),
      ))
    }))
    this.disposers.push(this.ctx.userQuestions.registerProvider({
      ask: (request) => {
        if (request.agent !== undefined && request.agent !== this.agent) {
          throw new Error(`claude-tui: refusing a question for unowned agent "${request.agent.id}"`)
        }
        return this.modalQueue.run(() => askUserQuestions(
          this.tui,
          this.palette,
          this.questionRequest(request),
        ))
      },
    }))
  }

  /** Fuse one approval request with terminal teardown. */
  private approvalRequest(request: ApprovalRequest): ApprovalRequest {
    return {
      ...request,
      signal: AbortSignal.any([
        this.interactionAbort.signal,
        ...request.signal === undefined ? [] : [request.signal],
      ]),
    }
  }

  /** Recover the already-presented tool arguments without widening the approval protocol. */
  private approvalPresentation(request: ApprovalRequest): { arguments?: string } {
    if (request.callId === undefined) return {}
    const callId = String(request.callId)
    const tool = this.transcript.items.find(item => item.kind === 'tool' && item.callId === callId)
    return tool === undefined || tool.kind !== 'tool' ? {} : { arguments: tool.arguments }
  }

  /** Fuse one structured-question request with terminal teardown. */
  private questionRequest(request: AskUserQuestionRequest): AskUserQuestionRequest {
    return {
      ...request,
      signal: AbortSignal.any([
        this.interactionAbort.signal,
        ...request.signal === undefined ? [] : [request.signal],
      ]),
    }
  }

  /** Match a just-started child to the oldest still-unclaimed visible delegation. */
  private unclaimedSubagentPresentation(): { toolKey: string; label: string } | undefined {
    const claimed = new Set(
      [...this.activeSubagents.values()].flatMap(item => item.toolKey === undefined ? [] : [item.toolKey]),
    )
    for (const item of this.transcript.items) {
      if (item.kind !== 'tool' || !item.pending || claimed.has(item.key) || !isSubagentTool(item)) continue
      const label = subagentToolLabel(item)
      if (label !== undefined) return { toolKey: item.key, label }
    }
    return undefined
  }

  /** Submit an editor value to a local command, Harness command, or the Agent inbox. */
  private submit(value: string): void {
    if (this.closed) return
    const text = value.trim()
    if (this.imagePasteControllers.size > 0) {
      this.promptNotice = 'Wait for the image paste to finish, then press Enter again'
      this.tui.requestRender()
      return
    }
    if (this.imageSubmissionToken !== undefined) return
    if (text === '' && this.pendingImages.length === 0) {
      this.resetExitGesture()
      return
    }
    this.resetExitGesture()
    this.editor.setText('')
    if (text.startsWith('/')) {
      this.rememberPrompt(text)
      if (!this.runLocalCommand(text)) this.runHarnessCommand(text, [...this.pendingImages])
      return
    }
    if (this.pendingImages.length > 0) {
      void this.submitImageMessage(value, text, [...this.pendingImages])
      return
    }
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      if (this.agent.status === 'running') this.agent.steer(message)
      else this.agent.followup(message)
      this.rememberPrompt(text)
    } catch (error: unknown) {
      this.transcript.addNotice(errorChain(error), 'error')
      this.tui.requestRender()
    }
  }

  /** Keep terminal and local reverse-search histories aligned after a successful dispatch. */
  private rememberPrompt(text: string): void {
    if (text === '') return
    this.editor.addToHistory(text)
    if (this.promptHistory.at(-1) !== text) this.promptHistory.push(text)
  }

  /** Persist raw clipboard bytes before publishing their references in one UserMessage. */
  private async submitImageMessage(
    draft: string,
    text: string,
    images: readonly SaveImageAttachment[],
  ): Promise<void> {
    const generation = this.composerGeneration
    const submissionToken = Symbol('image-message')
    this.imageSubmissionToken = submissionToken
    this.promptNotice = images.length === 1 ? 'Sending image…' : `Sending ${images.length} images…`
    this.tui.requestRender()
    try {
      const attachments = this.ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('claude-tui: DSH attachment service is unavailable')
      }
      const refs = await attachments.saveImages(images)
      if (this.closed || generation !== this.composerGeneration) return
      if (refs.length !== images.length) {
        throw new Error('claude-tui: DSH attachment service returned an incomplete image batch')
      }
      const content: ContentBlock[] = refs.map(attachment => ({ type: 'image', attachment }))
      if (text !== '') content.push({ type: 'text', text })
      const message = createUserMessage({ content, source: { kind: 'user' } })
      if (this.agent.status === 'running') this.agent.steer(message)
      else this.agent.followup(message)
      this.pendingImages.splice(0, images.length)
      this.rememberPrompt(text)
    } catch (error: unknown) {
      if (!this.closed && generation === this.composerGeneration) {
        if (text !== '' && this.editor.getText() === '') this.editor.setText(draft)
        this.transcript.addNotice(`Unable to send image: ${errorChain(error)}`, 'error')
      }
    } finally {
      if (this.imageSubmissionToken === submissionToken) {
        this.imageSubmissionToken = undefined
        if (!this.closed) {
          this.promptNotice = undefined
          this.tui.requestRender()
        }
      }
    }
  }

  /** Handle terminal-only commands and return whether one matched. */
  private runLocalCommand(line: string): boolean {
    const command = line.slice(1).split(/\s/u, 1)[0]?.toLowerCase()
    switch (command) {
      case 'exit':
      case 'quit':
        void this.requestExit()
        return true
      case 'help': {
        const registered = this.ctx.commands.list(this.agent)
          .map(item => `/${item.name} — ${item.description}`)
        this.transcript.addNotice([
          'Ctrl+V — paste an image; terminal text paste remains separate',
          '/model — select a live DSH model for this session',
          '/provider — inspect or update DSH provider credentials',
          '/transcript — expand or compact tool details',
          '/reasoning — show or hide reasoning blocks',
          '/exit — leave after the active turn settles',
          ...registered,
        ].join('\n'))
        this.tui.requestRender()
        return true
      }
      case 'transcript':
        this.toggleTranscript()
        return true
      case 'reasoning':
        this.transcriptView.toggleReasoning()
        this.tui.requestRender()
        return true
      case 'model':
        this.openModelPicker()
        return true
      case 'provider':
        this.openProviderPicker()
        return true
      default:
        return false
    }
  }

  /** Execute one plugin-owned slash command and render its direct outcome. */
  private runHarnessCommand(
    line: string,
    images: readonly SaveImageAttachment[] = [],
  ): void {
    const controller = new AbortController()
    this.commandControllers.add(controller)
    const encodedImages: EncodedImageAttachment[] = images.map(image => ({
      mediaType: image.mediaType,
      data: Buffer.from(image.data).toString('base64'),
      ...(image.name === undefined ? {} : { name: image.name }),
    }))
    const submissionToken = images.length > 0 ? Symbol('image-command') : undefined
    if (images.length > 0) {
      this.imageSubmissionToken = submissionToken
      this.imageCommandController = controller
      this.promptNotice = images.length === 1
        ? 'Running command with image…'
        : `Running command with ${images.length} images…`
      this.tui.requestRender()
    }
    void this.ctx.commands.execute(this.agent, line, encodedImages, controller.signal).then((execution) => {
      if (this.closed || controller.signal.aborted) return
      if (execution === undefined) {
        this.transcript.addNotice(`Unknown command: ${displayText(line.split(/\s/u, 1)[0] ?? line)}. Use /help.`, 'warning')
      } else if (execution.result.kind === 'error') {
        this.transcript.addNotice(execution.result.text, 'error')
      } else {
        if (execution.result.text !== undefined && execution.result.text !== '') {
          this.transcript.addNotice(execution.result.text)
        }
        if (images.length > 0) this.pendingImages.splice(0, images.length)
      }
      this.tui.requestRender()
    }, (error: unknown) => {
      if (this.closed || controller.signal.aborted) return
      this.transcript.addNotice(errorChain(error), 'error')
      this.tui.requestRender()
    }).finally(() => {
      this.commandControllers.delete(controller)
      if (
        submissionToken !== undefined
        && this.imageSubmissionToken === submissionToken
      ) {
        this.imageSubmissionToken = undefined
        if (this.imageCommandController === controller) this.imageCommandController = undefined
        if (!this.closed) {
          this.promptNotice = undefined
          this.tui.requestRender()
        }
      }
    })
  }

  /** Apply global Claude Code-like bindings before the editor sees input. */
  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (this.closed || isKeyRelease(data)) return undefined
    if (this.historySearch !== undefined) return this.handleHistorySearchInput(data)
    if (this.tui.hasOverlay()) return undefined
    if (matchesKey(data, Key.ctrl('v'))) {
      this.pasteClipboardImage()
      return { consume: true }
    }
    if (
      matchesKey(data, Key.backspace)
      && this.editor.getText() === ''
      && this.pendingImages.length > 0
      && this.imageSubmissionToken === undefined
    ) {
      this.pendingImages.pop()
      this.resetExitGesture()
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.runHarnessCommand(this.planModeActive ? '/plan off' : '/plan')
      return { consume: true }
    }
    if (matchesKey(data, Key.alt('p'))) {
      this.openModelPicker()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      this.startHistorySearch()
      return { consume: true }
    }
    const slashMenu = this.slashMenuView()
    if (slashMenu !== undefined) {
      const handled = this.handleSlashMenuInput(data, slashMenu)
      if (handled !== undefined) return handled
    }
    const fileMenu = this.fileMentionView()
    if (fileMenu !== undefined) {
      const handled = this.handleFileMentionInput(data, fileMenu)
      if (handled !== undefined) return handled
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      this.toggleTranscript()
      return { consume: true }
    }
    if (this.activeSubagents.size > 0 && matchesKey(data, Key.left)) {
      this.agentsVisible = !this.agentsVisible
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('l'))) {
      this.tui.invalidate()
      this.tui.requestRender(true)
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && this.agent.status === 'running') {
      this.agent.cancel({ kind: 'user' })
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      this.handleInterrupt()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (this.agent.status === 'running') {
        this.resetExitGesture()
        this.transcript.addNotice('Interrupt the active turn before exiting.', 'warning')
        this.tui.requestRender()
        return { consume: true }
      }
      if (this.editor.getText() === '' && this.pendingImages.length === 0) {
        this.handleEmptyExit()
        return { consume: true }
      }
      return undefined
    }
    return undefined
  }

  /** Queue one desktop clipboard read while preserving Ctrl+V paste order. */
  private pasteClipboardImage(): void {
    if (this.imageSubmissionToken !== undefined) {
      this.promptNotice = 'Wait for the current image submission to finish'
      this.tui.requestRender()
      return
    }
    const readImage = this.runtime.readClipboardImage
    if (readImage === undefined) {
      this.promptNotice = 'Image paste is unavailable on this platform'
      this.tui.requestRender()
      return
    }
    this.resetExitGesture()
    const controller = new AbortController()
    this.imagePasteControllers.add(controller)
    const generation = this.composerGeneration
    this.promptNotice = 'Pasting image…'
    this.tui.requestRender()
    this.imagePasteQueue = this.imagePasteQueue.then(async () => {
      try {
        const image = await readImage(AbortSignal.any([
          this.interactionAbort.signal,
          controller.signal,
        ]))
        if (this.closed || generation !== this.composerGeneration) return
        if (image === undefined) {
          this.promptNotice = 'No image found in clipboard'
          return
        }
        const limit = this.ctx.get('attachments')?.imageLimits?.maxImagesPerMessage
        if (limit !== undefined && this.pendingImages.length >= limit) {
          this.promptNotice = `A message can contain at most ${limit} images`
          return
        }
        this.pendingImages.push({
          ...image,
          data: Uint8Array.from(image.data),
        })
        this.promptNotice = undefined
      } catch {
        if (
          !this.closed
          && generation === this.composerGeneration
          && !this.interactionAbort.signal.aborted
        ) {
          this.promptNotice = 'Unable to read an image from the clipboard'
        }
      } finally {
        this.imagePasteControllers.delete(controller)
        if (!this.closed) {
          if (
            generation === this.composerGeneration
            && this.imagePasteControllers.size > 0
          ) this.promptNotice = 'Pasting image…'
          this.tui.requestRender()
        }
      }
    })
  }

  /** Current local and plugin-contributed slash suggestions for the editor token. */
  private slashMenuView(): { selected: number; items: Array<{ name: string; description: string }> } | undefined {
    if (this.slashMenuDismissed || this.historySearch !== undefined) return undefined
    const text = this.editor.getText()
    if (!/^\/[^\s]*$/u.test(text)) return undefined
    const query = text.slice(1).toLocaleLowerCase()
    const candidates = [
      { name: 'help', description: 'Show keyboard help and available commands' },
      { name: 'transcript', description: 'Expand or compact tool transcript details' },
      { name: 'reasoning', description: 'Show or hide model reasoning blocks' },
      { name: 'exit', description: 'Flush the session and leave the terminal' },
      { name: 'model', description: 'Select a live DSH model for this session' },
      { name: 'provider', description: 'Inspect or update DSH provider credentials' },
      ...this.ctx.commands.list(this.agent).map(item => ({
        name: item.name,
        description: item.description,
      })),
    ]
    const seen = new Set<string>()
    const items = candidates.filter(item => {
      const name = item.name.toLocaleLowerCase()
      if (!name.includes(query) || seen.has(name)) return false
      seen.add(name)
      return true
    })
    this.slashSelection = Math.min(this.slashSelection, Math.max(0, items.length - 1))
    return { selected: this.slashSelection, items }
  }

  /** Current workspace paths matching the trailing @ token in the editor. */
  private fileMentionView(): { selected: number; items: WorkspaceEntry[] } | undefined {
    if (this.fileMenuDismissed || this.historySearch !== undefined) return undefined
    const match = /(?:^|\s)@([^\s@]*)$/u.exec(this.editor.getText())
    if (match === null) return undefined
    const query = (match[1] ?? '').toLocaleLowerCase()
    const items = this.workspaceEntries
      .filter(item => item.path.toLocaleLowerCase().includes(query))
      .slice(0, 12)
    this.fileSelection = Math.min(this.fileSelection, Math.max(0, items.length - 1))
    return { selected: this.fileSelection, items }
  }

  /** Populate file mentions without blocking initial terminal paint. */
  private loadWorkspaceEntries(): void {
    const list = this.runtime.listWorkspaceEntries
    if (list === undefined) return
    void list(this.agent.session.header.cwd ?? process.cwd(), this.interactionAbort.signal).then((entries) => {
      if (this.closed) return
      this.workspaceEntries = entries
      this.tui.requestRender()
    }, (error: unknown) => {
      if (this.closed || this.interactionAbort.signal.aborted) return
      this.transcript.addNotice(`Unable to index workspace files: ${errorChain(error)}`, 'warning')
      this.tui.requestRender()
    })
  }

  /** Keyboard navigation and completion for the visible workspace menu. */
  private handleFileMentionInput(
    data: string,
    menu: { selected: number; items: WorkspaceEntry[] },
  ): TuiInputListenerResult {
    if (matchesKey(data, Key.escape)) {
      this.fileMenuDismissed = true
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.down)) {
      if (menu.items.length > 0) this.fileSelection = (menu.selected + 1) % menu.items.length
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.up)) {
      if (menu.items.length > 0) {
        this.fileSelection = (menu.selected - 1 + menu.items.length) % menu.items.length
      }
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) {
      const item = menu.items[menu.selected]
      if (item !== undefined) this.completeFileMention(item)
      return { consume: true }
    }
    return undefined
  }

  /** Replace only the active trailing @ token, retaining any preceding draft. */
  private completeFileMention(item: WorkspaceEntry): void {
    const value = this.editor.getText()
    const match = /(?:^|\s)@[^\s@]*$/u.exec(value)
    if (match === null) return
    const tokenOffset = match[0].startsWith('@') ? match.index : match.index + 1
    const suffix = item.directory && !item.path.endsWith('/') ? '/' : ''
    this.editor.setText(`${value.slice(0, tokenOffset)}@${item.path}${suffix} `)
    this.fileMenuDismissed = true
    this.tui.requestRender()
  }

  /** Keyboard navigation and acceptance for the visible slash suggestion list. */
  private handleSlashMenuInput(
    data: string,
    menu: { selected: number; items: Array<{ name: string; description: string }> },
  ): TuiInputListenerResult {
    if (matchesKey(data, Key.escape)) {
      this.slashMenuDismissed = true
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.down)) {
      if (menu.items.length > 0) this.slashSelection = (menu.selected + 1) % menu.items.length
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.up)) {
      if (menu.items.length > 0) {
        this.slashSelection = (menu.selected - 1 + menu.items.length) % menu.items.length
      }
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.tab)) {
      const item = menu.items[menu.selected]
      if (item !== undefined) {
        this.editor.setText(`/${item.name} `)
        this.slashMenuDismissed = true
      }
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.enter)) {
      const item = menu.items[menu.selected]
      if (item !== undefined) this.submit(`/${item.name}`)
      return { consume: true }
    }
    return undefined
  }

  /** Enter the inline reverse-search surface without mutating durable history. */
  private startHistorySearch(): void {
    this.resetExitGesture()
    const draft = this.editor.getText()
    this.editor.setText('')
    this.historySearch = {
      draft,
      query: '',
      matches: [...this.promptHistory].reverse(),
      selected: 0,
    }
    this.tui.requestRender()
  }

  /** Route keys while Ctrl+R search owns the prompt focus. */
  private handleHistorySearchInput(data: string): TuiInputListenerResult {
    const search = this.historySearch
    if (search === undefined) return undefined
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.editor.setText(search.draft)
      this.historySearch = undefined
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.enter)) {
      this.editor.setText(this.selectedHistory() ?? search.draft)
      this.historySearch = undefined
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r')) || matchesKey(data, Key.down)) {
      if (search.matches.length > 0) search.selected = (search.selected + 1) % search.matches.length
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.up)) {
      if (search.matches.length > 0) {
        search.selected = (search.selected - 1 + search.matches.length) % search.matches.length
      }
      this.tui.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.backspace)) {
      search.query = [...search.query].slice(0, -1).join('')
      this.refreshHistoryMatches(search)
      this.tui.requestRender()
      return { consume: true }
    }
    if ([...data].every(character => character >= ' ' && character !== '\u007f')) {
      search.query += data
      this.refreshHistoryMatches(search)
      this.tui.requestRender()
      return { consume: true }
    }
    return { consume: true }
  }

  /** Recompute reverse-chronological matches after editing the search query. */
  private refreshHistoryMatches(search: HistorySearchState): void {
    const needle = search.query.toLocaleLowerCase()
    search.matches = [...this.promptHistory]
      .reverse()
      .filter(prompt => prompt.toLocaleLowerCase().includes(needle))
    search.selected = 0
  }

  /** Currently selected prompt, if the query has any match. */
  private selectedHistory(): string | undefined {
    const search = this.historySearch
    if (search === undefined) return undefined
    return search.matches[search.selected]
  }

  /** Expand or compact the transcript without adding a transcript row. */
  private toggleTranscript(): void {
    this.transcriptView.toggleTranscript()
    this.tui.requestRender()
  }

  /** Open the Claude-shaped picker over DSH-owned routes, efforts, and defaults. */
  private openModelPicker(): void {
    const selection = this.runtime.modelSelection
    if (selection === undefined) {
      this.transcript.addNotice('This entry point did not expose a DSH model selection.', 'warning')
      this.tui.requestRender()
      return
    }
    void this.modalQueue.run(async () => {
      const result = await showModelPicker(
        this.tui,
        this.palette,
        async () => {
          const current = selection.current
          if (current === undefined) throw new Error('The current DSH model selection is unavailable')
          const defaultModel = this.ctx.get('agentDefaultModel')
          return loadModelCatalog(
            this.ctx,
            current,
            defaultModel?.currentSelection() ?? current,
            this.interactionAbort.signal,
          )
        },
        refresh => this.ctx.on('llm/adapters-updated', refresh),
        this.interactionAbort.signal,
      )
      if (result === undefined || this.closed) return
      const previous = selection.current
      const routeChanged = previous === undefined
        || previous.provider !== result.selection.provider
        || previous.model !== result.selection.model
      const hasAssistantOutput = this.transcript.items.some(item => item.kind === 'assistant')
      if (routeChanged && hasAssistantOutput) {
        const confirmed = await confirmModelSwitch(
          this.tui,
          this.palette,
          result.selection,
          this.interactionAbort.signal,
        )
        if (!confirmed || this.closed) return
      }

      selection.current = result.selection
      const route = `${displayText(result.selection.provider)}/${displayText(result.selection.model)}`
      if (!result.saveDefault) {
        this.promptNotice = `Using ${route} from the next model request`
        this.tui.requestRender()
        return
      }
      const defaultModel = this.ctx.get('agentDefaultModel')
      if (defaultModel === undefined) {
        this.promptNotice = `Using ${route}; DSH default service is unavailable`
        this.tui.requestRender()
        return
      }
      try {
        await defaultModel.saveSelection(result.selection)
        if (!this.closed) this.promptNotice = `Using ${route}; saved as DSH default`
      } catch (error: unknown) {
        if (!this.closed) {
          this.promptNotice = `Using ${route}; default was not saved: ${errorChain(error)}`
        }
      }
      if (!this.closed) this.tui.requestRender()
    }).catch((error: unknown) => {
      if (this.closed || this.interactionAbort.signal.aborted) return
      this.transcript.addNotice(`Unable to select model: ${errorChain(error)}`, 'error')
      this.tui.requestRender()
    })
  }

  /** Gate an invocation prompt only when DSH proves one writable credential is the sole missing route. */
  private async beginStartup(initialPrompt: string | undefined): Promise<void> {
    const prompt = initialPrompt?.trim() === '' ? undefined : initialPrompt
    if (
      this.ctx.get('llm') === undefined
      || this.ctx.get('settings') === undefined
      || this.ctx.get('credentials') === undefined
    ) {
      if (prompt !== undefined) this.submit(prompt)
      return
    }
    try {
      const target = soleMissingCredential(await loadProviderCatalog(this.ctx))
      if (target === undefined || this.closed) {
        if (prompt !== undefined && !this.closed) this.submit(prompt)
        return
      }
      const configured = await this.modalQueue.run(() => this.configureProvider(target, true))
      if (this.closed) return
      if (configured) {
        if (prompt !== undefined) this.submit(prompt)
      } else if (prompt !== undefined) {
        this.editor.setText(prompt)
        this.tui.requestRender()
      }
    } catch (error: unknown) {
      if (this.closed || this.interactionAbort.signal.aborted) return
      this.transcript.addNotice(`Unable to inspect provider credentials: ${errorChain(error)}`, 'warning')
      if (prompt !== undefined) this.submit(prompt)
      this.tui.requestRender()
    }
  }

  /** Open the provider chooser; its rows are projections of DSH service metadata. */
  private openProviderPicker(): void {
    void this.modalQueue.run(async () => {
      const entry = await showProviderPicker(
        this.tui,
        this.palette,
        () => loadProviderCatalog(this.ctx),
        (refresh) => {
          const disposers = [
            this.ctx.on('llm/adapters-updated', refresh),
            this.ctx.on('credentials/reference-updated', () => { refresh() }),
            this.ctx.on('settings/updated', () => { refresh() }),
          ]
          return () => { for (const dispose of disposers.reverse()) dispose() }
        },
        this.interactionAbort.signal,
      )
      if (entry !== undefined && !this.closed) await this.configureProvider(entry, false)
    }).catch((error: unknown) => {
      if (this.closed || this.interactionAbort.signal.aborted) return
      this.transcript.addNotice(`Unable to configure provider: ${errorChain(error)}`, 'error')
      this.tui.requestRender()
    })
  }

  /** Edit one DSH credential only when its provider reports this source as writable. */
  private async configureProvider(entry: ProviderEntry, onboarding: boolean): Promise<boolean> {
    const authentication = entry.authentication
    if (authentication.kind !== 'credential' || !authentication.info.writable) {
      await showProviderInfo(this.tui, this.palette, entry, this.interactionAbort.signal)
      return authentication.kind === 'managed'
        || (authentication.kind === 'credential' && authentication.info.configured)
    }
    const value = await showApiKeyInput(
      this.tui,
      this.palette,
      entry,
      authentication.ref,
      onboarding || !authentication.info.configured,
      this.interactionAbort.signal,
    )
    if (value === undefined) return false
    if (value === '') return authentication.info.configured
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return false
    try {
      await credentials.set(authentication.ref, value)
      if (!this.closed) {
        this.promptNotice = `${displayText(entry.name)} credential saved by DSH`
        this.tui.requestRender()
      }
      return true
    } catch {
      if (!this.closed) {
        this.transcript.addNotice(
          `Unable to save ${displayText(entry.name)} credential; DSH rejected the update. Error details are hidden to protect the key.`,
          'error',
        )
        this.tui.requestRender()
      }
      return false
    }
  }

  /** Match Claude Code's cancel, clear, then double-interrupt exit behavior. */
  private handleInterrupt(): void {
    if (this.agent.status === 'running') {
      this.resetExitGesture()
      this.agent.cancel({ kind: 'user' })
      return
    }
    if (
      this.editor.getText() !== ''
      || this.pendingImages.length > 0
      || this.imagePasteControllers.size > 0
      || this.imageSubmissionToken !== undefined
    ) {
      this.composerGeneration += 1
      for (const controller of this.imagePasteControllers) {
        controller.abort(new Error('Clipboard image paste cancelled by user'))
      }
      this.imagePasteControllers.clear()
      this.imageCommandController?.abort(new Error('Image command cancelled by user'))
      this.imageCommandController = undefined
      this.imageSubmissionToken = undefined
      this.editor.setText('')
      this.pendingImages.length = 0
      this.promptNotice = undefined
      this.resetExitGesture()
      this.tui.requestRender()
      return
    }
    const now = this.runtime.now?.() ?? Date.now()
    if (this.withinExitWindow(this.lastEmptyInterrupt, now)) {
      void this.requestExit()
      return
    }
    this.lastEmptyInterrupt = now
    this.lastEmptyExit = undefined
    this.promptNotice = 'Press Ctrl-C again to exit'
    this.tui.requestRender()
  }

  /** Require Claude Code's second Ctrl+D gesture before leaving an idle prompt. */
  private handleEmptyExit(): void {
    const now = this.runtime.now?.() ?? Date.now()
    if (this.withinExitWindow(this.lastEmptyExit, now)) {
      void this.requestExit()
      return
    }
    this.lastEmptyExit = now
    this.lastEmptyInterrupt = undefined
    this.promptNotice = 'Press Ctrl-D again to exit'
    this.tui.requestRender()
  }

  /** True only for an actual prior gesture inside the measured confirmation window. */
  private withinExitWindow(previous: number | undefined, now: number): boolean {
    if (previous === undefined) return false
    const elapsed = now - previous
    return elapsed >= 0 && elapsed <= EXIT_CONFIRMATION_WINDOW_MS
  }

  /** Clear transient exit confirmation after ordinary prompt interaction. */
  private resetExitGesture(): void {
    this.lastEmptyInterrupt = undefined
    this.lastEmptyExit = undefined
    this.promptNotice = undefined
  }

  /** Reverse every registration before releasing the raw terminal. */
  private async shutdown(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.historySearch = undefined
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    this.interactionAbort.abort(new Error('Claude-like TUI disposed'))
    for (const controller of this.commandControllers) controller.abort(new Error('Claude-like TUI disposed'))
    this.commandControllers.clear()
    await this.imagePasteQueue
    while (this.tui.hasOverlay()) this.tui.hideOverlay()
    this.runtime.terminal.setProgress(false)
    try {
      await this.runtime.terminal.drainInput(100, 20)
    } finally {
      this.tui.stop()
    }
  }
}
