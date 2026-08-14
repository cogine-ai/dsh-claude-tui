/** Serializable configuration for the Claude-like terminal front door. */
import z from '@deepseek-ai/schemastery'

/** Plugin configuration accepted from `cordis.patch.yml`. */
export interface Config {
  /** Visible header and terminal-window title. */
  title?: string
  /** Apply the built-in ANSI palette. */
  color?: boolean
  /** Render model reasoning blocks. */
  showReasoning?: boolean
  /** Maximum retained transcript rows before the renderer drops oldest rows. */
  maxTranscriptRows?: number
  /** Maximum result lines shown on a collapsed tool card. */
  maxToolOutputLines?: number
}

/** Loader schema for the terminal configuration. */
export const Config: z<Config> = z.object({
  title: z.string().default('DeepSeek Harness - Claude TUI'),
  color: z.boolean().default(true),
  showReasoning: z.boolean().default(true),
  maxTranscriptRows: z.number().step(1).min(100).default(5000),
  maxToolOutputLines: z.number().step(1).min(1).default(8),
})

/** Fully resolved configuration used by the renderer. */
export interface ResolvedConfig {
  title: string
  color: boolean
  showReasoning: boolean
  maxTranscriptRows: number
  maxToolOutputLines: number
}

/** Apply the same defaults for direct callers that bypass Loader validation. */
export function resolveConfig(config: Config | undefined): ResolvedConfig {
  return {
    title: config?.title ?? 'DeepSeek Harness - Claude TUI',
    color: config?.color ?? true,
    showReasoning: config?.showReasoning ?? true,
    maxTranscriptRows: config?.maxTranscriptRows ?? 5000,
    maxToolOutputLines: config?.maxToolOutputLines ?? 8,
  }
}
