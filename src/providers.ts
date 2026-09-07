/** Provider credential surfaces projected from DSH settings and credential seams. */
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
import type { Context } from '@deepseek-ai/cordis'
import {
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
} from '@deepseek-ai/dsh-credentials'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { displayText } from './text.ts'
import { editorTheme, type Palette } from './theme.ts'

/** DSH-owned authentication state for one active provider route. */
export type ProviderAuthentication =
  | { readonly kind: 'credential'; readonly ref: CredentialRef; readonly info: CredentialInfo }
  | { readonly kind: 'managed' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/** One active provider and the configuration capability DSH exposes for it. */
export interface ProviderEntry {
  readonly provider: string
  readonly name: string
  readonly authentication: ProviderAuthentication
}

/** Fresh provider configuration projection. */
export interface ProviderCatalog {
  readonly entries: readonly ProviderEntry[]
  readonly warnings: readonly string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function atPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    current = record(current)?.[segment]
    if (current === undefined) return undefined
  }
  return current
}

/** Resolve active provider credentials through DSH metadata, never provider-name heuristics. */
export async function loadProviderCatalog(ctx: Context): Promise<ProviderCatalog> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('The DSH LLM registry is unavailable')
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const directories = llm.listConfigurableProviders()
  const warnings: string[] = []
  const entries = await Promise.all(llm.listProviders().map(async (provider): Promise<ProviderEntry> => {
    const directory = directories.find(candidate => candidate.provider === provider.id)
    if (directory === undefined) {
      return { provider: provider.id, name: provider.name, authentication: { kind: 'managed' } }
    }
    if (settings === undefined) {
      return {
        provider: provider.id,
        name: provider.name,
        authentication: { kind: 'unavailable', reason: 'DSH settings service is unavailable' },
      }
    }
    let profile: Record<string, unknown> | undefined
    try {
      profile = record(atPath(settings.get(directory.settingsNs), directory.settingsPath))
    } catch (error: unknown) {
      const reason = errorChain(error)
      warnings.push(`${displayText(provider.name)} settings: ${reason}`)
      return {
        provider: provider.id,
        name: provider.name,
        authentication: { kind: 'unavailable', reason },
      }
    }
    const rawRef = profile?.apiKeyEnv
    if (typeof rawRef !== 'string' || rawRef === '') {
      return { provider: provider.id, name: provider.name, authentication: { kind: 'managed' } }
    }
    if (credentials === undefined) {
      return {
        provider: provider.id,
        name: provider.name,
        authentication: { kind: 'unavailable', reason: 'DSH credential service is unavailable' },
      }
    }
    try {
      const ref = credentialRef(rawRef)
      const info = await credentials.describe(ref)
      return { provider: provider.id, name: provider.name, authentication: { kind: 'credential', ref, info } }
    } catch (error: unknown) {
      const reason = errorChain(error)
      warnings.push(`${displayText(provider.name)} credential: ${reason}`)
      return {
        provider: provider.id,
        name: provider.name,
        authentication: { kind: 'unavailable', reason },
      }
    }
  }))
  return { entries, warnings }
}

/** The only safe automatic onboarding case: no usable route and exactly one writable missing key. */
export function soleMissingCredential(catalog: ProviderCatalog): ProviderEntry | undefined {
  const usable = catalog.entries.some(entry => {
    const auth = entry.authentication
    return auth.kind === 'managed' || (auth.kind === 'credential' && auth.info.configured)
  })
  if (usable) return undefined
  const missing = catalog.entries.filter(entry => (
    entry.authentication.kind === 'credential'
    && !entry.authentication.info.configured
    && entry.authentication.info.writable
  ))
  return missing.length === 1 ? missing[0] : undefined
}

class ProviderPickerDialog implements Component, Focusable {
  focused = false
  selected = 0
  onSubmit?: (entry: ProviderEntry) => void
  onCancel?: () => void
  private catalog: ProviderCatalog | undefined
  private loading = true
  private failure: string | undefined

  constructor(private readonly palette: Palette) {}

  invalidate(): void {}

  setLoading(): void {
    this.loading = true
    this.failure = undefined
  }

  setFailure(error: unknown): void {
    this.loading = false
    this.failure = errorChain(error)
  }

