import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DshRuntime } from '../src/launch-plan.ts'
import type { PackageIdentity } from '../src/managed-profile.ts'
import { resolveBundledDshRuntime } from '../src/runtime-discovery.ts'
import {
  probeRuntimeCompatibility,
  runtimeProbeInternals,
} from '../src/runtime-probe.ts'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-runtime-probe-test-'))
  temporaryDirectories.push(path)
  return path
}

function fixture(
  source: string,
): { runtime: DshRuntime; identity: PackageIdentity; record: string } {
  const root = temporaryDirectory()
  const packageRoot = join(root, 'runtime')
  const tuiRoot = join(root, 'tui')
  const executable = join(packageRoot, 'bin.js')
  const record = join(root, 'record.json')
  mkdirSync(packageRoot)
  mkdirSync(tuiRoot)
  writeFileSync(join(packageRoot, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(tuiRoot, 'package.json'), '{"name":"dsh-claude-tui","version":"0.1.0"}\n')
  writeFileSync(executable, source.replaceAll('__RECORD__', JSON.stringify(record)))
  chmodSync(executable, 0o755)
  return {
    runtime: {
      kind: 'system',
      source: 'path',
      version: '0.1.0',
      packageRoot,
      executable,
    },
    identity: { root: tuiRoot, version: '0.1.0' },
    record,
  }
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('isolated runtime compatibility probe', () => {
  it('qualifies the real pinned DSH through the TUI Agent and Session contracts', async () => {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { version: string }

    const result = await probeRuntimeCompatibility(
      resolveBundledDshRuntime(),
      { root: repositoryRoot, version: manifest.version },
      { timeoutMs: 30_000 },
    )

    expect(result).toEqual({ compatible: true })
  }, 40_000)

  it('uses a temporary profile and a secret-free process environment', async () => {
    const { runtime, identity, record } = fixture(`
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const token = process.env.DSH_CLAUDE_TUI_PROBE_TOKEN
writeFileSync(__RECORD__, JSON.stringify({
  cwd: process.cwd(),
  home: process.env.HOME,
  dshHome: process.env.DSH_HOME,
  userProfile: process.env.USERPROFILE,
  hasProfile: existsSync(join(process.env.DSH_HOME, 'profiles/dsh-claude-tui/package.json')),
  hasApiKey: 'DEEPSEEK_API_KEY' in process.env,
  hasNodeOptions: 'NODE_OPTIONS' in process.env,
  hasProxy: 'HTTPS_PROXY' in process.env,
  telemetry: process.env.DSH_TELEMETRY_DISABLED,
}))
process.stdout.write('DSH_CLAUDE_TUI_PROBE_RESULT ' + JSON.stringify({
  token,
  package: 'dsh-claude-tui',
  version: '0.1.0',
  services: ['agentDefaultModel', 'agents', 'commands', 'sessions'],
}) + '\\n')
`)

    const result = await probeRuntimeCompatibility(runtime, identity, {
      environment: {
        ...process.env,
        DEEPSEEK_API_KEY: 'must-not-leak',
        NODE_OPTIONS: '--this-would-break-node',
        HTTPS_PROXY: 'http://must-not-leak.example',
      },
    })

    expect(result).toEqual({ compatible: true })
    const observed = JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown>
    expect(observed).toMatchObject({
      hasProfile: true,
      hasApiKey: false,
      hasNodeOptions: false,
      hasProxy: false,
      telemetry: '1',
    })
    expect(observed.home).toBe(observed.userProfile)
    expect(observed.home).not.toBe(process.env.HOME)
    expect(observed.cwd).not.toBe(process.cwd())
    expect(existsSync(String(observed.dshHome))).toBe(false)
  })

  it('rejects a successful process that did not load the expected TUI artifact', async () => {
    const { runtime, identity } = fixture(`
process.stdout.write('DSH_CLAUDE_TUI_PROBE_RESULT ' + JSON.stringify({
  token: process.env.DSH_CLAUDE_TUI_PROBE_TOKEN,
  package: 'dsh-claude-tui',
  version: 'different-version',
  services: ['agentDefaultModel', 'agents', 'commands', 'sessions'],
}) + '\\n')
`)

    const result = await probeRuntimeCompatibility(runtime, identity)

    expect(result).toEqual({
      compatible: false,
      reason: expect.stringContaining('unexpected probe result'),
    })
  })

  it('rejects an rc7-shaped result that did not exercise the command contract', async () => {
    const { runtime, identity } = fixture(`
process.stdout.write('DSH_CLAUDE_TUI_PROBE_RESULT ' + JSON.stringify({
  token: process.env.DSH_CLAUDE_TUI_PROBE_TOKEN,
  package: 'dsh-claude-tui',
  version: '0.1.0',
  services: ['agentDefaultModel', 'agents', 'sessions'],
}) + '\\n')
`)

    const result = await probeRuntimeCompatibility(runtime, identity)

    expect(result).toEqual({
      compatible: false,
      reason: expect.stringContaining('unexpected probe result'),
    })
  })

  it('bounds probe duration', async () => {
    const { runtime, identity } = fixture('setInterval(() => {}, 1_000)\n')

    const result = await probeRuntimeCompatibility(runtime, identity, { timeoutMs: 100 })

    expect(result).toEqual({
      compatible: false,
      reason: expect.stringContaining('timed out'),
    })
  })

  it.skipIf(process.platform === 'win32')(
    'terminates descendants when a bounded probe times out',
    async () => {
      const { runtime, identity, record } = fixture(`
import { spawn } from 'node:child_process'

const record = __RECORD__
const childSource = "const fs = require('node:fs');"
  + "fs.writeFileSync(" + JSON.stringify(record + '.started') + ", 'started');"
  + "setTimeout(() => fs.writeFileSync(" + JSON.stringify(record) + ", 'survived'), 2000);"
  + "setInterval(() => {}, 1000);"
spawn(process.execPath, ['-e', childSource], { stdio: 'ignore' })
setInterval(() => {}, 1_000)
`)

      const result = await probeRuntimeCompatibility(runtime, identity, { timeoutMs: 1_000 })

      expect(result).toEqual({
        compatible: false,
        reason: expect.stringContaining('timed out'),
      })
      expect(existsSync(`${record}.started`)).toBe(true)
      await delay(1_500)
      expect(existsSync(record)).toBe(false)
    },
    5_000,
  )

  it('contains cleanup failures and rejects the non-disposable candidate', async () => {
    const { runtime, identity, record } = fixture(`
import { writeFileSync } from 'node:fs'

writeFileSync(__RECORD__, process.env.TMPDIR)
process.stdout.write('DSH_CLAUDE_TUI_PROBE_RESULT ' + JSON.stringify({
  token: process.env.DSH_CLAUDE_TUI_PROBE_TOKEN,
  package: 'dsh-claude-tui',
  version: '0.1.0',
  services: ['agentDefaultModel', 'agents', 'commands', 'sessions'],
}) + '\\n')
`)
    const removeProbeRoot = runtimeProbeInternals.removeProbeRoot
    runtimeProbeInternals.removeProbeRoot = () => {
      throw Object.assign(new Error('probe root is busy'), { code: 'EBUSY' })
    }

    try {
      const result = await probeRuntimeCompatibility(runtime, identity)

      expect(result).toEqual({
        compatible: false,
        reason: expect.stringContaining('probe cleanup failed'),
      })
    } finally {
      runtimeProbeInternals.removeProbeRoot = removeProbeRoot
      if (existsSync(record)) removeProbeRoot(readFileSync(record, 'utf8'))
    }
  })

  it('bounds child output', async () => {
    const { runtime, identity } = fixture("process.stdout.write('x'.repeat(20_000))\n")

    const result = await probeRuntimeCompatibility(runtime, identity, {
      outputLimitBytes: 1_024,
    })

    expect(result).toEqual({
      compatible: false,
      reason: expect.stringContaining('output limit'),
    })
  })
})
