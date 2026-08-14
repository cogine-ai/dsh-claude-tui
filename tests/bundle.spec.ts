/** Public bundle artifact contracts for a self-contained installed profile. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('dsh-claude-tui bundle', () => {
  it('exposes structured user questions through the installed plugin closure', () => {
    const packDirectory = mkdtempSync(join(tmpdir(), 'dsh-claude-tui-pack-'))

    try {
      execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd: repositoryRoot,
        stdio: 'pipe',
      })

      const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith('.tgz'))
      expect(tarballs).toHaveLength(1)

      const tarball = tarballs[0]
      if (tarball === undefined) throw new Error('pnpm pack did not produce a tarball')

      execFileSync('tar', ['-xzf', join(packDirectory, tarball), '-C', packDirectory])

      const packageDirectory = join(packDirectory, 'package')
      const patch = readFileSync(join(packageDirectory, 'cordis.patch.yml'), 'utf8')
      const manifest = JSON.parse(
        readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }

      expect(patch).toMatch(
        /- id: tool-ask-user\n\s+name: ['"]@deepseek-ai\/dsh-tool-ask-user['"]/u,
      )
      expect(manifest.dependencies?.['@deepseek-ai/dsh-tool-ask-user']).toBe(
        '0.1.0-rc.6',
      )
    } finally {
      rmSync(packDirectory, { recursive: true, force: true })
    }
  }, 30_000)
})