  replaceCatalog(catalog: ProviderCatalog): void {
    const selectedProvider = this.catalog?.entries[this.selected]?.provider
    this.catalog = catalog
    this.loading = false
    this.failure = undefined
    const retained = catalog.entries.findIndex(entry => entry.provider === selectedProvider)
    this.selected = retained < 0 ? 0 : retained
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel?.()
      return
    }
    const entries = this.catalog?.entries ?? []
    if (this.loading || entries.length === 0) return
    if (matchesKey(data, Key.up)) {
      this.selected = this.selected === 0 ? entries.length - 1 : this.selected - 1
      return
    }
    if (matchesKey(data, Key.down)) {
      this.selected = (this.selected + 1) % entries.length
      return
    }
    if (matchesKey(data, Key.enter)) {
      const entry = entries[this.selected]
      if (entry !== undefined) this.onSubmit?.(entry)
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines = [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold('Configure provider')}`, safeWidth, '…'),
      truncateToWidth(` ${this.palette.dim('Authentication state and writability come from DSH')}`, safeWidth, '…'),
      '',
    ]
    if (this.loading) lines.push(` ${this.palette.dim('Loading DSH providers…')}`)
    else if (this.failure !== undefined) lines.push(` ${this.palette.error(displayText(this.failure))}`)
    else if (this.catalog === undefined || this.catalog.entries.length === 0) {
      lines.push(` ${this.palette.warning('No active DSH providers')}`)
    } else {
      this.catalog.entries.forEach((entry, index) => {
        const selected = index === this.selected
        const cursor = selected && this.focused ? CURSOR_MARKER : ''
        const arrow = selected ? this.palette.selection('❯') : ' '
        const name = displayText(entry.name)
        lines.push(truncateToWidth(
          ` ${cursor}${arrow} ${selected ? this.palette.selection(name) : name}  ${this.palette.dim(authenticationLabel(entry.authentication))}`,
          safeWidth,
          '…',
        ))
      })
      const warning = this.catalog.warnings[0]
      if (warning !== undefined) lines.push('', ` ${this.palette.warning(displayText(warning))}`)
    }
    lines.push('', truncateToWidth(` ${this.palette.dim('↑/↓ select · Enter configure · Esc cancel')}`, safeWidth, '…'))
    return lines
  }
}

function authenticationLabel(authentication: ProviderAuthentication): string {
  if (authentication.kind === 'managed') return 'authentication managed by provider'
  if (authentication.kind === 'unavailable') return 'configuration unavailable'
  const state = authentication.info.configured ? 'configured' : 'not configured'
  const source = authentication.info.source
  const writable = authentication.info.writable ? '' : ' · read-only'
  return `${state}${source === undefined ? '' : ` · ${displayText(source)}`}${writable}`
}

/** Show a provider list that tracks live topology, settings, and credential changes. */
export async function showProviderPicker(
  tui: TUI,
  palette: Palette,
  load: () => Promise<ProviderCatalog>,
  subscribe: (refresh: () => void) => () => void,
  signal?: AbortSignal,
): Promise<ProviderEntry | undefined> {
  if (signal?.aborted === true) return undefined
  return await new Promise<ProviderEntry | undefined>((resolve) => {
    const dialog = new ProviderPickerDialog(palette)
    let handle: OverlayHandle | undefined
    let settled = false
    let generation = 0
    const settle = (value: ProviderEntry | undefined): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      disposeRefresh()
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(undefined) }
    const refresh = (): void => {
      const run = ++generation
      dialog.setLoading()
      tui.requestRender()
      void load().then((catalog) => {
        if (settled || run !== generation) return
        dialog.replaceCatalog(catalog)
        tui.requestRender()
      }, (error: unknown) => {
        if (settled || run !== generation) return
        dialog.setFailure(error)
        tui.requestRender()
      })
    }
    const disposeRefresh = subscribe(refresh)
    dialog.onSubmit = settle
    dialog.onCancel = () => { settle(undefined) }
    signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, {
      width: '100%',
      maxHeight: '100%',
      anchor: 'bottom-left',
      margin: { bottom: 2 },
    })
    refresh()
  })
}

const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

function quoted(value: string): boolean {
  const first = value[0]
  return (first === '"' || first === "'" || first === '`') && value.length > 1 && value.endsWith(first)
}

/** Match DSH's browser-side API-key guard without importing a client package into the host. */
function apiKeyFailure(draft: string, required: boolean): string | undefined {
  if (draft.length === 0) return required ? 'API key is required' : undefined
  const value = draft.trim()
  if (value.length === 0) return 'API key cannot be blank'
  if (ENV_LINE.test(value) || quoted(value) || !LEGAL_API_KEY.test(value)) {
    return 'Paste only the printable API key value, without quotes or NAME='
  }
  return undefined
}

/** Editor-backed input whose raw contents are never passed to a renderer. */
class SecretInputDialog implements Component, Focusable {
  private readonly editor: Editor
  private _focused = false
  private failure: string | undefined
  onSubmit?: (value: string) => void
  onCancel?: () => void

