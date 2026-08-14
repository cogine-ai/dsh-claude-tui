/** Modal approval and question dialogs over pi-tui overlays. */
import {
  CURSOR_MARKER,
  Editor,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type OverlayHandle,
  type TUI,
} from '@earendil-works/pi-tui'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { displayText } from './text.ts'
import { editorTheme, type Palette } from './theme.ts'

/** Already-streamed tool detail attached to an approval by call id. */
export interface ApprovalPresentation {
  arguments?: string
}

/** Serialize terminal modals so approval and question requests never overlap. */
export class ModalQueue {
  private tail: Promise<void> = Promise.resolve()

  /** Run one modal after all earlier work settles. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Ask whether one pending tool action may run. */
export async function askApproval(
  tui: TUI,
  palette: Palette,
  request: ApprovalRequest,
  presentation: ApprovalPresentation = {},
): Promise<ApprovalOutcome> {
  const choice = await showApproval(tui, palette, request, presentation)
  if (request.signal?.aborted === true) return 'cancelled'
  if (choice === 'allow') return 'allowed-once'
  if (choice === 'reject') return 'rejected'
  return 'cancelled'
}

type ApprovalChoice = 'allow' | 'reject'

/** Claude-shaped approval panel over Harness's deliberately smaller outcome vocabulary. */
class ApprovalDialog implements Component, Focusable {
  focused = false
  selected: ApprovalChoice = 'allow'
  onSubmit?: (choice: ApprovalChoice) => void
  onCancel?: () => void

