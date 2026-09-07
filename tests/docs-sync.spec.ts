/** The documentation updater preserves release provenance and refuses local data loss. */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/sync-dsh-docs.mjs', import.meta.url))
const temporary: string[] = []

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(root: string, path: string, contents: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), contents)
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=DSH Docs Test', '-c', 'user.email=dsh-docs@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: 'pipe' })
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-docs-test-'))
  temporary.push(root)
  const source = join(root, 'upstream')
  const project = join(root, 'project')
  mkdirSync(source)
  mkdirSync(join(project, 'scripts'), { recursive: true })
  copyFileSync(script, join(project, 'scripts/sync-dsh-docs.mjs'))
  const snapshot = join(project, 'docs/upstream/dsh/snapshot')
  const version = '0.1.2-rc.1'
  write(project, 'package.json', JSON.stringify({ dependencies: { '@deepseek-ai/dsh': version } }))
  git(source, 'init', '--quiet')
  write(source, 'apps/cli/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  write(source, 'README.md', '# Official English guide\n')
  write(source, 'README.zh.md', '# 官方中文指南\n')
  write(source, 'LICENSE', 'Fixture license notice\n')
  write(source, 'docs/architecture.md', '# Architecture\n\nA release-specific description.\n')
  write(source, 'docs/architecture.zh.md', '# 架构\n')
  write(source, 'docs/guide.png', 'fixture image bytes')
  write(source, 'packages/core/session/README.md', '# Session API\n')
  write(source, 'AGENTS.md', 'Upstream instructions are outside the documentation mirror.\n')
  write(source, 'docs/AGENTS.md', 'Upstream documentation instructions are not copied.\n')
  write(source, 'packages/core/session/src/index.ts', 'export const sourceOnly = true\n')
  git(source, 'add', '.')
  git(source, 'commit', '--quiet', '-m', 'Documentation release fixture')
  git(source, 'tag', `dsh-v${version}`)
  const run = (...args: string[]) => spawnSync(process.execPath, [
    join(project, 'scripts/sync-dsh-docs.mjs'), ...args,
  ], { encoding: 'utf8', timeout: 10_000 })
  return { project, source, snapshot, run }
}

describe('official DSH documentation maintenance', () => {
  it('copies the complete selected release from Git, including licenses and Chinese, without working-tree edits', () => {
    const f = fixture()
    write(f.source, 'docs/architecture.md', '# Uncommitted upstream edit\n')
    const result = f.run('--source', f.source)
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(f.snapshot, 'docs/architecture.md'), 'utf8'))
      .toContain('A release-specific description.')
    expect(readFileSync(join(f.snapshot, 'README.zh.md'), 'utf8')).toContain('官方中文指南')
    expect(readFileSync(join(f.snapshot, 'LICENSE'), 'utf8')).toContain('Fixture license')
    expect(existsSync(join(f.snapshot, 'packages/core/session/README.md'))).toBe(true)
    expect(existsSync(join(f.snapshot, 'docs/AGENTS.md'))).toBe(false)
    expect(existsSync(join(f.snapshot, 'packages/core/session/src/index.ts'))).toBe(false)
    const manifest = readFileSync(join(f.snapshot, 'MANIFEST.json'), 'utf8')
    expect(f.run('--check').status).toBe(0)
    expect(f.run('--check', '--source', f.source).status).toBe(0)
    expect(f.run('--source', f.source).status).toBe(0)
    expect(readFileSync(join(f.snapshot, 'MANIFEST.json'), 'utf8')).toBe(manifest)
  })

  it.each(['modified', 'missing', 'extra'] as const)('refuses to replace a snapshot with %s local content', (change) => {
    const f = fixture()
    expect(f.run('--source', f.source).status).toBe(0)
    const target = join(f.snapshot, 'docs/architecture.md')
    if (change === 'modified') writeFileSync(target, 'A local annotation that must survive.\n')
    if (change === 'missing') rmSync(target)
    if (change === 'extra') write(f.snapshot, 'my-notes.md', 'Keep these notes.\n')
    expect(f.run('--check').status).toBe(1)
    const result = f.run('--source', f.source)
    expect(result.status).toBe(1)
    if (change === 'modified') expect(readFileSync(target, 'utf8')).toContain('must survive')
    if (change === 'missing') expect(existsSync(target)).toBe(false)
    if (change === 'extra') expect(readFileSync(join(f.snapshot, 'my-notes.md'), 'utf8')).toContain('Keep')
  })

  it('requires a matching runtime pin and removes only obsolete, verified snapshot files during an upgrade', () => {
    const f = fixture()
    expect(f.run('--source', f.source).status).toBe(0)
    const version = '0.1.2-rc.2'
    write(f.project, 'package.json', JSON.stringify({ dependencies: { '@deepseek-ai/dsh': version } }))
    expect(f.run('--check').stderr).toContain('Documentation version differs')
    write(f.project, 'docs/upstream/dsh/README.md', 'Maintainer-owned navigation.\n')
    write(f.source, 'apps/cli/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version }))
    rmSync(join(f.source, 'docs/architecture.md'))
    write(f.source, 'docs/new-guide.md', '# New guide\n')
    git(f.source, 'add', '.')
    git(f.source, 'commit', '--quiet', '-m', 'Next documentation release')
    git(f.source, 'tag', `dsh-v${version}`)
    const result = f.run('--source', f.source)
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(f.snapshot, 'docs/architecture.md'))).toBe(false)
    expect(existsSync(join(f.snapshot, 'docs/new-guide.md'))).toBe(true)
    expect(readFileSync(join(f.project, 'docs/upstream/dsh/README.md'), 'utf8')).toContain('Maintainer-owned')
    expect(f.run('--check', '--source', f.source).status).toBe(0)
  })

  it('preserves the previous snapshot when a new release lacks its required license', () => {
    const f = fixture()
    expect(f.run('--source', f.source).status).toBe(0)
    const previousManifest = readFileSync(join(f.snapshot, 'MANIFEST.json'), 'utf8')
    const version = '0.1.2-rc.2'
    write(f.project, 'package.json', JSON.stringify({ dependencies: { '@deepseek-ai/dsh': version } }))
    write(f.source, 'apps/cli/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version }))
    rmSync(join(f.source, 'LICENSE'))
    write(f.source, 'docs/architecture.md', '# A changed release\n')
    git(f.source, 'add', '.')
    git(f.source, 'commit', '--quiet', '-m', 'Incomplete documentation release')
    git(f.source, 'tag', `dsh-v${version}`)

    const result = f.run('--source', f.source)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing its license')
    expect(readFileSync(join(f.snapshot, 'MANIFEST.json'), 'utf8')).toBe(previousManifest)
    expect(readFileSync(join(f.snapshot, 'LICENSE'), 'utf8')).toContain('Fixture license')
    expect(readFileSync(join(f.snapshot, 'docs/architecture.md'), 'utf8'))
      .toContain('A release-specific description.')
  })
})
