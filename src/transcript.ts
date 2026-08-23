/** Durable-session projection and terminal transcript rendering. */
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import { isTokenDelta, type TokenUsage } from '@deepseek-ai/dsh-llm'
import {
  isReplacementSurfaceEvent,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import { contentText, displayText, imageLabels, prettyArguments } from './text.ts'
import { markdownTheme, type Palette } from './theme.ts'

/** Transcript nodes shown to the human. */
export type TranscriptItem =
  | UserItem
  | AssistantItem
  | ToolItem
  | NoticeItem
  | CompletionItem

interface BaseItem {
  readonly key: string
  revision: number
}

/** One direct human prompt. */
export interface UserItem extends BaseItem {
  readonly kind: 'user'
  text: string
  imageCount: number
}

/** One model step, including its in-flight deltas. */
export interface AssistantItem extends BaseItem {
  readonly kind: 'assistant'
  readonly turn: number
  readonly step: number
  text: string
  reasoning: string
  pending: boolean
}

/** One tool invocation and its eventual result. */
export interface ToolItem extends BaseItem {
  readonly kind: 'tool'
  readonly callId: string
  name: string
  arguments: string
  result?: string
  error: boolean
  pending: boolean
}

/** Terminal-local or lifecycle notice. */
export interface NoticeItem extends BaseItem {
  readonly kind: 'notice'
  text: string
  tone: 'info' | 'warning' | 'error'
}

/** Stable host-owned turn completion row; Claude's rotating verb is intentionally normalized. */
export interface CompletionItem extends BaseItem {
  readonly kind: 'completion'
  seconds: number
}

/** Token totals accumulated over completed model messages. */
export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Timing for the most recently completed model response. */
export interface ResponsePerformance {
  timeToFirstTokenMs: number | undefined
  outputTokensPerSecond: number | undefined
}

/** Mutable projection of one append-only Session log. */
export class TranscriptModel {
  readonly items: TranscriptItem[] = []
  readonly usage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  readonly performance: ResponsePerformance = {
    timeToFirstTokenMs: undefined,
    outputTokensPerSecond: undefined,
  }
  provider: string | undefined
  model: string | undefined
  private readonly assistantByStep = new Map<string, AssistantItem>()
  private readonly toolByCall = new Map<string, ToolItem>()
  private readonly turnStartedAt = new Map<number, number>()
  private readonly stepStartedAt = new Map<string, number>()
  private readonly firstOutputAtByStep = new Map<string, number>()
  private readonly outputChunkTimes = new Map<number, number>()
  private localNoticeSequence = 0

  /** Rebuild from persisted history before listening for new events. */
  replay(events: readonly SessionEvent[]): void {
    this.items.length = 0
    this.assistantByStep.clear()
    this.toolByCall.clear()
    this.turnStartedAt.clear()
    this.stepStartedAt.clear()
    this.firstOutputAtByStep.clear()
    this.outputChunkTimes.clear()
    this.usage.inputTokens = 0
    this.usage.outputTokens = 0
    this.usage.cacheReadTokens = 0
    this.usage.cacheWriteTokens = 0
    this.performance.timeToFirstTokenMs = undefined
    this.performance.outputTokensPerSecond = undefined
    this.provider = undefined
    this.model = undefined
    for (const event of events) this.apply(event)
  }

  /** Fold one newly committed Session event into the terminal projection. */
  apply(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start': {
        this.turnStartedAt.set(event.data.turn, event.time)
        return
      }
      case 'user/message': {
        if (isReplacementSurfaceEvent(event)) return
        const source = event.data.source
        if (source.kind === 'user') {
          this.items.push({
            kind: 'user',
            key: `event-${event.seq}`,
            revision: 0,
            text: contentText(event.data.content, 'text'),
            imageCount: event.data.content.filter(block => block.type === 'image').length,
          })
        } else if (source.kind === 'plugin' && source.form === 'notice') {
          this.items.push({
            kind: 'notice',
            key: `event-${event.seq}`,
            revision: 0,
            text: displayText(source.summary),
            tone: 'info',
          })
        }
        return
      }
      case 'step/start': {
        this.stepStartedAt.set(stepKey(event.data.turn, event.data.step), event.time)
        return
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (isTokenDelta(chunk)) {
          const key = stepKey(event.data.turn, event.data.step)
          this.outputChunkTimes.set(event.seq, event.time)
          if (!this.firstOutputAtByStep.has(key)) this.firstOutputAtByStep.set(key, event.time)
        }
        if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return
        const assistant = this.assistant(event.data.turn, event.data.step)
        if (chunk.type === 'text-delta') assistant.text += displayText(chunk.text)
        if (chunk.type === 'reasoning-delta') assistant.reasoning += displayText(chunk.text)
        assistant.revision += 1
        return
      }
      case 'assistant/message': {
        this.recordUsage(event.data.usage)
        this.recordPerformance(event)
        if (isReplacementSurfaceEvent(event)) return
        const assistant = this.assistant(event.data.turn, event.data.step)
        assistant.text = contentText(event.data.message.content, 'text')
        assistant.reasoning = contentText(event.data.message.content, 'reasoning')
        assistant.pending = false
        assistant.revision += 1
        return
      }
      case 'step/end': {
        const key = stepKey(event.data.turn, event.data.step)
        this.stepStartedAt.delete(key)
        this.firstOutputAtByStep.delete(key)
        this.outputChunkTimes.clear()
        return
      }
      case 'tool/call': {
        const key = String(event.data.callId)
        let tool = this.toolByCall.get(key)
        if (tool === undefined) {
          tool = {
            kind: 'tool',
            key: `tool-${key}`,
            revision: 0,
            callId: key,
            name: displayText(event.data.name),
            arguments: prettyArguments(event.data.arguments),
            error: false,
            pending: true,
          }
          this.toolByCall.set(key, tool)
          this.items.push(tool)
        } else {
          tool.name = displayText(event.data.name)
          tool.arguments = prettyArguments(event.data.arguments)
          tool.revision += 1
        }
        return
      }
      case 'tool/result': {
        if (isReplacementSurfaceEvent(event)) return
        const key = String(event.data.message.source.callId)
        const tool = this.toolByCall.get(key)
        if (tool === undefined) {
          const orphan: ToolItem = {
            kind: 'tool',
            key: `tool-${key}`,
            revision: 0,
            callId: key,
            name: 'tool',
            arguments: '',
            result: contentText(event.data.message.content, 'tool-result'),
            error: event.data.error !== undefined,
            pending: false,
          }
          this.toolByCall.set(key, orphan)
          this.items.push(orphan)
          return
        }
        tool.result = contentText(event.data.message.content, 'tool-result')
        tool.error = event.data.error !== undefined
        tool.pending = false
        tool.revision += 1
        return
      }
      case 'request/header': {
        this.provider = event.data.header.config.provider
        this.model = event.data.header.config.model
        return
      }
      case 'turn/end': {
        this.finishAssistants(event.data.turn)
        const notice = turnNotice(event.data.reason)
        if (notice !== undefined) this.addNotice(notice.text, notice.tone)
        const startedAt = this.turnStartedAt.get(event.data.turn) ?? event.time
        this.items.push({
          kind: 'completion',
          key: `completion-${event.seq}`,
          revision: 0,
          seconds: Math.max(0, Math.floor((event.time - startedAt) / 1000)),
        })
        this.turnStartedAt.delete(event.data.turn)
        return
      }
      default:
        return
    }
  }

  /** Add terminal-only feedback without mutating the Session log. */
  addNotice(text: string, tone: NoticeItem['tone'] = 'info'): void {
    this.localNoticeSequence += 1
    this.items.push({
      kind: 'notice',
      key: `local-${this.localNoticeSequence}`,
      revision: 0,
      text: displayText(text),
      tone,
    })
  }

  private assistant(turn: number, step: number): AssistantItem {
    const key = `${turn}:${step}`
    let item = this.assistantByStep.get(key)
    if (item !== undefined) return item
    item = {
      kind: 'assistant',
      key: `assistant-${key}`,
      revision: 0,
      turn,
      step,
      text: '',
      reasoning: '',
      pending: true,
    }
    this.assistantByStep.set(key, item)
    this.items.push(item)
    return item
  }

  private recordUsage(usage: TokenUsage | undefined): void {
    if (usage === undefined) return
    this.usage.inputTokens += usage.inputTokens
    this.usage.outputTokens += usage.outputTokens
    this.usage.cacheReadTokens += usage.cacheReadTokens ?? 0
    this.usage.cacheWriteTokens += usage.cacheWriteTokens ?? 0
  }

  /** Derive latest response latency from durable step and raw-chunk timestamps. */
  private recordPerformance(event: SessionEvent<'assistant/message'>): void {
    const key = stepKey(event.data.turn, event.data.step)
    const referencedTimes = event.sourceEventSeqs
      ?.map(seq => this.outputChunkTimes.get(seq))
      .filter((time): time is number => time !== undefined)
    const firstOutputAt = referencedTimes !== undefined && referencedTimes.length > 0
      ? Math.min(...referencedTimes)
      : this.firstOutputAtByStep.get(key)
    const startedAt = this.stepStartedAt.get(key)
    this.performance.timeToFirstTokenMs = startedAt === undefined || firstOutputAt === undefined
      ? undefined
      : Math.max(0, firstOutputAt - startedAt)

    const outputTokens = event.data.usage?.outputTokens
    const generationMs = firstOutputAt === undefined ? undefined : event.time - firstOutputAt
    this.performance.outputTokensPerSecond = outputTokens === undefined
      || outputTokens <= 0
      || generationMs === undefined
      || generationMs <= 0
      ? undefined
      : outputTokens / (generationMs / 1000)

    this.outputChunkTimes.clear()
    this.firstOutputAtByStep.delete(key)
  }

  /** A finish-only provider chunk must not leave a permanent working spinner. */
  private finishAssistants(turn: number): void {
    for (const [key, assistant] of this.assistantByStep) {
      if (assistant.turn !== turn || !assistant.pending) continue
      assistant.pending = false
      assistant.revision += 1
      if (assistant.text !== '' || assistant.reasoning !== '') continue
      this.assistantByStep.delete(key)
      const index = this.items.indexOf(assistant)
      if (index >= 0) this.items.splice(index, 1)
    }
  }
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/** Human-readable non-success turn outcome. */
function turnNotice(reason: TurnEndReason): { text: string; tone: NoticeItem['tone'] } | undefined {
  switch (reason.kind) {
    case 'completed':
      return undefined
    case 'aborted':
      return { text: 'Interrupted by user.', tone: 'warning' }
    case 'blocked':
      return { text: 'The turn was blocked.', tone: 'warning' }
    case 'error':
      return { text: `${reason.error.code}: ${reason.error.message}`, tone: 'error' }
    case 'max-tokens':
      return { text: 'The model reached its output-token limit.', tone: 'warning' }
    case 'interrupted':
      return { text: 'Recovered a turn interrupted by an earlier process exit.', tone: 'warning' }
    default:
      return { text: `Turn ended: ${displayText(JSON.stringify(reason))}`, tone: 'warning' }
  }
}