  constructor(
    private readonly request: ApprovalRequest,
    private readonly presentation: ApprovalPresentation,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.selected = this.selected === 'allow' ? 'reject' : 'allow'
      return
    }
    if (matchesKey(data, '1')) {
      this.onSubmit?.('allow')
      return
    }
    if (matchesKey(data, '3')) {
      this.onSubmit?.('reject')
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.onSubmit?.(this.selected)
      return
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.onCancel?.()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const details = approvalDetails(this.request, this.presentation)
    return [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold(this.palette.selection(approvalHeading(this.request.toolName)))}`, safeWidth, '…'),
      '',
      detailRow(details.primary, safeWidth, this.palette.plain),
      detailRow(details.secondary, safeWidth, this.palette.dim),
      '',
      truncateToWidth(' Do you want to proceed?', safeWidth, '…'),
      this.optionRow('allow', '1.', 'Yes', safeWidth),
      truncateToWidth(`   ${this.palette.dim('2. Always allow is unavailable in Harness')}`, safeWidth, '…'),
      this.optionRow('reject', '3.', 'No', safeWidth),
      '',
      truncateToWidth(` ${this.palette.dim('Esc to cancel · 1/3 to choose')}`, safeWidth, '…'),
    ]
  }

  private optionRow(choice: ApprovalChoice, number: string, label: string, width: number): string {
    const selected = this.selected === choice
    const cursor = selected && this.focused ? CURSOR_MARKER : ''
    const arrow = selected ? this.palette.selection('❯') : ' '
    const text = selected ? this.palette.selection(label) : label
    return truncateToWidth(` ${cursor}${arrow} ${this.palette.dim(number)} ${text}`, width, '…')
  }
}

/** Resolve one full-width, bottom-anchored approval surface. */
async function showApproval(
  tui: TUI,
  palette: Palette,
  request: ApprovalRequest,
  presentation: ApprovalPresentation,
): Promise<ApprovalChoice | undefined> {
  if (request.signal?.aborted === true) return undefined
  return await new Promise<ApprovalChoice | undefined>((resolve) => {
    const dialog = new ApprovalDialog(request, presentation, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: ApprovalChoice | undefined): void => {
      if (settled) return
      settled = true
      request.signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(undefined) }
    dialog.onSubmit = settle
    dialog.onCancel = () => { settle(undefined) }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, {
      width: '100%',
      maxHeight: '100%',
      anchor: 'bottom-left',
      margin: { bottom: 2 },
    })
  })
}

/** Tool-family wording captured from Claude's approval heading. */
function approvalHeading(toolName: string): string {
  const safeName = displayText(toolName)
  return safeName.toLowerCase() === 'bash' ? 'Bash command' : `${safeName} action`
}

/** Prefer the target already visible in a tool call; the reason remains secondary context. */
function approvalDetails(
  request: ApprovalRequest,
  presentation: ApprovalPresentation,
): { primary: string; secondary: string } {
  let primary = displayText(request.toolName)
  let secondary = request.reason === undefined ? '' : displayText(request.reason)
  try {
    const parsed = presentation.arguments === undefined
      ? undefined
      : JSON.parse(presentation.arguments) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      for (const key of ['command', 'file_path', 'path', 'query', 'pattern', 'url']) {
        const candidate = record[key]
        if (typeof candidate === 'string' && candidate !== '') {
          primary = displayText(candidate).replaceAll('\n', ' ')
          break
        }
      }
      if (typeof record.description === 'string' && record.description !== '') {
        secondary = displayText(record.description).replaceAll('\n', ' ')
      }
    }
  } catch {
    // Invalid model JSON is already rendered safely by the transcript; keep request metadata here.
  }
  return { primary, secondary }
}

/** Fixed-height detail rows preserve the captured choice and hardware-cursor geometry. */
function detailRow(text: string, width: number, paint: (value: string) => string): string {
  return truncateToWidth(`   ${paint(text)}`, width, '…')
}

/** Collect structured answers for every question in one request. */
export async function askUserQuestions(
  tui: TUI,
  palette: Palette,
  request: AskUserQuestionRequest,
): Promise<AskUserQuestionAnswer> {
  const answers: AskUserQuestionAnswer['answers'][number][] = []
  for (const question of request.questions) {
    if (request.signal?.aborted === true) throw new Error('ask_user_question was interrupted before the user answered')
    answers.push(await askQuestion(tui, palette, question, request.signal))
  }
  return { answers }
}

/** Resolve one single- or multi-select question, including custom text. */
async function askQuestion(
  tui: TUI,
  palette: Palette,
  question: AskUserQuestionItem,
  signal: AbortSignal | undefined,
): Promise<AskUserQuestionAnswer['answers'][number]> {
  const options = question.options ?? []
  if (options.length === 0) {
    const custom = await showText(tui, palette, {
      title: displayText(question.question),
      ...(question.detail === undefined ? {} : { detail: displayText(question.detail) }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (custom === undefined) throw new Error('ask_user_question was interrupted before the user answered')
    return { id: question.id, selected: [], custom }
  }

  if (question.multiSelect === true) {
    const selection = await showMultiSelect(tui, palette, {
      title: displayText(question.question),
      ...(question.detail === undefined ? {} : { detail: displayText(question.detail) }),
      options: options.map(option => ({
        label: displayText(option.label),
        ...(option.description === undefined ? {} : { description: displayText(option.description) }),
      })),
      ...(signal === undefined ? {} : { signal }),
    })
    if (selection === undefined) throw new Error('ask_user_question was interrupted before the user answered')
    return { id: question.id, selected: selection }
  }

  const choice = await showSingleQuestion(tui, palette, question, signal)
  if (choice === undefined) throw new Error('ask_user_question was interrupted before the user answered')
  if (choice.kind === 'option') {
    const selected = options[choice.index]
    if (selected === undefined) throw new Error('question selection no longer exists')
    return { id: question.id, selected: [selected.label] }
  }
  const custom = await showText(tui, palette, {
    title: choice.kind === 'chat' ? 'Chat about this' : 'Type something',
    detail: displayText(question.question),
    ...(signal === undefined ? {} : { signal }),
  })
  if (custom === undefined) throw new Error('ask_user_question was interrupted before the user answered')
  return { id: question.id, selected: [], custom }
}

type SingleQuestionChoice =
  | { kind: 'option'; index: number }
  | { kind: 'custom' }
  | { kind: 'chat' }

/** Full-width Claude question surface, including custom-answer and chat paths. */
class SingleQuestionDialog implements Component, Focusable {
  focused = false
  selectedIndex = 0
  onSubmit?: (choice: SingleQuestionChoice) => void
  onCancel?: () => void

  constructor(
    private readonly question: AskUserQuestionItem,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    const itemCount = (this.question.options?.length ?? 0) + 2
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = this.selectedIndex === 0 ? itemCount - 1 : this.selectedIndex - 1
      return
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = (this.selectedIndex + 1) % itemCount
      return
    }
    const direct = /^[1-9]$/u.test(data) ? Number(data) - 1 : -1
    if (direct >= 0 && direct < itemCount) {
      this.onSubmit?.(this.choice(direct))
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.onSubmit?.(this.choice(this.selectedIndex))
      return
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.onCancel?.()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const options = this.question.options ?? []
    const header = displayText(this.question.header ?? 'Question')
    const lines = [
      this.palette.dim('─'.repeat(safeWidth)),
      this.palette.selectionTab(` ☐ ${header} `),
      '',
      this.palette.bold(this.palette.questionText(displayText(this.question.question))),
      '',
    ]
    options.forEach((option, index) => {
      lines.push(this.optionRow(index, `${index + 1}.`, displayText(option.label), safeWidth))
      lines.push(truncateToWidth(
        `     ${this.palette.dim(displayText(option.description ?? ''))}`,
        safeWidth,
        '…',
      ))
    })
    const customIndex = options.length
    lines.push(this.optionRow(customIndex, `${customIndex + 1}.`, 'Type something.', safeWidth, true))
    lines.push(this.palette.dim('─'.repeat(safeWidth)))
    const chatIndex = customIndex + 1
    lines.push(this.optionRow(chatIndex, `${chatIndex + 1}.`, 'Chat about this', safeWidth))
    lines.push('', this.palette.dim('Enter to select · ↑/↓ to navigate · Esc to cancel'))
    return lines.map(line => truncateToWidth(line, safeWidth, '…'))
  }

  private choice(index: number): SingleQuestionChoice {
    const optionCount = this.question.options?.length ?? 0
    if (index < optionCount) return { kind: 'option', index }
    return index === optionCount ? { kind: 'custom' } : { kind: 'chat' }
  }

  private optionRow(index: number, number: string, label: string, width: number, allDim = false): string {
    const selected = index === this.selectedIndex
    const cursor = selected && this.focused ? CURSOR_MARKER : ''
    const arrow = selected ? this.palette.selection('❯') : ' '
    const optionNumber = this.palette.dim(number)
    const optionLabel = allDim
      ? this.palette.dim(label)
      : selected ? this.palette.selection(label) : label
    return truncateToWidth(`${cursor}${arrow} ${optionNumber} ${optionLabel}`, width, '…')
  }
}

/** Show one captured-layout question and resolve its navigation result. */
async function showSingleQuestion(
  tui: TUI,
  palette: Palette,
  question: AskUserQuestionItem,
  signal: AbortSignal | undefined,
): Promise<SingleQuestionChoice | undefined> {
  if (signal?.aborted === true) return undefined
  return await new Promise<SingleQuestionChoice | undefined>((resolve) => {
    const dialog = new SingleQuestionDialog(question, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: SingleQuestionChoice | undefined): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(undefined) }
    dialog.onSubmit = settle
    dialog.onCancel = () => { settle(undefined) }
    signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, {
      width: '100%',
      maxHeight: '100%',
      anchor: 'bottom-left',
      margin: { bottom: 4 },
    })
  })
}

interface TextOptions {
  title: string
  detail?: string
  signal?: AbortSignal
}

/** Focus-carrying editor used for custom question answers. */
class TextDialog implements Component, Focusable {
  focused = false
  readonly editor: Editor
  onCancel?: () => void

  constructor(tui: TUI, private readonly options: TextOptions, private readonly palette: Palette) {
    this.editor = new Editor(tui, editorTheme(palette), { paddingX: 1 })
  }

  invalidate(): void {
    this.editor.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.()
      return
    }
    this.editor.handleInput(data)
  }

  render(width: number): string[] {
    this.editor.focused = this.focused
    const safeWidth = Math.max(1, width)
    const lines = [this.palette.bold(this.options.title)]
    if (this.options.detail !== undefined && this.options.detail !== '') {
      lines.push(...wrapTextWithAnsi(this.palette.dim(this.options.detail), safeWidth), '')
    }
    lines.push(...this.editor.render(safeWidth))
    return lines.map(line => truncateToWidth(line, safeWidth, '…'))
  }
}

/** Show an overlay editor for one custom response. */
async function showText(tui: TUI, palette: Palette, options: TextOptions): Promise<string | undefined> {
  if (options.signal?.aborted === true) return undefined
  return await new Promise<string | undefined>((resolve) => {
    const dialog = new TextDialog(tui, options, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: string | undefined): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(undefined) }
    dialog.editor.onSubmit = text => { settle(text) }
    dialog.onCancel = () => { settle(undefined) }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, { width: '80%', maxHeight: '70%', anchor: 'center', margin: 1 })
  })
}

interface MultiSelectOptions {
  title: string
  detail?: string
  options: Array<{ label: string; description?: string }>
  signal?: AbortSignal
}

/** Minimal checkbox list for protocol-correct multi-select questions. */
class MultiSelectDialog implements Component, Focusable {
  focused = false
  selectedIndex = 0
  readonly selected = new Set<number>()
  onSubmit?: (labels: string[]) => void
  onCancel?: () => void

  constructor(private readonly options: MultiSelectOptions, private readonly palette: Palette) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1)
      return
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.options.options.length - 1, this.selectedIndex + 1)
      return
    }
    if (matchesKey(data, Key.space)) {
      if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex)
      else this.selected.add(this.selectedIndex)
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.onSubmit?.([...this.selected].sort((left, right) => left - right).map(index => this.options.options[index]?.label).filter((label): label is string => label !== undefined))
      return
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.onCancel?.()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines = [this.palette.bold(this.options.title)]
    if (this.options.detail !== undefined && this.options.detail !== '') {
      lines.push(...wrapTextWithAnsi(this.palette.dim(this.options.detail), safeWidth), '')
    }
    this.options.options.forEach((option, index) => {
      const checked = this.selected.has(index) ? '[x]' : '[ ]'
      const row = `${checked} ${option.label}`
      lines.push(index === this.selectedIndex ? this.palette.reverse(row) : row)
      if (option.description !== undefined) lines.push(`    ${this.palette.dim(option.description)}`)
    })
    lines.push('', this.palette.dim('Space toggle · Enter submit · Esc cancel'))
    return lines.map(line => truncateToWidth(line, safeWidth, '…'))
  }
}

/** Show a checkbox overlay and return selected labels. */
async function showMultiSelect(tui: TUI, palette: Palette, options: MultiSelectOptions): Promise<string[] | undefined> {
  if (options.signal?.aborted === true) return undefined
  return await new Promise<string[] | undefined>((resolve) => {
    const dialog = new MultiSelectDialog(options, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: string[] | undefined): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(undefined) }
    dialog.onSubmit = labels => { settle(labels) }
    dialog.onCancel = () => { settle(undefined) }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, { width: '80%', maxHeight: '75%', anchor: 'center', margin: 1 })
  })
}
