/** Fixed header, prompt context, and footer components. */
import {
  CURSOR_MARKER,
  Editor,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { WorkspaceEntry } from './files.ts'
import type { ResponsePerformance, UsageTotals } from './transcript.ts'
import type { Palette } from './theme.ts'
import { displayText } from './text.ts'

/** Header values that do not belong in the durable transcript. */
export interface HeaderValues {
  title: string
  sessionId: string
  cwd: string
  model: string | (() => string)
}

/** Compact Claude-like application header. */
export class HeaderComponent implements Component {
  constructor(private readonly values: HeaderValues, private readonly palette: Palette) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const logo = [
      `${this.palette.brand(' ▐')}${this.palette.brandOnBlack('▛███▜')}${this.palette.brand('▌')}`,
      `${this.palette.brand('▝▜')}${this.palette.brandOnBlack('█████')}${this.palette.brand('▛▘')}`,
      this.palette.brand('  ▘▘ ▝▝  '),
    ]
    const first = `${logo[0]}   ${this.palette.bold(this.values.title)}`
    const model = typeof this.values.model === 'function' ? this.values.model() : this.values.model
    const second = `${logo[1]}  ${this.palette.dim(`${model} · ${this.values.sessionId}`)}`
    const thirdLeft = `${logo[2]}  ${this.palette.dim(this.values.cwd)}`
    const third = safeWidth < 48
      ? thirdLeft
      : joinHeaderBadge(thirdLeft, this.palette.dshBadge(' powered by dsh '), safeWidth)
    return ['', first, second, third].map(line => truncateToWidth(line, safeWidth, '…'))
  }
}

/** Keep the official dsh badge visible while allowing live cwd metadata to truncate. */
function joinHeaderBadge(left: string, badge: string, width: number): string {
  const badgeWidth = visibleWidth(badge)
  const leftWidth = Math.max(1, width - badgeWidth - 1)
  const safeLeft = truncateToWidth(left, leftWidth, '…')
  const gap = Math.max(1, width - visibleWidth(safeLeft) - badgeWidth)
  return `${safeLeft}${' '.repeat(gap)}${badge}`
}

/** Claude Code-shaped prompt box around the real pi-tui editor. */
export class ClaudePromptEditorComponent implements Component, Focusable {
  focused = false

  constructor(
    private readonly editor: Editor,
    private readonly palette: Palette,
    private readonly searchActive: () => boolean,
    private readonly searchValue: () => string | undefined,
  ) {}

  invalidate(): void {
    this.editor.invalidate()
  }

  handleInput(data: string): void {
    this.editor.handleInput(data)
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const prefixWidth = Math.min(2, safeWidth)
    const searching = this.searchActive()
    this.editor.focused = this.focused && !searching
    const divider = this.palette.divider('─'.repeat(safeWidth))
    if (searching) {
      const selected = displayText(this.searchValue() ?? '')
      return [divider, truncateToWidth(`❯\u00a0${selected}`, safeWidth, '…'), divider]
    }
    const editorLines = this.editor.render(Math.max(1, safeWidth - prefixWidth))
    const content = editorLines.slice(1, -1).map(trimEditorLine)
    return [
      divider,
      ...content.map((line, index) => `${index === 0 ? '❯\u00a0' : '  '}${line}`),
      divider,
    ]
  }
}

/** Live values rendered directly above the editor. */
export interface PromptContextValues {
  status: AgentStatus
  provider: string | undefined
  model: string | undefined
  transcriptExpanded: boolean
  reasoningVisible: boolean
  usage: UsageTotals
  performance: ResponsePerformance
  planModeActive: boolean
  notice?: string
  historySearch?: {
    query: string
    match?: string
  }
  slashMenu?: {
    selected: number
    items: Array<{ name: string; description: string }>
  }
  fileMenu?: {
    selected: number
    items: WorkspaceEntry[]
  }
  activeAgents?: Array<{
    provider: string
    label: string
  }>
}