/** Width-aware transcript renderer over {@link TranscriptModel}. */
export class TranscriptComponent implements Component {
  private showReasoning: boolean
  private toolsExpanded = false

  constructor(
    private readonly state: TranscriptModel,
    private readonly palette: Palette,
    private readonly maxRows: number,
    private readonly maxToolOutputLines: number,
    showReasoning: boolean,
  ) {
    this.showReasoning = showReasoning
  }

  /** Whether the transcript currently shows complete tool results. */
  get transcriptExpanded(): boolean {
    return this.toolsExpanded
  }

  /** Whether model reasoning blocks are currently visible. */
  get reasoningVisible(): boolean {
    return this.showReasoning
  }

  /** Toggle Claude Code's compact versus expanded transcript presentation. */
  toggleTranscript(): boolean {
    this.toolsExpanded = !this.toolsExpanded
    return this.toolsExpanded
  }

  /** Toggle reasoning-block visibility. */
  toggleReasoning(): boolean {
    this.showReasoning = !this.showReasoning
    return this.showReasoning
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines: string[] = []
    let previous: TranscriptItem | undefined
    for (const item of this.state.items) {
      const rendered = this.renderItem(item, safeWidth)
      if (rendered.length === 0) continue
      if (previous !== undefined && separateItems(previous, item)) lines.push('')
      lines.push(...rendered)
      previous = item
    }
    const bounded = lines.length <= this.maxRows ? lines : lines.slice(lines.length - this.maxRows)
    const rendered = bounded.map(line => truncateToWidth(line, safeWidth, '…'))
    return rendered.length === 0 ? rendered : [...rendered, '']
  }