  constructor(
    tui: TUI,
    private readonly provider: ProviderEntry,
    private readonly ref: CredentialRef,
    private readonly required: boolean,
    private readonly palette: Palette,
  ) {
    this.editor = new Editor(tui, editorTheme(palette), { paddingX: 0 })
    this.editor.onChange = () => { this.failure = undefined }
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) {
    this._focused = value
    this.editor.focused = value
  }

  invalidate(): void { this.editor.invalidate() }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel?.()
      return
    }
    if (matchesKey(data, Key.enter)) {
      const draft = this.editor.getExpandedText()
      const failure = apiKeyFailure(draft, this.required)
      if (failure !== undefined) {
        this.failure = failure
        return
      }
      this.onSubmit?.(draft.trim())
      return
    }
    this.editor.handleInput(data)
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const title = this.required ? `Connect ${displayText(this.provider.name)}` : `Update ${displayText(this.provider.name)} API key`
    const value = [...this.editor.getExpandedText()]
    const stored = this.editor.getText()
    const rawCursor = this.editor.getCursor().col
    const storageCursor = stored.includes('[paste #') && rawCursor === stored.length
      ? value.length
      : rawCursor
    const cursor = Math.max(0, Math.min(value.length, storageCursor))
    const fieldWidth = Math.max(1, safeWidth - 4)
    const start = Math.max(0, cursor - fieldWidth + 1)
    const visible = value.slice(start, start + fieldWidth)
    const relativeCursor = Math.max(0, Math.min(visible.length, cursor - start))
    const before = '•'.repeat(relativeCursor)
    const under = relativeCursor < visible.length ? '•' : ' '
    const after = '•'.repeat(Math.max(0, visible.length - relativeCursor - 1))
    const masked = `${before}${this.focused ? CURSOR_MARKER : ''}${this.palette.reverse(under)}${after}`
    return [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold(title)}`, safeWidth, '…'),
      truncateToWidth(` ${this.palette.dim(`DSH credential reference: ${displayText(this.ref)}`)}`, safeWidth, '…'),
      '',
      truncateToWidth(`   ${masked}`, safeWidth, '…'),
      ...(this.failure === undefined ? [] : [`   ${this.palette.error(this.failure)}`]),
      '',
      truncateToWidth(` ${this.palette.dim('Paste the key value only. It is masked and is not written to the session log.')}`, safeWidth, '…'),
      truncateToWidth(` ${this.palette.dim(`${this.required ? 'Enter save' : 'Enter replace · empty keeps the current key'} · Esc cancel`)}`, safeWidth, '…'),
    ]
  }
}

/** Collect one API key. Empty means keep the configured value when replacement is optional. */
export async function showApiKeyInput(
  tui: TUI,
  palette: Palette,
  provider: ProviderEntry,
  ref: CredentialRef,
  required: boolean,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (signal?.aborted === true) return undefined
  return await new Promise<string | undefined>((resolve) => {
    const dialog = new SecretInputDialog(tui, provider, ref, required, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: string | undefined): void => {
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
      margin: { bottom: 2 },
    })
  })
}

class ProviderInfoDialog implements Component, Focusable {
  focused = false
  onClose?: () => void

  constructor(private readonly entry: ProviderEntry, private readonly palette: Palette) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onClose?.()
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const auth = this.entry.authentication
    const message = auth.kind === 'credential'
      ? `Credential ${displayText(auth.ref)} is supplied by ${displayText(auth.info.source ?? 'a read-only source')} and is managed outside this TUI.`
      : auth.kind === 'unavailable'
        ? displayText(auth.reason)
        : 'This provider manages authentication without a DSH API-key reference.'
    return [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold(displayText(this.entry.name))}`, safeWidth, '…'),
      '',
      ...wrapTextWithAnsi(` ${message}`, safeWidth),
      '',
      truncateToWidth(` ${this.palette.dim('Enter or Esc to close')}`, safeWidth, '…'),
    ]
  }
}

/** Explain why a provider has no writable API-key field. */
export async function showProviderInfo(
  tui: TUI,
  palette: Palette,
  entry: ProviderEntry,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) return
  await new Promise<void>((resolve) => {
    const dialog = new ProviderInfoDialog(entry, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve()
    }
    const onAbort = (): void => { settle() }
    dialog.onClose = settle
    signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, {
      width: '100%',
      maxHeight: '100%',
      anchor: 'bottom-left',
      margin: { bottom: 2 },
    })
  })
}
