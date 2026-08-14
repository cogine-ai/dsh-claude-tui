/** ANSI-consuming terminal used by application-level tests. */
import type { Terminal } from '@earendil-works/pi-tui'
import { Terminal as XtermTerminal } from '@xterm/headless'

/** Stable visual attributes exposed by xterm's public buffer API. */
export interface TerminalCellStyle {
  fg: string
  bg: string
  bold: boolean
  dim: boolean
  inverse: boolean
}

/** Minimal terminal emulator with controllable input and resize. */
export class HeadlessTerminal implements Terminal {
  readonly kittyProtocolActive = false
  started = 0
  stopped = 0
  drained = 0
  title = ''
  progress = false
  private readonly emulator: XtermTerminal
  private input: (data: string) => void = () => {}
  private resizeListener: () => void = () => {}
  private pending: Promise<void> = Promise.resolve()

  constructor(columns = 90, rows = 28) {
    this.emulator = new XtermTerminal({
      cols: columns,
      rows,
      scrollback: 1_000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
      logLevel: 'off',
    })
  }

  get columns(): number { return this.emulator.cols }
  get rows(): number { return this.emulator.rows }

  start(input: (data: string) => void, resize: () => void): void {
    this.started += 1
    this.input = input
    this.resizeListener = resize
  }

  stop(): void { this.stopped += 1 }

  async drainInput(): Promise<void> { this.drained += 1 }

  write(data: string): void {
    this.pending = this.pending.then(() => new Promise<void>((resolve) => {
      this.emulator.write(data, resolve)
    }))
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\u001B[${lines}B`)
    if (lines < 0) this.write(`\u001B[${-lines}A`)
  }

  hideCursor(): void { this.write('\u001B[?25l') }
  showCursor(): void { this.write('\u001B[?25h') }
  clearLine(): void { this.write('\u001B[K') }
  clearFromCursor(): void { this.write('\u001B[J') }
  clearScreen(): void { this.write('\u001B[2J\u001B[H') }
  setTitle(title: string): void { this.title = title }
  setProgress(active: boolean): void { this.progress = active }

  /** Deliver one already-split terminal input sequence. */
  send(data: string): void { this.input(data) }

  /** Resize the terminal and notify the renderer. */
  resize(columns: number, rows = this.rows): void {
    this.emulator.resize(columns, rows)
    this.resizeListener()
  }

  /** Wait for coalesced pi-tui rendering and every emulator write. */
  async settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 30))
    let observed: Promise<void>
    do {
      observed = this.pending
      await observed
    } while (observed !== this.pending)
  }

  /** Plain visible viewport after ANSI interpretation. */
  text(): string {
    return this.lines().join('\n')
  }

  /** Visible cell-grid lines for reference-frame qualification. */
  lines(): string[] {
    const buffer = this.emulator.buffer.active
    const lines: string[] = []
    for (let row = 0; row < this.rows; row++) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
    }
    return lines
  }

  /** Active terminal buffer is itself user-observable through scrollback behavior. */
  bufferType(): 'normal' | 'alternate' {
    return this.emulator.buffer.active.type
  }

  /** Hardware cursor position within the active viewport. */
  cursor(): { column: number; row: number } {
    const buffer = this.emulator.buffer.active
    return { column: buffer.cursorX, row: buffer.cursorY }
  }

  /** Read one rendered cell without depending on pi-tui component internals. */
  cellStyle(row: number, column: number): TerminalCellStyle | undefined {
    const buffer = this.emulator.buffer.active
    const cell = buffer.getLine(buffer.viewportY + row)?.getCell(column)
    if (cell === undefined) return undefined
    const color = (foreground: boolean): string => {
      const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB()
      const palette = foreground ? cell.isFgPalette() : cell.isBgPalette()
      const value = foreground ? cell.getFgColor() : cell.getBgColor()
      if (rgb) return `#${value.toString(16).padStart(6, '0')}`
      if (palette) return `ansi:${value}`
      return 'default'
    }
    return {
      fg: color(true),
      bg: color(false),
      bold: cell.isBold() !== 0,
      dim: cell.isDim() !== 0,
      inverse: cell.isInverse() !== 0,
    }
  }
}