  private renderItem(item: TranscriptItem, width: number): string[] {
    switch (item.kind) {
      case 'user':
        return this.renderUser(item, width)
      case 'assistant': {
        const lines: string[] = []
        if (this.showReasoning && item.reasoning !== '') {
          lines.push(this.palette.dim('Thinking'))
          lines.push(...wrapTextWithAnsi(this.palette.dim(this.palette.italic(item.reasoning)), width))
        }
        if (item.text !== '') {
          const markdown = new Markdown(item.text, 0, 0, markdownTheme(this.palette))
          const rendered = markdown.render(Math.max(1, width - 2)).map(trimRenderedLine)
          const first = rendered[0]
          if (first !== undefined) {
            lines.push(
              `${this.palette.questionText('⏺')} ${first}`,
              ...rendered.slice(1).map(line => `  ${line}`),
            )
          }
        }
        if (item.pending) {
          if (lines.length > 0) lines.push('')
          lines.push(this.palette.brand('✢ Working…'))
        }
        return lines
      }
      case 'tool': {
        if (isSubagentTool(item)) return this.renderSubagentTool(item, width)
        const glyph = item.pending ? this.palette.dim('⏺') : item.error ? this.palette.error('⏺') : this.palette.success('⏺')
        const summary = toolArgumentSummary(item.arguments, item.name)
        const title = `${glyph} ${this.palette.bold(item.name)}${summary === undefined ? '' : `(${summary})`}`
        const lines = [title]
        if (summary === undefined && meaningfulArguments(item.arguments)) {
          const argumentsLines = wrapTextWithAnsi(this.palette.dim(item.arguments), Math.max(1, width - 2))
          lines.push(...argumentsLines.map(line => `  ${line}`))
        }
        if (item.pending) lines.push(this.palette.dim('  ⎿ \u00a0Waiting…'))
        if (item.result !== undefined && item.result !== '') {
          const all = wrapTextWithAnsi(this.palette.dim(item.result), Math.max(1, width - 2))
          const resultLines = this.toolsExpanded ? all : collapseLines(all, this.maxToolOutputLines)
          lines.push(...resultLines.map(line => `${this.palette.dim('  ⎿ \u00a0')}${line}`))
        }
        return lines
      }
      case 'notice': {
        if (item.tone === 'error') {
          return wrapTextWithAnsi(item.text, Math.max(1, width - 5)).map(line => (
            `${this.palette.dim('  ⎿ \u00a0')}${this.palette.error(line)}`
          ))
        }
        const paint = item.tone === 'warning' ? this.palette.warning : this.palette.dim
        return wrapTextWithAnsi(paint(item.text), width)
      }
      case 'completion':
        return [this.palette.dim(`✻ Worked for ${item.seconds}s`)]
    }
  }

