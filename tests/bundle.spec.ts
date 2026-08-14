/** Public bundle artifact contracts for a self-contained installed profile. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string> }

describe('dsh-claude-tui bundle', () => {
  it('exposes structured user questions through the installed plugin closure', () => {
    expect(patch).toMatch(
      /- id: tool-ask-user\n\s+name: ['"]@deepseek-ai\/dsh-tool-ask-user['"]/u,
    )
    expect(manifest.dependencies?.['@deepseek-ai/dsh-tool-ask-user']).toBe('0.1.0-rc.6')
  })
})
