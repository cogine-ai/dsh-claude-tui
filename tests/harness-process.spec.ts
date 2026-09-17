import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessNodeArgs } from '../src/harness-process.ts'

const directories: string[] = []

function fixture(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-cli-entry-'))
  directories.push(directory)
  const executable = join(directory, "entry '中文 #.mjs")
  writeFileSync(executable, source)
  return executable
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Harness entry compatibility', () => {
  it('dispatches an imported guarded CLI once while preserving literal arguments', () => {
    const executable = fixture(`
export async function runCli() {
  await Promise.resolve()
  console.log(JSON.stringify(process.argv.slice(1)))
}
if (import.meta.main) await runCli()
`)
    const args = ['--profile', 'test profile', "literal 'prompt'; $HOME", '--help']
    const result = spawnSync(process.execPath, harnessNodeArgs(executable, args, '24.0.0'), { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual([executable, ...args])
  })

  it('preserves rejected CLI startup as a failing process', () => {
    const executable = fixture('export async function runCli() { throw new Error("CLI startup failed") }')
    const result = spawnSync(process.execPath, harnessNodeArgs(executable, [], '24.1.0'), { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CLI startup failed')
  })

  it('preserves a self-starting runtime without invoking it again', () => {
    const executable = fixture('console.log("self-started")')
    const result = spawnSync(process.execPath, harnessNodeArgs(executable, [], '24.0.0'), { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('self-started\n')
  })
})
