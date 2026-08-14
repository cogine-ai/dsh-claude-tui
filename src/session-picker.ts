/** Claude Code-shaped startup picker over Harness's durable session-query seam. */
import { basename } from 'node:path'
import {
  CURSOR_MARKER,
  Key,
  TuiMainScreen,
  isKeyRelease,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type Terminal,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import type { Palette } from './theme.ts'
import { displayText } from './text.ts'

/** One safe, lightweight row materialized before any Agent is created. */
export interface SessionPickerEntry {
  readonly id: string
  readonly cwd?: string
  readonly title: string
  readonly createdAt: number
}

/** Deterministic values that are otherwise process globals. */
export interface SessionPickerOptions {
  readonly cwd: string
  readonly now?: () => number
  readonly signal?: AbortSignal
}

interface SessionQueryRecord {
  header: {
    id: string
    createdAt: number
    cwd?: string
    origin?: 'subagent'
  }
}

interface SessionTitleResult {
  sessionId: string
  status: 'fulfilled' | 'rejected'
  value?: { title?: { title: string } }
}

interface SessionQueryPort {
  listSessions(signal?: AbortSignal): Promise<SessionQueryRecord[]>
  readTitleSnapshots(sessionIds: readonly string[], signal?: AbortSignal): Promise<SessionTitleResult[]>
}

/** Read root conversations and their durable titles without opening any Agent. */
export async function loadSessionPickerEntries(
  ctx: Context,
  signal?: AbortSignal,
): Promise<SessionPickerEntry[]> {
  const query = (ctx as unknown as { sessionQuery?: SessionQueryPort }).sessionQuery
  if (query === undefined) throw new Error('claude-tui: Session Picker requires ctx.sessionQuery')
  const records = (await query.listSessions(signal)).filter(record => record.header.origin !== 'subagent')
  const titles = await query.readTitleSnapshots(records.map(record => record.header.id), signal)
  const titleById = new Map(titles.flatMap(result => (
    result.status === 'fulfilled' && result.value?.title?.title !== undefined
      ? [[result.sessionId, result.value.title.title] as const]
      : []
  )))
  return records.map(({ header }) => ({
    id: String(header.id),
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    title: titleById.get(header.id) ?? String(header.id),
    createdAt: header.createdAt,
  }))
}

/** One terminal-owned, cancellable picker that resolves to an exact session id. */
export class ClaudeSessionPicker implements Component, Focusable {
  focused = false
  private readonly tui: TuiMainScreen
  private readonly now: () => number
  private entries: readonly SessionPickerEntry[] = []
  private query = ''
  private showAllProjects = false
  private selected = 0
  private resolve: ((sessionId: string | undefined) => void) | undefined
  private settling = false
  private started = false
  private readonly onAbort = (): void => { this.settle(undefined) }

  constructor(
    private readonly terminal: Terminal,
    private readonly palette: Palette,
    private readonly options: SessionPickerOptions,
  ) {
    this.now = options.now ?? Date.now
    this.tui = new TuiMainScreen(terminal, true)
    this.tui.addChild(this)
    this.tui.setFocus(this)
  }

  invalidate(): void {}

  /** Render and wait for a selected durable id or an explicit cancellation. */
  run(entries: readonly SessionPickerEntry[]): Promise<string | undefined> {
    if (this.started) throw new Error('claude-tui: Session Picker cannot be started twice')
    this.started = true
    this.entries = [...entries]
    this.terminal.setTitle('claude · resume')
    if (this.options.signal?.aborted === true) return Promise.resolve(undefined)
    this.options.signal?.addEventListener('abort', this.onAbort, { once: true })
    this.tui.start()
    return new Promise(resolve => { this.resolve = resolve })
  }

  handleInput(data: string): void {
    if (this.settling || isKeyRelease(data)) return
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.settle(undefined)
      return
    }
    if (matchesKey(data, Key.ctrl('a'))) {
      this.showAllProjects = !this.showAllProjects
      this.selected = 0
      this.tui.requestRender()
      return
    }
    const visible = this.visibleEntries()
    if (matchesKey(data, Key.down)) {
      if (visible.length > 0) this.selected = (this.selected + 1) % visible.length
      this.tui.requestRender()
      return
    }
    if (matchesKey(data, Key.up)) {
      if (visible.length > 0) this.selected = (this.selected - 1 + visible.length) % visible.length
      this.tui.requestRender()
      return
    }
    if (matchesKey(data, Key.enter)) {
      const entry = visible[this.selected]
      if (entry !== undefined) this.settle(entry.id)
      return
    }
    if (matchesKey(data, Key.backspace)) {
      this.query = [...this.query].slice(0, -1).join('')
      this.selected = 0
      this.tui.requestRender()
      return
    }
    if ([...data].every(character => character >= ' ' && character !== '\u007f')) {
      this.query += data
      this.selected = 0
      this.tui.requestRender()
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(12, width)
    const entries = this.visibleEntries()
    if (this.selected >= entries.length) this.selected = Math.max(0, entries.length - 1)
    const boxInside = Math.max(1, safeWidth - 6)
    const search = this.query === '' ? '⌕ Search…' : `⌕ ${displayText(this.query)}`
    const input = truncateToWidth(` ${search}`, boxInside, '…')
    const project = this.showAllProjects ? 'All projects' : basename(this.options.cwd)
    const lines = [
      '',
      this.palette.selection('─'.repeat(safeWidth)),
      `  ${this.palette.bold(this.palette.selection('Resume session'))}`,
      this.palette.plain(`  ${this.dimBox(`╭${'─'.repeat(boxInside)}╮`)}`),
      `  ${this.dimBox('│')}${padAnsi(this.palette.dim(input), boxInside)}${this.dimBox('│')}`,
      this.palette.plain(`  ${this.dimBox(`╰${'─'.repeat(boxInside)}╯`)}`),
      this.palette.dim(`    ${displayText(project)}`),
      '',
    ]

    if (entries.length === 0) {
      lines.push(
        this.palette.dim(`   ${this.showAllProjects
          ? 'No conversations found.'
          : 'No conversations found in this project.'}`),
        this.palette.dim(`   Ctrl+A to ${this.showAllProjects ? 'show current project' : 'show all projects'}`),
      )
    } else {
      const maxItems = Math.max(1, Math.floor((this.terminal.rows - 13) / 3) + 1)
      entries.slice(0, maxItems).forEach((entry, index) => {
        const title = truncateToWidth(`${index === this.selected ? '❯' : ' '} ${displayText(entry.title)}`, safeWidth - 2, '…')
        const cursor = index === this.selected && this.focused ? CURSOR_MARKER : ''
        lines.push(`  ${cursor}${index === this.selected ? this.palette.selection(title) : this.palette.plain(title)}`)
        lines.push(this.palette.dim(`    ${this.entryMetadata(entry)}`), '')
      })
      if (lines.at(-1) === '') lines.pop()
    }

    lines.push('', ...this.helpLines(safeWidth))
    while (lines.length < this.terminal.rows) lines.push('')
    if (entries.length === 0 && this.focused) lines[this.terminal.rows - 1] = CURSOR_MARKER
    return lines.slice(0, this.terminal.rows)
  }

  /** Match project first, then a case-insensitive title/id/path query. */
  private visibleEntries(): SessionPickerEntry[] {
    const needle = this.query.toLocaleLowerCase()
    return this.entries.filter(entry => (
      (this.showAllProjects || entry.cwd === this.options.cwd)
      && (needle === '' || `${entry.title}\n${entry.id}\n${entry.cwd ?? ''}`.toLocaleLowerCase().includes(needle))
    ))
  }

  /** Harness has durable age and identity, but no Claude-only branch/byte metadata. */
  private entryMetadata(entry: SessionPickerEntry): string {
    const age = formatAge(Math.max(0, this.now() - entry.createdAt))
    const identity = entry.id.length > 18 ? `${entry.id.slice(0, 15)}…` : entry.id
    return `${age} · ${displayText(identity)}`
  }

  private helpLines(width: number): string[] {
    const help = `Ctrl+A to ${this.showAllProjects ? 'show current project' : 'show all projects'} · Type to search · Esc to cancel`
    return wrapTextWithAnsi(this.palette.dim(help), Math.max(1, width - 4))
      .map(line => `    ${line}`)
  }

  private dimBox(text: string): string {
    return this.palette.dim(text)
  }

  private settle(sessionId: string | undefined): void {
    if (this.settling) return
    this.settling = true
    void (async () => {
      try {
        await this.terminal.drainInput(100, 20)
      } finally {
        this.options.signal?.removeEventListener('abort', this.onAbort)
        this.tui.stop({ preserveScreen: true })
        this.resolve?.(sessionId)
      }
    })()
  }
}

/** Pad ANSI-styled content by visible cells, keeping the right border fixed. */
function padAnsi(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleWidth(value)))}`
}

/** Claude-like relative age without locale or wall-clock text instability. */
function formatAge(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
