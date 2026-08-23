/** Terminal-safe text helpers shared by the projector and renderer. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Format the stable Claude-style labels used for pending and durable images. */
export function imageLabels(count: number): string {
  return Array.from({ length: count }, (_, index) => `[Image #${index + 1}]`).join(' ')
}

/** Render terminal control bytes visibly while preserving line feeds. */
export function displayText(input: string): string {
  let output = ''
  for (const character of input) {
    const code = character.codePointAt(0)
    if (code === undefined) continue
    if (character === '\n') {
      output += character
      continue
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      output += `\\x${code.toString(16).padStart(2, '0')}`
      continue
    }
    output += character
  }
  return output
}

/** Flatten visible text from merge-extensible content blocks. */
export function contentText(blocks: readonly ContentBlock[], kind: 'text' | 'reasoning' | 'tool-result'): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (kind === 'text' && block.type === 'text') parts.push(block.text)
    if (kind === 'reasoning' && block.type === 'reasoning') parts.push(block.text)
    if (kind === 'tool-result' && block.type === 'tool-result') {
      parts.push(contentText(block.content, 'text'))
    }
  }
  return displayText(parts.join(''))
}

/** Parse model-produced JSON arguments for readable terminal presentation. */
export function prettyArguments(raw: string): string {
  try {
    return displayText(JSON.stringify(JSON.parse(raw) as unknown, null, 2))
  } catch {
    return displayText(raw)
  }
}