  /** Full-width gray prompt block captured from Claude Code's committed input row. */
  private renderUser(item: UserItem, width: number): string[] {
    const visible = [imageLabels(item.imageCount), item.text].filter(value => value !== '').join(' ')
    const rows = wrapTextWithAnsi(visible, Math.max(1, width - 2))
    return (rows.length === 0 ? [''] : rows).map((row, index) => {
      const prefix = index === 0 ? '❯ ' : '  '
      const fill = ' '.repeat(Math.max(0, width - 2 - visibleWidth(row)))
      return `${this.palette.userPromptPrefix(prefix)}${this.palette.userPromptText(row)}${this.palette.userPromptFill(fill)}`
    })
  }

  /** Claude-shaped delegation row without fabricating proprietary child metrics. */
  private renderSubagentTool(item: ToolItem, width: number): string[] {
    const label = subagentToolLabel(item) ?? displayText(item.name)
    if (item.pending) {
      return [
        `${this.palette.dim(' ')} ${this.palette.bold('Agent')}(${label})`,
        this.palette.dim('  ⎿ \u00a0Initializing…'),
      ]
    }

    const glyph = item.error ? this.palette.error('⏺') : this.palette.success('⏺')
    const title = `${glyph} ${this.palette.bold('Agent')}(${label})`
    if (item.error) {
      const result = item.result ?? 'Subagent failed.'
      return [
        title,
        ...wrapTextWithAnsi(this.palette.error(result), Math.max(1, width - 5))
          .map(line => `${this.palette.dim('  ⎿ \u00a0')}${line}`),
      ]
    }
    if (isBackgroundSubagent(item)) {
      return [
        title,
        this.palette.dim('  ⎿ \u00a0Backgrounded agent (← for agents · ctrl+o to expand)'),
      ]
    }

    const lines = [
      title,
      this.palette.dim('  ⎿ \u00a0Done'),
      this.palette.dim('  (ctrl+o to expand)'),
    ]
    if (this.toolsExpanded && item.result !== undefined && item.result !== '') {
      const output = wrapTextWithAnsi(this.palette.dim(item.result), Math.max(1, width - 5))
      lines.push(...output.map(line => `${this.palette.dim('  ⎿ \u00a0')}${line}`))
    }
    return lines
  }
}