/** Status line driven by Agent state and request metadata. */
export class PromptContextComponent implements Component {
  constructor(
    private readonly read: () => PromptContextValues,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.read()
    const route = state.provider === undefined || state.model === undefined
      ? 'model pending'
      : `${state.provider}/${state.model}`
    const billedInput = state.usage.inputTokens + state.usage.cacheReadTokens + state.usage.cacheWriteTokens
    const statistics = billedInput === 0 && state.usage.outputTokens === 0
      ? []
      : [
          billedInput === 0
            ? 'cache —'
            : `cache ${Math.round((state.usage.cacheReadTokens / billedInput) * 100)}%`,
          `↑${formatTokens(billedInput)} ↓${formatTokens(state.usage.outputTokens)}`,
          ...(state.performance.timeToFirstTokenMs === undefined
            ? []
            : [`TTFT ${formatDuration(state.performance.timeToFirstTokenMs)}`]),
          ...(state.performance.outputTokensPerSecond === undefined
            ? []
            : [`${state.performance.outputTokensPerSecond.toFixed(1)} tok/s`]),
        ]
    const safeWidth = Math.max(1, width)
    if (state.slashMenu !== undefined) return this.renderSlashMenu(state.slashMenu, safeWidth)
    if (state.fileMenu !== undefined) return this.renderFileMenu(state.fileMenu, safeWidth)
    if (state.historySearch !== undefined) {
      const query = displayText(state.historySearch.query)
      const label = query !== '' && state.historySearch.match === undefined
        ? 'no matching prompt:'
        : 'search prompts:'
      const search = this.palette.dim(`  ${label} ${query}`)
      const cursor = `${CURSOR_MARKER}${this.palette.reverse(' ')}`
      const context = this.palette.dim(` ⏸ ${route} · ← for agents`)
      const modes = [
        state.reasoningVisible ? 'reasoning on' : 'reasoning off',
        state.transcriptExpanded ? 'transcript expanded' : 'transcript compact',
      ].join(' · ')
      return [
        truncateToWidth(`${search}${cursor}${context}`, safeWidth, '…'),
        truncateToWidth(this.palette.dim(`  ${modes}`), safeWidth, '…'),
      ]
    }
    if (state.notice !== undefined && state.status !== 'running') {
      const left = this.palette.dim(`  ${displayText(state.notice)}`)
      const right = this.palette.dim(route)
      const modes = [
        state.reasoningVisible ? 'reasoning on' : 'reasoning off',
        state.transcriptExpanded ? 'transcript expanded' : 'transcript compact',
      ].join(' · ')
      return [
        truncateToWidth(joinSides(left, right, safeWidth), safeWidth, '…'),
        truncateToWidth(this.palette.dim(`  ${modes}`), safeWidth, '…'),
      ]
    }
    if (state.planModeActive) {
      const left = `  ${this.palette.plan('⏸ plan mode on')}${this.palette.dim(' · /plan off to leave · ← for agents')}`
      const right = this.palette.dim(route)
      const detail = state.notice === undefined
        ? this.palette.dim(`  ${route}`)
        : this.palette.dim(`  ${displayText(state.notice)} · ${route}`)
      return [
        truncateToWidth(left, safeWidth, '…'),
        truncateToWidth(detail, safeWidth, '…'),
      ]
    }
    const active = state.activeAgents ?? []
    const left = state.status === 'running'
      ? `${this.palette.warning('  ✻ Working · Esc to interrupt')}${active.length === 0 ? '' : this.palette.dim(' · ← for agents')}${state.notice === undefined ? '' : this.palette.dim(` · ${displayText(state.notice)}`)}`
      : this.palette.dim(`  ⏸ ${route} · ? for shortcuts · ← for agents`)
    const modes = [
      ...statistics,
      state.reasoningVisible ? 'reasoning on' : 'reasoning off',
      state.transcriptExpanded ? 'transcript expanded' : 'transcript compact',
    ].filter(Boolean).join(' · ')
    const rows = [
      truncateToWidth(left, safeWidth, '…'),
      truncateToWidth(this.palette.dim(`  ${modes}`), safeWidth, '…'),
    ]
    if (active.length === 0) return rows
    return [
      ...rows,
      '',
      truncateToWidth(this.palette.bold('  ⏺ main'), safeWidth, '…'),
      ...active.map(agent => truncateToWidth(
        this.palette.dim(`  ◯ ${displayText(agent.provider)}  ${displayText(agent.label)}`),
        safeWidth,
        '…',
      )),
    ]
  }

  /** Two-column command menu observed below Claude Code's prompt divider. */
  private renderSlashMenu(menu: NonNullable<PromptContextValues['slashMenu']>, width: number): string[] {
    if (menu.items.length === 0) return [this.palette.dim('  No matching commands')]
    const commandWidth = Math.min(30, Math.max(12, Math.floor(width * 0.4)))
    const descriptionWidth = Math.max(1, width - commandWidth)
    const lines: string[] = []
    menu.items.slice(0, 6).forEach((item, index) => {
      const command = truncateToWidth(`/${displayText(item.name)}`, commandWidth - 1, '…')
      const description = wrapTextWithAnsi(displayText(item.description), descriptionWidth)
      const itemLines = description.length === 0 ? [''] : description
      itemLines.forEach((detail, detailIndex) => {
        const left = detailIndex === 0 ? command.padEnd(commandWidth) : ' '.repeat(commandWidth)
        const row = truncateToWidth(`${left}${detail}`, width, '…')
        lines.push(index === menu.selected ? this.palette.selection(row) : this.palette.dim(row))
      })
    })
    return lines
  }

  /** Single-column workspace menu observed below Claude Code's @ prompt. */
  private renderFileMenu(menu: NonNullable<PromptContextValues['fileMenu']>, width: number): string[] {
    if (menu.items.length === 0) return [this.palette.dim('  No matching files')]
    return menu.items.slice(0, 12).map((item, index) => {
      const suffix = item.directory && !item.path.endsWith('/') ? '/' : ''
      const row = truncateToWidth(`+ ${displayText(item.path)}${suffix}`, width, '…')
      return index === menu.selected ? this.palette.selection(row) : this.palette.dim(row)
    })
  }
}

/** Remove renderer padding while preserving the styled cursor cell. */
function trimEditorLine(line: string): string {
  return line.replace(/ +(?=(?:\u001B\[[0-9;]*m)*$)/u, '')
}

/** Join left and right status fragments when both fit. */
function joinSides(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap < 1) return left
  return `${left}${' '.repeat(gap)}${right}`
}

/** Human-sized token count without locale-dependent formatting. */
function formatTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}

/** Compact first-token latency for one terminal status row. */
function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)}s`
  return `${Math.round(milliseconds / 1000)}s`
}
