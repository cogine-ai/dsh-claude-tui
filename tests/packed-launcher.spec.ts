/** Packed launcher process-boundary qualification with a deterministic DSH stand-in. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
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

describe('packed dsh-claude-tui launcher', () => {
  let temporaryDirectory: string
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

    const packageDirectory = join(temporaryDirectory, 'package')
    executable = join(packageDirectory, 'lib/cli.js')
    const fakeHarnessDirectory = join(packageDirectory, 'node_modules/@deepseek-ai/dsh')
    mkdirSync(fakeHarnessDirectory, { recursive: true })
    writeFileSync(join(fakeHarnessDirectory, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.0-test',
      type: 'module',
      bin: { dsh: 'bin.js' },
      exports: { './package.json': './package.json' },
    }, undefined, 2)}\n`)
    writeFileSync(join(fakeHarnessDirectory, 'bin.js'), `
import { writeFileSync } from 'node:fs'

writeFileSync(process.env.DSH_FAKE_READY, JSON.stringify({
  pid: process.pid,
  args: process.argv.slice(2),
  cwd: process.cwd(),
  toolsMode: process.env.DSH_TOOLS_MODE,
}))
if (process.env.DSH_FAKE_EXIT_CODE !== undefined) {
  process.exit(Number(process.env.DSH_FAKE_EXIT_CODE))
}
process.on('SIGTERM', () => {
  writeFileSync(process.env.DSH_FAKE_SIGNAL, 'SIGTERM')
  process.exit(0)
})
setInterval(() => {}, 1_000)
`)
  }, 30_000)

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('forwards arguments, cwd, explicit environment, and the Harness exit code', () => {
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
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unused-signal.txt'),
        DSH_FAKE_EXIT_CODE: '23',
        DSH_TOOLS_MODE: 'native',
      },
    })

    expect(result.status).toBe(23)
    expect(result.signal).toBeNull()
    expect(JSON.parse(readFileSync(readyPath, 'utf8'))).toEqual({
      pid: expect.any(Number),
      args: [
        '--profile',
        'claude-tui',
        '--resume',
        'session-123',
        '--model',
        'deepseek/deepseek-chat',
        'inspect this repository',
      ],
      cwd: realpathSync(workspace),
      toolsMode: 'native',
    })
  })

  it('defaults to Code Mode without replacing an explicit caller value', () => {
    const readyPath = join(temporaryDirectory, 'default-mode-record.json')
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: join(temporaryDirectory, 'default-mode-dsh-home'),
      DSH_FAKE_READY: readyPath,
      DSH_FAKE_SIGNAL: join(temporaryDirectory, 'default-mode-signal.txt'),
      DSH_FAKE_EXIT_CODE: '0',
    }
    delete environment.DSH_TOOLS_MODE
    const result = spawnSync(process.execPath, [executable, '--dump-config'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })

    expect(result.status).toBe(0)
    const record = JSON.parse(readFileSync(readyPath, 'utf8')) as { toolsMode?: string }
    expect(record.toolsMode).toBe('code')
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
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unsupported-node-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      },
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
    const environment = {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_FAKE_READY: readyPath,
      DSH_FAKE_SIGNAL: join(temporaryDirectory, 'idempotent-signal.txt'),
      DSH_FAKE_EXIT_CODE: '0',
    }
    const first = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })
    expect(first.status).toBe(0)

    const markerPath = join(
      dshHome,
      'profiles/claude-tui/.dsh-claude-tui-managed.json',
    )
    const referenceTime = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(markerPath, referenceTime, referenceTime)
    const before = statSync(markerPath).mtimeMs
    const second = spawnSync(process.execPath, [executable], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: environment,
    })

    expect(second.status).toBe(0)
    expect(statSync(markerPath).mtimeMs).toBe(before)
  })

  it('refuses to adopt an existing unowned claude-tui profile', () => {
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
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'unowned-profile-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('already exists but is not launcher-managed')
    expect(readFileSync(join(profileDirectory, 'package.json'), 'utf8')).toBe(originalManifest)
    expect(existsSync(join(profileDirectory, '.dsh-claude-tui-managed.json'))).toBe(false)
    expect(existsSync(readyPath)).toBe(false)
  })

  it('forwards SIGTERM and waits for Harness to stop', async () => {
    const readyPath = join(temporaryDirectory, 'child-ready.json')
    const signalPath = join(temporaryDirectory, 'child-signal.txt')
    const dshHome = join(temporaryDirectory, 'signal-dsh-home')
    const launcher = spawn(process.execPath, [executable], {
      cwd: temporaryDirectory,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: signalPath,
      },
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

  it.runIf(process.platform !== 'win32')('refuses to replace a dangling profile symlink', () => {
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
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_FAKE_READY: readyPath,
        DSH_FAKE_SIGNAL: join(temporaryDirectory, 'dangling-link-signal.txt'),
        DSH_FAKE_EXIT_CODE: '0',
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('profile path')
    expect(lstatSync(profileDirectory).isSymbolicLink()).toBe(true)
    expect(readlinkSync(profileDirectory)).toBe(missingTarget)
    expect(existsSync(readyPath)).toBe(false)
  })
})
