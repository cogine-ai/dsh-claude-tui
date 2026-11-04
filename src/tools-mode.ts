import type { DshToolsMode } from './runtime-snapshot.ts'

/** The launcher and direct-profile startup share the same public environment contract. */
export function parseDshToolsMode(raw: string | undefined): DshToolsMode {
  const requested = raw?.trim() || 'ptc'
  if (requested === 'native') return 'native'
  if (requested === 'ptc' || requested === 'code') return 'ptc'
  if (requested === 'both') {
    throw new Error(
      'DSH_TOOLS_MODE=both is no longer supported by DeepSeek Harness 0.2.2; choose native or ptc',
    )
  }
  throw new Error(
    `DSH_TOOLS_MODE must be native or ptc (code is an alias for ptc); received ${JSON.stringify(requested)}`,
  )
}