/** Claude visually binds failures to their prompt, but separates the final timing row. */
function separateItems(previous: TranscriptItem, current: TranscriptItem): boolean {
  if (current.kind === 'completion' || current.kind === 'user') return true
  if ((current.kind === 'assistant' || current.kind === 'tool') && previous.kind === 'user') return true
  if (current.kind === 'assistant' && previous.kind === 'tool') return true
  return false
}

/** Claude keeps a tool's primary target inline instead of expanding common argument objects. */
function toolArgumentSummary(argumentsText: string, toolName: string): string | undefined {
  try {
    const value = JSON.parse(argumentsText) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (isSubagentToolName(toolName) && typeof record.description === 'string' && record.description !== '') {
      return displayText(record.description).replaceAll('\n', ' ')
    }
    for (const key of ['command', 'file_path', 'path', 'query', 'pattern', 'url']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate !== '') {
        return displayText(candidate).replaceAll('\n', ' ')
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Default Harness delegation tools map to Claude's Agent presentation. */
function isSubagentToolName(name: string): boolean {
  const normalized = name.toLocaleLowerCase().replaceAll('-', '_')
  return normalized === 'agent' || normalized === 'subagent' || normalized === 'subagent_fork'
}

/** Whether one projected tool is a supported delegation surface. */
export function isSubagentTool(item: ToolItem): boolean {
  return isSubagentToolName(item.name)
}

/** Human display label from the model's delegation arguments. */
export function subagentToolLabel(item: ToolItem): string | undefined {
  if (!isSubagentTool(item)) return undefined
  return toolArgumentSummary(item.arguments, item.name)
}

/** Background outcomes are explicit in both Harness's call and canonical result. */
function isBackgroundSubagent(item: ToolItem): boolean {
  const result = item.result?.trim().toLocaleLowerCase() ?? ''
  if (result.startsWith('started background subagent task ') || result.startsWith('started subagent ')) {
    return true
  }
  try {
    const value = JSON.parse(item.arguments) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      && (value as Record<string, unknown>).run_in_background === true
  } catch {
    return false
  }
}

/** Empty objects carry no useful visual detail beneath a tool heading. */
function meaningfulArguments(argumentsText: string): boolean {
  return argumentsText.trim() !== '' && argumentsText.trim() !== '{}'
}

/** Markdown pads rows to its render width; Claude leaves untouched terminal cells blank. */
function trimRenderedLine(line: string): string {
  return line.replace(/ +(?=(?:\u001B\[[0-9;]*m)*$)/u, '')
}

/** Keep the beginning and end of a long tool result. */
function collapseLines(lines: readonly string[], maximum: number): string[] {
  if (lines.length <= maximum) return [...lines]
  const head = Math.ceil(maximum / 2)
  const tail = Math.floor(maximum / 2)
  return [
    ...lines.slice(0, head),
    `… ${lines.length - maximum} lines hidden · Ctrl+O to expand …`,
    ...lines.slice(lines.length - tail),
  ]
}
