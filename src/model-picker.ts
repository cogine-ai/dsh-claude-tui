/** Claude-shaped model selection over the live DSH provider registry. */
import {
  CURSOR_MARKER,
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
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { errorChain, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import { displayText } from './text.ts'
import type { Palette } from './theme.ts'

/** One selectable route, including only capability facts disclosed by DSH. */
export interface ModelPickerEntry {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly description?: string
  readonly advertised: boolean
  readonly metadataResolved: boolean
  readonly efforts: readonly LlmReasoningEffortInfo[]
  readonly defaultEffort?: string
}

/** Fresh registry projection used by one picker render. */
export interface ModelCatalog {
  readonly entries: readonly ModelPickerEntry[]
  readonly current: ModelSelection
  readonly defaultSelection: ModelSelection
  readonly warnings: readonly string[]
}

/** User outcome: update this Agent, and optionally the DSH default for future Agents. */
export interface ModelPickerResult {
  readonly selection: ModelSelection
  readonly saveDefault: boolean
}

function sameRoute(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model
}

/** Read the active DSH topology without turning its advisory catalog into a whitelist. */
export async function loadModelCatalog(
  ctx: Context,
  current: ModelSelection,
  defaultSelection: ModelSelection,
  signal?: AbortSignal,
): Promise<ModelCatalog> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('The DSH LLM registry is unavailable')
  const providers = llm.listProviders()
  const providerNames = new Map(providers.map(provider => [provider.id, provider.name]))
  const entries: ModelPickerEntry[] = []
  const warnings: string[] = []

  for (const provider of providers) {
    signal?.throwIfAborted()
    let models
    try {
      models = await llm.listModels(provider.id)
    } catch (error: unknown) {
      warnings.push(`${displayText(provider.name)} catalog: ${errorChain(error)}`)
      continue
    }
    for (const model of models) {
      signal?.throwIfAborted()
      let resolved
      try {
        resolved = await llm.resolveModelInfo(provider.id, model.id, signal)
      } catch (error: unknown) {
        signal?.throwIfAborted()
        warnings.push(`${displayText(provider.name)}/${displayText(model.name)}: ${errorChain(error)}`)
      }
      entries.push({
        provider: provider.id,
        providerName: provider.name,
        model: model.id,
        modelName: resolved?.name ?? model.name,
        ...(resolved?.description ?? model.description) === undefined
          ? {}
          : { description: resolved?.description ?? model.description },
        advertised: true,
        metadataResolved: resolved !== undefined,
        efforts: resolved?.reasoning?.efforts ?? [],
        ...(resolved?.reasoning?.defaultEffort === undefined
          ? {}
          : { defaultEffort: resolved.reasoning.defaultEffort }),
      })
    }
  }

  for (const selection of [current, defaultSelection]) {
    if (entries.some(entry => entry.provider === selection.provider && entry.model === selection.model)) continue
    let resolved
    let metadataResolved = false
    if (providerNames.has(selection.provider)) {
      try {
        resolved = await llm.resolveModelInfo(selection.provider, selection.model, signal)
        metadataResolved = true
      } catch {
        signal?.throwIfAborted()
        // Catalog membership is advisory. Preserve the exact route even when metadata lookup fails.
      }
    }
    entries.push({
      provider: selection.provider,
      providerName: providerNames.get(selection.provider) ?? selection.provider,
      model: selection.model,
      modelName: resolved?.name ?? selection.model,
      ...(resolved?.description === undefined ? {} : { description: resolved.description }),
      advertised: false,
      metadataResolved,
      efforts: resolved?.reasoning?.efforts ?? [],
      ...(resolved?.reasoning?.defaultEffort === undefined
        ? {}
        : { defaultEffort: resolved.reasoning.defaultEffort }),
    })
  }

  return { entries, current, defaultSelection, warnings }
}

/** Mutable modal projection; registry refreshes replace facts without closing it. */
class ModelPickerDialog implements Component, Focusable {
  focused = false
  onSubmit?: (result: ModelPickerResult) => void
  onCancel?: () => void
  private catalog: ModelCatalog | undefined
  private selected = 0
  private readonly pickedEfforts = new Map<string, string | undefined>()
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

  replaceCatalog(catalog: ModelCatalog): void {
    const selectedRoute = this.entry(this.selected)
    this.catalog = catalog
    this.loading = false
    this.failure = undefined
    for (const entry of catalog.entries) {
      const key = this.key(entry)
      const inheritedEffort = sameRoute(catalog.current, { provider: entry.provider, model: entry.model })
        ? catalog.current.reasoningEffort
        : sameRoute(catalog.defaultSelection, { provider: entry.provider, model: entry.model })
          ? catalog.defaultSelection.reasoningEffort
          : undefined
      const compatibleInherited = this.compatibleEffort(entry, inheritedEffort)
      if (!this.pickedEfforts.has(key)) {
        this.pickedEfforts.set(key, compatibleInherited)
        continue
      }
      const picked = this.pickedEfforts.get(key)
      if (entry.metadataResolved && picked !== undefined && !entry.efforts.some(effort => effort.id === picked)) {
        this.pickedEfforts.set(key, compatibleInherited)
      }
    }
    const retained = selectedRoute === undefined
      ? -1
      : catalog.entries.findIndex(entry => this.key(entry) === this.key(selectedRoute))
    const current = catalog.entries.findIndex(entry => (
      entry.provider === catalog.current.provider && entry.model === catalog.current.model
    ))
    this.selected = retained >= 0 ? retained : Math.max(0, current)
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel?.()
      return
    }
    const entries = this.catalog?.entries ?? []
    if (entries.length === 0 || this.loading) return
    if (matchesKey(data, Key.up)) {
      this.selected = this.selected === 0 ? entries.length - 1 : this.selected - 1
      return
    }
    if (matchesKey(data, Key.down)) {
      this.selected = (this.selected + 1) % entries.length
      return
    }
    if (matchesKey(data, Key.left)) {
      this.moveEffort(-1)
      return
    }
    if (matchesKey(data, Key.right)) {
      this.moveEffort(1)
      return
    }
    if (data.toLocaleLowerCase() === 'd') {
      this.submit(true)
      return
    }
    if (matchesKey(data, Key.enter)) this.submit(false)
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const catalog = this.catalog
    const lines = [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold('Select model')}`, safeWidth, '…'),
      truncateToWidth(` ${this.palette.dim('Models and effort levels come from the live DSH registry')}`, safeWidth, '…'),
      '',
    ]
    if (this.loading) lines.push(` ${this.palette.dim('Loading DSH models…')}`)
    else if (this.failure !== undefined) lines.push(` ${this.palette.error(displayText(this.failure))}`)
    else if (catalog === undefined || catalog.entries.length === 0) {
      lines.push(` ${this.palette.warning('No active DSH model routes')}`)
    } else {
      catalog.entries.forEach((entry, index) => lines.push(...this.renderEntry(entry, index, safeWidth)))
      const warning = catalog.warnings[0]
      if (warning !== undefined) {
        lines.push('', truncateToWidth(` ${this.palette.warning(displayText(warning))}`, safeWidth, '…'))
      }
    }
    lines.push(
      '',
      truncateToWidth(` ${this.palette.dim('↑/↓ select · ←/→ effort · Enter use this Agent · d also save as DSH default · Esc cancel')}`, safeWidth, '…'),
      truncateToWidth(` ${this.palette.dim('A change applies to the next DSH model request; the current request stays unchanged.')}`, safeWidth, '…'),
    )
    return lines
  }

  private renderEntry(entry: ModelPickerEntry, index: number, width: number): string[] {
    const catalog = this.catalog
    if (catalog === undefined) return []
    const selected = index === this.selected
    const cursor = selected && this.focused ? CURSOR_MARKER : ''
    const arrow = selected ? this.palette.selection('❯') : ' '
    const label = `${displayText(entry.providerName)} / ${displayText(entry.modelName)}`
    const badges = [
      sameRoute(catalog.current, { provider: entry.provider, model: entry.model }) ? 'current' : '',
      sameRoute(catalog.defaultSelection, { provider: entry.provider, model: entry.model }) ? 'default' : '',
      entry.advertised ? '' : 'not advertised',
    ].filter(Boolean).join(' · ')
    const heading = selected ? this.palette.selection(label) : label
    const first = truncateToWidth(` ${cursor}${arrow} ${heading}${badges === '' ? '' : `  ${this.palette.dim(badges)}`}`, width, '…')
    const description = entry.description === undefined ? '' : displayText(entry.description)
    const effort = this.effortLabel(entry)
    const savedDefaultEffort = this.savedDefaultEffortLabel(entry)
    const detail = [
      description,
      effort === undefined ? '' : `effort: ${effort}`,
      savedDefaultEffort === undefined ? '' : `DSH default effort: ${savedDefaultEffort}`,
    ].filter(Boolean).join(' · ')
    return detail === ''
      ? [first]
      : [first, ...wrapTextWithAnsi(`   ${this.palette.dim(detail)}`, width)]
  }

  private moveEffort(delta: -1 | 1): void {
    const entry = this.entry(this.selected)
    if (entry === undefined || entry.efforts.length === 0) return
    const key = this.key(entry)
    const picked = this.pickedEfforts.get(key)
    const baseline = picked ?? entry.defaultEffort ?? entry.efforts[0]?.id
    const currentIndex = entry.efforts.findIndex(effort => effort.id === baseline)
    const nextIndex = Math.max(0, Math.min(entry.efforts.length - 1, currentIndex + delta))
    this.pickedEfforts.set(key, entry.efforts[nextIndex]?.id)
  }

  private effortLabel(entry: ModelPickerEntry): string | undefined {
    const picked = this.pickedEfforts.get(this.key(entry))
    if (entry.efforts.length === 0) return picked === undefined ? undefined : displayText(picked)
    const id = picked ?? entry.defaultEffort
    if (id === undefined) return 'provider default'
    const name = entry.efforts.find(effort => effort.id === id)?.name ?? id
    return `${displayText(name)}${picked === undefined ? ' (adapter default)' : ''}`
  }

  private savedDefaultEffortLabel(entry: ModelPickerEntry): string | undefined {
    const catalog = this.catalog
    if (catalog === undefined || !sameRoute(catalog.defaultSelection, {
      provider: entry.provider,
      model: entry.model,
    })) return undefined
    const saved = catalog.defaultSelection.reasoningEffort
    const picked = this.pickedEfforts.get(this.key(entry))
    if (saved === undefined || saved === picked) return undefined
    return displayText(entry.efforts.find(effort => effort.id === saved)?.name ?? saved)
  }

  private submit(saveDefault: boolean): void {
    const entry = this.entry(this.selected)
    if (entry === undefined) return
    const effort = this.pickedEfforts.get(this.key(entry))
    this.onSubmit?.({
      selection: {
        provider: entry.provider,
        model: entry.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort as never }),
      },
      saveDefault,
    })
  }

  private entry(index: number): ModelPickerEntry | undefined {
    return this.catalog?.entries[index]
  }

  private key(entry: Pick<ModelPickerEntry, 'provider' | 'model'>): string {
    return `${entry.provider}\u0000${entry.model}`
  }

  private compatibleEffort(entry: ModelPickerEntry, effort: string | undefined): string | undefined {
    if (effort === undefined || !entry.metadataResolved) return effort
    return entry.efforts.some(candidate => candidate.id === effort) ? effort : undefined
  }
}

/** Show one live picker and refresh it whenever DSH reports adapter topology changes. */
export async function showModelPicker(
  tui: TUI,
  palette: Palette,
  load: () => Promise<ModelCatalog>,
  subscribe: (refresh: () => void) => () => void,
  signal?: AbortSignal,
): Promise<ModelPickerResult | undefined> {
  if (signal?.aborted === true) return undefined
  return await new Promise<ModelPickerResult | undefined>((resolve) => {
    const dialog = new ModelPickerDialog(palette)
    let handle: OverlayHandle | undefined
    let settled = false
    let generation = 0
    const settle = (value: ModelPickerResult | undefined): void => {
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
    dialog.onSubmit = value => { settle(value) }
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

/** Confirmation used only when a route change follows existing assistant output. */
class ModelSwitchConfirmation implements Component, Focusable {
  focused = false
  selected = true
  onSubmit?: (confirmed: boolean) => void
  onCancel?: () => void

  constructor(private readonly selection: ModelSelection, private readonly palette: Palette) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.selected = !this.selected
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
    return [
      this.palette.selection('─'.repeat(safeWidth)),
      truncateToWidth(` ${this.palette.bold('Switch model for the next request?')}`, safeWidth, '…'),
      '',
      ...wrapTextWithAnsi(
        ` Existing conversation history may be sent to ${displayText(this.selection.provider)}/${displayText(this.selection.model)}, and provider prompt-cache reuse may be lost.`,
        safeWidth,
      ),
      '',
      this.option(true, 'Switch model', safeWidth),
      this.option(false, 'Cancel', safeWidth),
      '',
      truncateToWidth(` ${this.palette.dim('Enter confirm · Esc cancel')}`, safeWidth, '…'),
    ]
  }

  private option(value: boolean, label: string, width: number): string {
    const active = this.selected === value
    const cursor = active && this.focused ? CURSOR_MARKER : ''
    return truncateToWidth(
      ` ${cursor}${active ? this.palette.selection('❯') : ' '} ${active ? this.palette.selection(label) : label}`,
      width,
      '…',
    )
  }
}

/** Confirm one history-bearing provider/model route change. */
export async function confirmModelSwitch(
  tui: TUI,
  palette: Palette,
  selection: ModelSelection,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted === true) return false
  return await new Promise<boolean>((resolve) => {
    const dialog = new ModelSwitchConfirmation(selection, palette)
    let handle: OverlayHandle | undefined
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      resolve(value)
    }
    const onAbort = (): void => { settle(false) }
    dialog.onSubmit = settle
    dialog.onCancel = () => { settle(false) }
    signal?.addEventListener('abort', onAbort, { once: true })
    handle = tui.showOverlay(dialog, {
      width: '100%',
      maxHeight: '100%',
      anchor: 'bottom-left',
      margin: { bottom: 2 },
    })
  })
}
