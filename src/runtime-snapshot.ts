/** Launcher-owned runtime provenance rendered by the terminal welcome panel. */
export type DshToolsMode = 'native' | 'ptc' | 'both'

export interface ClaudeTuiRuntimeSnapshot {
  readonly harnessVersion: string
  readonly runtimeKind: 'system' | 'bundled'
  readonly homeKind: 'shared' | 'isolated'
  readonly homePath: string
  readonly toolsMode: DshToolsMode
}
