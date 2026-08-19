/** Packed launcher process-boundary qualification with a deterministic DSH stand-in. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  lutimesSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function waitForFile(path: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await delay(25)
  }
  throw new Error(`timed out waiting for ${path}`)
}

function bundledEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_CLAUDE_TUI_RUNTIME: 'bundled',
    ...overrides,
  }
}

describe('packed dsh-claude-tui launcher', () => {
  let temporaryDirectory: string
  let packageDirectory: string
  let executable: string

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'dsh-claude-tui-launcher-'))
    execFileSync('corepack', ['pnpm', 'pack', '--pack-destination', temporaryDirectory], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    })
    const tarballs = readdirSync(temporaryDirectory).filter(name => name.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)
    const tarball = tarballs[0]
    if (tarball === undefined) throw new Error('pnpm pack did not produce a tarball')
    execFileSync('tar', ['-xzf', join(temporaryDirectory, tarball), '-C', temporaryDirectory])

    packageDirectory = join(temporaryDirectory, 'package')
    executable = join(packageDirectory, 'lib/cli.js')
    const fakeHarnessDirectory = join(packageDirectory, 'node_modules/@deepseek-ai/dsh')
    mkdirSync(fakeHarnessDirectory, { recursive: true })
    writeFileSync(join(fakeHarnessDirectory, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.0-rc.8',
      type: 'module',
      bin: { dsh: 'bin.js' },
      exports: { './package.json': './package.json' },
    }, undefined, 2)}\n`)
    writeFileSync(join(fakeHarnessDirectory, 'bin.js'), `
import { writeFileSync } from 'node:fs'

process.on('SIGTERM', () => {
  writeFileSync(process.env.DSH_FAKE_SIGNAL, 'SIGTERM')
  process.exit(0)
})
writeFileSync(process.env.DSH_FAKE_READY, JSON.stringify({
  pid: process.pid,
  args: process.argv.slice(2),
  cwd: process.cwd(),
  dshHome: process.env.DSH_HOME,
  launchNotice: process.env.DSH_CLAUDE_TUI_LAUNCH_NOTICE,
  toolsMode: process.env.DSH_TOOLS_MODE,
  runtimeSnapshot: process.env.DSH_CLAUDE_TUI_RUNTIME_SNAPSHOT,
}))
if (process.env.DSH_FAKE_EXIT_CODE !== undefined) {
  process.exit(Number(process.env.DSH_FAKE_EXIT_CODE))
}
setInterval(() => {}, 1_000)
`)
  }, 30_000)

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('forwards arguments, cwd, normalized tools mode, and the Harness exit code', () => {
    const readyPath = join(temporaryDirectory, 'forwarding-record.json')
    const dshHome = join(temporaryDirectory, 'forwarding-dsh-home')
    const workspace = join(temporaryDirectory, 'forwarding-workspace')
    mkdirSync(workspace)
    const result = spawnSync(process.execPath, [
      executable,
      '--resume',
      'session-123',
      '--model',
      'deepseek/deepseek-chat',
      'inspect this repository',
    ], {
      cwd: realpathSync(workspace),
      encoding: 'utf8',
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unused-signal.txt'),
        DSH_FAKE_EXIT_CODE: '23',
        DSH_TOOLS_MODE: ' native ',
      }),
    })

    expect(result.status).toBe(23)
    expect(result.signal).toBeNull()
    expect(JSON.parse(readFileSync(readyPath, 'utf8'))).toEqual({
      pid: expect.any(Number),
      args: [
        '--profile',
        'dsh-claude-tui',
        '--resume',
        'session-123',
        '--model',
        'deepseek/deepseek-chat',
        'inspect this repository',
      ],
      cwd: realpathSync(workspace),
      dshHome,
      toolsMode: 'native',
      runtimeSnapshot: JSON.stringify({
        harnessVersion: '0.1.0-rc.8',
        runtimeKind: 'bundled',
        homeKind: 'shared',
        homePath: dshHome,
        toolsMode: 'native',
      }),
    })
  })

  it('defaults to Code Mode without replacing an explicit caller value', () => {
    const readyPath = join(temporaryDirectory, 'default-mode-record.json')
    const environment: NodeJS.ProcessEnv = bundledEnvironment({
      DSH_HOME: join(temporaryDirectory, 'default-mode-dsh-home'),
      DSH_FAKE_READY: readyPath,
      DSH_FAKE_SIGNAL: join(temporaryDirectory, 'default-mode-signal.txt'),
      DSH_FAKE_EXIT_CODE: '0',
    })
    delete environment.DSH_TOOLS_MODE
    const result = spawnSync(process.execPath, [executable, '--dump-config'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })

    expect(result.status).toBe(0)
    const record = JSON.parse(readFileSync(readyPath, 'utf8')) as {
      toolsMode?: string
      runtimeSnapshot?: string
    }
    expect(record.toolsMode).toBe('code')
    expect(JSON.parse(record.runtimeSnapshot ?? '')).toMatchObject({
      runtimeKind: 'bundled',
      homeKind: 'shared',
      toolsMode: 'code',
    })
  })

  it('rejects an unsupported Node version before creating Harness state', () => {
    const dshHome = join(temporaryDirectory, 'unsupported-node-dsh-home')
    const readyPath = join(temporaryDirectory, 'unsupported-node-ready.json')
    const preload = join(temporaryDirectory, 'unsupported-node-preload.mjs')
    writeFileSync(
      preload,
      "Object.defineProperty(process.versions, 'node', { value: '22.16.0' })\n",
    )

    const result = spawnSync(process.execPath, ['--import', preload, executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unsupported-node-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      }),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Node.js 22.16.0 is unsupported')
    expect(result.stderr).toContain('22.19+ or 24+')
    expect(existsSync(dshHome)).toBe(false)
    expect(existsSync(readyPath)).toBe(false)
  })

  it('does not rewrite an already-current managed marker on repeat launch', () => {
    const dshHome = join(temporaryDirectory, 'idempotent-dsh-home')
    const readyPath = join(temporaryDirectory, 'idempotent-ready.json')
    const environment = bundledEnvironment({
      DSH_HOME: dshHome,
      DSH_FAKE_READY: readyPath,
      DSH_FAKE_SIGNAL: join(temporaryDirectory, 'idempotent-signal.txt'),
      DSH_FAKE_EXIT_CODE: '0',
    })
    const first = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })
    expect(first.status).toBe(0)

    const markerPath = join(
      dshHome,
      'profiles/dsh-claude-tui/.dsh-claude-tui-managed.json',
    )
    const bundleLink = join(
      dshHome,
      'profiles/dsh-claude-tui/node_modules/dsh-claude-tui',
    )
    const referenceTime = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(markerPath, referenceTime, referenceTime)
    lutimesSync(bundleLink, referenceTime, referenceTime)
    const before = statSync(markerPath).mtimeMs
    const bundleBefore = lstatSync(bundleLink).mtimeMs
    const packageAlias = join(temporaryDirectory, 'idempotent-package-alias')
    symlinkSync(packageDirectory, packageAlias, 'dir')
    const second = spawnSync(process.execPath, [
      '--preserve-symlinks-main',
      join(packageAlias, 'lib/cli.js'),
    ], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })

    expect(second.status).toBe(0)
    expect(statSync(markerPath).mtimeMs).toBe(before)
    expect(lstatSync(bundleLink).mtimeMs).toBe(bundleBefore)
  })

  it('leaves an unowned legacy claude-tui profile untouched', () => {
    const dshHome = join(temporaryDirectory, 'unowned-profile-dsh-home')
    const profileDirectory = join(dshHome, 'profiles/claude-tui')
    const readyPath = join(temporaryDirectory, 'unowned-profile-ready.json')
    mkdirSync(profileDirectory, { recursive: true })
    const originalManifest = '{\n  "name": "user-owned-profile",\n  "userMarker": "keep"\n}\n'
    writeFileSync(join(profileDirectory, 'package.json'), originalManifest)
    writeFileSync(join(profileDirectory, 'cordis.patch.yml'), '# user owned\n[]\n')

    const result = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unowned-profile-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      }),
    })

    expect(result.status).toBe(0)
    expect(readFileSync(join(profileDirectory, 'package.json'), 'utf8')).toBe(originalManifest)
    expect(existsSync(join(profileDirectory, '.dsh-claude-tui-managed.json'))).toBe(false)
    expect(existsSync(join(
      dshHome,
      'profiles/dsh-claude-tui/.dsh-claude-tui-managed.json',
    ))).toBe(true)
    expect(JSON.parse(readFileSync(readyPath, 'utf8'))).toMatchObject({
      args: ['--profile', 'dsh-claude-tui'],
    })
  })

  it('uses a compatible DSH associated with the requested home after an isolated probe', () => {
    const dshHome = join(temporaryDirectory, 'system-runtime-dsh-home')
    const systemRecord = join(temporaryDirectory, 'system-runtime-record.json')
    const bundledRecord = join(temporaryDirectory, 'system-runtime-bundled-record.json')
    const systemPackage = join(dshHome, 'profiles/node_modules/@deepseek-ai/dsh')
    mkdirSync(systemPackage, { recursive: true })
    writeFileSync(join(systemPackage, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.0-rc.8',
      type: 'module',
      bin: { dsh: 'bin.js' },
    }, undefined, 2)}\n`)
    writeFileSync(join(systemPackage, 'bin.js'), `
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const token = process.env.DSH_CLAUDE_TUI_PROBE_TOKEN
if (token !== undefined) {
  const manifest = JSON.parse(readFileSync(join(
    process.env.DSH_HOME,
    'profiles/dsh-claude-tui/node_modules/dsh-claude-tui/package.json',
  ), 'utf8'))
  process.stdout.write('DSH_CLAUDE_TUI_PROBE_RESULT ' + JSON.stringify({
    token,
    package: 'dsh-claude-tui',
    version: manifest.version,
    services: ['agentDefaultModel', 'agents', 'commands', 'sessions'],
  }) + '\\n')
} else {
  writeFileSync(${JSON.stringify(systemRecord)}, JSON.stringify({
    runtime: 'system',
    args: process.argv.slice(2),
    dshHome: process.env.DSH_HOME,
  }))
}
`)

    const result = spawnSync(process.execPath, [executable, 'use existing dsh'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: bundledRecord,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'system-runtime-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
        DSH_CLAUDE_TUI_RUNTIME: 'auto',
      },
    })

    expect(result.status).toBe(0)
    expect(existsSync(bundledRecord)).toBe(false)
    expect(JSON.parse(readFileSync(systemRecord, 'utf8'))).toEqual({
      runtime: 'system',
      args: ['--profile', 'dsh-claude-tui', 'use existing dsh'],
      dshHome,
    })
  })

  it('falls back to an isolated home only when the default home has a hard conflict', () => {
    const userHome = join(temporaryDirectory, 'isolated-fallback-user')
    const sharedHome = join(userHome, '.dsh')
    const legacy = join(sharedHome, 'profiles/claude-tui')
    const readyPath = join(temporaryDirectory, 'isolated-fallback-ready.json')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, '.dsh-claude-tui-managed.json'), '{broken')

    const result = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: bundledEnvironment({
        HOME: userHome,
        USERPROFILE: userHome,
        DSH_HOME: undefined,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'isolated-fallback-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      }),
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Using isolated DSH_HOME')
    expect(result.stderr).toContain('sessions and credentials')
    const isolatedHome = join(userHome, '.dsh-claude-tui')
    expect(JSON.parse(readFileSync(readyPath, 'utf8'))).toMatchObject({
      args: ['--profile', 'dsh-claude-tui'],
      dshHome: isolatedHome,
      launchNotice: expect.stringContaining('were not copied'),
    })
    expect(readFileSync(join(legacy, '.dsh-claude-tui-managed.json'), 'utf8')).toBe('{broken')
    expect(existsSync(join(
      isolatedHome,
      'profiles/dsh-claude-tui/.dsh-claude-tui-managed.json',
    ))).toBe(true)
  })

  it('fails instead of replacing an explicit DSH_HOME with isolated state', () => {
    const dshHome = join(temporaryDirectory, 'explicit-conflict-dsh-home')
    const legacy = join(dshHome, 'profiles/claude-tui')
    const readyPath = join(temporaryDirectory, 'explicit-conflict-ready.json')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, '.dsh-claude-tui-managed.json'), '{broken')

    const result = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'explicit-conflict-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      }),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('explicit DSH_HOME')
    expect(result.stderr).toContain('cannot read managed state')
    expect(existsSync(readyPath)).toBe(false)
    expect(readFileSync(join(legacy, '.dsh-claude-tui-managed.json'), 'utf8')).toBe('{broken')
  })

  it('forwards SIGTERM and waits for Harness to stop', async () => {
    const readyPath = join(temporaryDirectory, 'child-ready.json')
    const signalPath = join(temporaryDirectory, 'child-signal.txt')
    const dshHome = join(temporaryDirectory, 'signal-dsh-home')
    const launcher = spawn(process.execPath, [executable], {
      cwd: temporaryDirectory,
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: signalPath,
      }),
      stdio: 'ignore',
    })
    const outcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      launcher.once('exit', (code, signal) => resolve({ code, signal }))
    })

    await waitForFile(readyPath)
    const child = JSON.parse(readFileSync(readyPath, 'utf8')) as { pid: number }
    launcher.kill('SIGTERM')
    const exited = await outcome
    let childReceivedSignal = false
    try {
      await waitForFile(signalPath, 750)
      childReceivedSignal = true
    } catch {
      // The assertions below report the failed signal contract after cleanup.
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        // A correctly forwarded signal has already stopped the child.
      }
    }

    expect(exited).toEqual({ code: 0, signal: null })
    expect(childReceivedSignal).toBe(true)
    expect(readFileSync(signalPath, 'utf8')).toBe('SIGTERM')
  }, 10_000)

  it.runIf(process.platform !== 'win32')('leaves a dangling legacy profile symlink untouched', () => {
    const dshHome = join(temporaryDirectory, 'dangling-link-dsh-home')
    const profilesDirectory = join(dshHome, 'profiles')
    const profileDirectory = join(profilesDirectory, 'claude-tui')
    const missingTarget = join(temporaryDirectory, 'missing-user-profile')
    const readyPath = join(temporaryDirectory, 'dangling-link-ready.json')
    mkdirSync(profilesDirectory, { recursive: true })
    symlinkSync(missingTarget, profileDirectory, 'dir')

    const result = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: bundledEnvironment({
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'dangling-link-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      }),
    })

    expect(result.status).toBe(0)
    expect(lstatSync(profileDirectory).isSymbolicLink()).toBe(true)
    expect(readlinkSync(profileDirectory)).toBe(missingTarget)
    expect(existsSync(join(
      dshHome,
      'profiles/dsh-claude-tui/.dsh-claude-tui-managed.json',
    ))).toBe(true)
    expect(existsSync(readyPath)).toBe(true)
  })
})
