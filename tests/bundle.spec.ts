/** Public bundle artifact contracts for a self-contained installed profile. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

interface MockRequest {
  headers: IncomingMessage['headers']
  body: Record<string, unknown>
}

interface MockDeepSeekServer {
  baseURL: string
  requests: MockRequest[]
  close(): Promise<void>
}

function writeSse(response: import('node:http').ServerResponse, events: readonly unknown[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) {
    response.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`)
  }
  response.end()
}

async function startMockDeepSeekServer(apiKey: string): Promise<MockDeepSeekServer> {
  const requests: MockRequest[] = []
  const server: Server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (request.method !== 'POST' || pathname !== '/chat/completions') {
        response.writeHead(404).end()
        return
      }
      if (request.headers.authorization !== `Bearer ${apiKey}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'invalid test credential' } }))
        return
      }
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'invalid test request body' } }))
        return
      }
      requests.push({ headers: request.headers, body })
      const tools = Array.isArray(body.tools) ? body.tools : []
      const messages = Array.isArray(body.messages) ? body.messages : []
      const hasToolResult = messages.some((message) => {
        return typeof message === 'object' && message !== null
          && (message as { role?: unknown }).role === 'tool'
      })
      if (tools.length > 0 && !hasToolResult) {
        const toolArguments = JSON.stringify({
          code: 'return "packed tool result"',
          description: 'return a deterministic packed-artifact marker',
        })
        writeSse(response, [
          { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call-packed-e2e',
                  type: 'function',
                  function: { name: 'run_code', arguments: toolArguments },
                }],
              },
            }],
          },
          {
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
          '[DONE]',
        ])
        return
      }
      const text = tools.length > 0 ? 'packed artifact reply' : 'Packed artifact session'
      writeSse(response, [
        { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
        { choices: [{ delta: { content: text } }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        },
        '[DONE]',
      ])
    })
  })
  await new Promise<void>((resolveListen) => { server.listen(0, '127.0.0.1', resolveListen) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server did not bind a TCP port')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => {
        server.close(error => { error === undefined ? resolveClose() : reject(error) })
      })
    },
  }
}

function stringEnvironment(overrides: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides })
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

async function runPackedTui(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  expectedText: string,
): Promise<{ output: string; exitCode: number; signal: number }> {
  let output = ''
  const child = pty.spawn(process.execPath, [executable, ...args], {
    cwd,
    env,
    cols: 100,
    rows: 30,
    name: 'xterm-256color',
  })
  child.onData(data => { output += data })
  let exitOutcome: { exitCode: number; signal: number } | undefined
  const exited = new Promise<{ exitCode: number; signal: number }>((resolveExit) => {
    child.onExit(({ exitCode, signal }) => {
      exitOutcome = { exitCode, signal: signal ?? 0 }
      resolveExit(exitOutcome)
    })
  })
  const deadline = Date.now() + 30_000
  while (!output.includes(expectedText)) {
    if (exitOutcome !== undefined) {
      throw new Error(
        `packed TUI exited early (code ${exitOutcome.exitCode}, signal ${exitOutcome.signal}) `
        + `before rendering ${JSON.stringify(expectedText)}\n${output}`,
      )
    }
    if (Date.now() >= deadline) {
      child.kill('SIGKILL')
      throw new Error(`packed TUI did not render ${JSON.stringify(expectedText)}\n${output}`)
    }
    await delay(25)
  }
  await delay(300)
  child.write('\u0004')
  await delay(100)
  child.write('\u0004')
  let exitTimeout: NodeJS.Timeout | undefined
  const exit = await Promise.race([
    exited,
    new Promise<never>((_resolve, reject) => {
      exitTimeout = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`packed TUI did not exit after Ctrl+D\n${output}`))
      }, 10_000)
    }),
  ]).finally(() => {
    if (exitTimeout !== undefined) clearTimeout(exitTimeout)
  })
  return { output, ...exit }
}

describe('dsh-claude-tui bundle', () => {
  let packDirectory: string
  let packageDirectory: string
  let tarballPath: string
  let installDirectory: string
  let installedExecutable: string

  beforeAll(() => {
    packDirectory = mkdtempSync(join(tmpdir(), 'dsh-claude-tui-pack-'))
    execFileSync('corepack', ['pnpm', 'pack', '--pack-destination', packDirectory], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    })

    const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)

    const tarball = tarballs[0]
    if (tarball === undefined) throw new Error('pnpm pack did not produce a tarball')
    tarballPath = join(packDirectory, tarball)
    execFileSync('tar', ['-xzf', tarballPath, '-C', packDirectory])
    packageDirectory = join(packDirectory, 'package')

    installDirectory = join(packDirectory, 'installed')
    execFileSync('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(packDirectory, 'npm-cache'),
      '--prefix',
      installDirectory,
      tarballPath,
    ], { stdio: 'pipe' })
    installedExecutable = join(
      installDirectory,
      'node_modules/dsh-claude-tui/lib/cli.js',
    )
  }, 600_000)

  afterAll(() => {
    rmSync(packDirectory, { recursive: true, force: true })
  })

  it('exposes structured user questions through the installed plugin closure', () => {
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
  }, 30_000)

  it('contains only the approved publishable runtime artifact', () => {
    const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .sort()
    expect(entries).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/README.zh-CN.md',
      'package/DISCLAIMER.md',
      'package/cordis.patch.yml',
      'package/docs/assets/terminal-preview.svg',
      'package/docs/launcher-environment-compatibility.md',
      'package/docs/model-provider-interactions.md',
      'package/docs/release-hardening-v0.1.0.md',
      'package/docs/visual-qualification-2.1.227.md',
      'package/lib/cli.d.ts',
      'package/lib/cli.js',
      'package/lib/index.d.ts',
      'package/lib/index.js',
      'package/lib/startup.d.ts',
      'package/lib/startup.js',
      'package/npm-shrinkwrap.json',
      'package/package.json',
    ].sort())

    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
    ) as {
      name?: string
      version?: string
      bin?: Record<string, string>
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      repository?: { url?: string }
      homepage?: string
      bugs?: { url?: string }
      keywords?: string[]
    }
    expect(manifest).toMatchObject({
      name: 'dsh-claude-tui',
      version: '0.1.2',
      bin: {
        'dsh-claude-tui': 'lib/cli.js',
        dshtui: 'lib/cli.js',
      },
      dependencies: {
        '@deepseek-ai/dsh': '0.1.0-rc.6',
        semver: '7.8.5',
      },
      repository: { url: 'git+https://github.com/cogine-ai/dsh-claude-tui.git' },
      homepage: 'https://github.com/cogine-ai/dsh-claude-tui#readme',
      bugs: { url: 'https://github.com/cogine-ai/dsh-claude-tui/issues' },
    })
    expect(manifest.keywords).toContain('deepseek-harness')
    expect(manifest.dependencies?.['@aws-sdk/credential-provider-node']).toBe('3.972.79')
    const dshPeers = Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.length).toBeGreaterThan(0)
    expect(dshPeers.every(([, range]) => range === '>=0.1.0-rc.6 <0.1.1')).toBe(true)
    expect(statSync(join(packageDirectory, 'lib/cli.js')).mode & 0o111).not.toBe(0)

    const shrinkwrap = JSON.parse(
      readFileSync(join(packageDirectory, 'npm-shrinkwrap.json'), 'utf8'),
    ) as {
      lockfileVersion?: number
      packages?: Record<string, {
        version?: string
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }>
    }
    expect(shrinkwrap.lockfileVersion).toBe(3)
    expect(shrinkwrap.packages?.['']?.dependencies).toEqual(manifest.dependencies)
    expect(shrinkwrap.packages?.['']?.peerDependencies).toEqual(manifest.peerDependencies)
    expect(shrinkwrap.packages?.['']?.dependencies).toMatchObject({
      '@aws-sdk/credential-provider-node': '3.972.79',
      '@deepseek-ai/dsh': '0.1.0-rc.6',
    })
    expect(shrinkwrap.packages?.['node_modules/@aws-sdk/credential-provider-node']?.version)
      .toBe('3.972.79')
    const dshVersions = Object.entries(shrinkwrap.packages ?? {})
      .filter(([path]) => /node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/u.test(path))
      .map(([, entry]) => entry.version)
    expect(dshVersions.length).toBeGreaterThan(0)
    expect(new Set(dshVersions)).toEqual(new Set(['0.1.0-rc.6']))

    const installedRequire = createRequire(
      join(installDirectory, 'node_modules/dsh-claude-tui/package.json'),
    )
    const installedDsh = JSON.parse(
      readFileSync(installedRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'),
    ) as { version?: string }
    const installedAwsCredentialProvider = JSON.parse(
      readFileSync(
        installedRequire.resolve('@aws-sdk/credential-provider-node/package.json'),
        'utf8',
      ),
    ) as { version?: string }
    expect(installedDsh.version).toBe('0.1.0-rc.6')
    expect(installedAwsCredentialProvider.version).toBe('3.972.79')

    const publishedText = entries
      .filter(entry => !entry.endsWith('.svg'))
      .map(entry => readFileSync(join(packDirectory, entry), 'utf8'))
      .join('\n')
    expect(publishedText).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u)
    expect(publishedText).not.toMatch(/\b(?:ghp|github_pat|npm)_[A-Za-z0-9_]{20,}\b/u)
    expect(publishedText).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}\b/u)
  }, 30_000)

  it('publishes a side-effect-free executable help surface', () => {
    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
    ) as { bin?: Record<string, string> }
    const dshHome = join(packDirectory, 'help-dsh-home')
    const executable = manifest.bin?.['dsh-claude-tui']

    expect(executable).toBe('lib/cli.js')
    if (executable === undefined) throw new Error('packed manifest exposes no dsh-claude-tui bin')
    const result = spawnSync(process.execPath, [join(packageDirectory, executable), '--help'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_CLAUDE_TUI_RUNTIME: 'bundled',
      },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: dsh-claude-tui')
    expect(result.stderr).toBe('')
    expect(existsSync(dshHome)).toBe(false)
  }, 30_000)

  it('installs canonical and short command names for the same CLI', () => {
    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
    ) as { bin?: Record<string, string> }
    expect(manifest.bin).toEqual({
      'dsh-claude-tui': 'lib/cli.js',
      dshtui: 'lib/cli.js',
    })

    for (const command of ['dsh-claude-tui', 'dshtui']) {
      const dshHome = join(packDirectory, `${command}-version-dsh-home`)
      const installedCommand = join(installDirectory, 'node_modules/.bin', command)
      expect(realpathSync(installedCommand)).toBe(realpathSync(installedExecutable))

      const result = spawnSync(installedCommand, ['--version'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DSH_HOME: dshHome,
          DSH_CLAUDE_TUI_RUNTIME: 'bundled',
        },
      })
      expect(result).toMatchObject({ status: 0, stdout: '0.1.2\n', stderr: '' })
      expect(existsSync(dshHome)).toBe(false)
    }
  }, 30_000)

  it('prints the package version without creating Harness state', () => {
    const dshHome = join(packDirectory, 'version-dsh-home')
    const result = spawnSync(process.execPath, [join(packageDirectory, 'lib/cli.js'), '--version'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_CLAUDE_TUI_RUNTIME: 'bundled',
      },
    })

    expect(result).toMatchObject({ status: 0, stdout: '0.1.2\n', stderr: '' })
    expect(existsSync(dshHome)).toBe(false)
  })

  it('initializes and boots the managed profile from the installed tarball', () => {
    const workspaceDirectory = join(packDirectory, 'workspace')
    const dshHome = join(packDirectory, 'first-run-dsh-home')
    mkdirSync(workspaceDirectory)
    const result = spawnSync(process.execPath, [installedExecutable, '--dump-config'], {
      cwd: workspaceDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_CLAUDE_TUI_RUNTIME: 'bundled',
      },
      timeout: 30_000,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('claude-tui-startup')
    expect(result.stderr).toBe('')

    const profileDirectory = join(dshHome, 'profiles/dsh-claude-tui')
    const manifest = JSON.parse(
      readFileSync(join(profileDirectory, 'package.json'), 'utf8'),
    ) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      'dsh-claude-tui',
    ])
    expect(existsSync(join(profileDirectory, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(profileDirectory, '.dsh-claude-tui-managed.json'))).toBe(true)
  }, 120_000)

  it('uses its pinned Harness and preserves existing user state across repeat runs', () => {
    const workspaceDirectory = join(packDirectory, 'repeat-workspace')
    const dshHome = join(packDirectory, 'repeat-dsh-home')
    const fakeBinDirectory = join(packDirectory, 'fake-global-bin')
    const fakeDshCalled = join(packDirectory, 'fake-global-dsh-called')
    mkdirSync(workspaceDirectory)
    mkdirSync(fakeBinDirectory)
    const fakeDsh = join(fakeBinDirectory, 'dsh')
    writeFileSync(
      fakeDsh,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(fakeDshCalled)}, 'called')\n`,
    )
    chmodSync(fakeDsh, 0o755)

    const env = {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_CLAUDE_TUI_RUNTIME: 'bundled',
      PATH: `${fakeBinDirectory}${delimiter}${process.env.PATH ?? ''}`,
    }
    const first = spawnSync(process.execPath, [installedExecutable, '--dump-config'], {
      cwd: workspaceDirectory,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    })
    expect(first.status).toBe(0)

    const profileDirectory = join(dshHome, 'profiles/dsh-claude-tui')
    const manifestPath = join(profileDirectory, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.userMarker = 'preserve-me'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    const userPatch = '# user-owned override marker\n[]\n'
    writeFileSync(join(profileDirectory, 'cordis.patch.yml'), userPatch)

    const unrelatedProfile = join(dshHome, 'profiles/unrelated')
    mkdirSync(unrelatedProfile)
    writeFileSync(join(unrelatedProfile, 'user-marker.txt'), 'keep this profile')
    writeFileSync(join(dshHome, 'user-marker.txt'), 'keep this home state')

    const second = spawnSync(process.execPath, [installedExecutable, '--dump-config'], {
      cwd: workspaceDirectory,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    })
    expect(second.status).toBe(0)

    const after = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      userMarker?: unknown
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(after.userMarker).toBe('preserve-me')
    expect(after.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      'dsh-claude-tui',
    ])
    expect(readFileSync(join(profileDirectory, 'cordis.patch.yml'), 'utf8')).toBe(userPatch)
    expect(readFileSync(join(unrelatedProfile, 'user-marker.txt'), 'utf8')).toBe('keep this profile')
    expect(readFileSync(join(dshHome, 'user-marker.txt'), 'utf8')).toBe('keep this home state')
    expect(existsSync(fakeDshCalled)).toBe(false)
  }, 60_000)

  it('completes a local-mock tool turn and resumes its packed Session', async () => {
    const apiKey = 'packed-e2e-key'
    const server = await startMockDeepSeekServer(apiKey)
    const dshHome = join(packDirectory, 'turn-dsh-home')
    const workspace = join(packDirectory, 'turn-workspace')
    mkdirSync(workspace)
    const env = stringEnvironment({
      DSH_HOME: dshHome,
      DSH_CLAUDE_TUI_RUNTIME: 'bundled',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_BASE_URL: server.baseURL,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    })
    try {
      const first = await runPackedTui(
        installedExecutable,
        ['--session-id', 'packed-e2e-session', 'run the packed artifact tool turn'],
        workspace,
        env,
        'packed artifact reply',
      )
      expect(first.exitCode).toBe(0)
      expect(first.signal).toBe(0)
      expect(first.output).toContain('Welcome back!')
      expect(first.output).toContain('Tips for getting started')
      expect(first.output).toContain('DSH Claude TUI')
      expect(first.output).toContain('v0.1.2')
      expect(first.output).toContain('Harness 0.1.0-rc.6 · bundled · PTC')
      expect(first.output).toContain('powered by dsh')
      expect(first.output).toContain('Run /help for commands and shortcuts')
      expect(first.output).not.toContain('Use /provider to configure API access')
      expect(first.output).not.toContain("What's new")
      expect(first.output).toContain('packed tool result')
      expect(first.output).not.toContain(apiKey)

      const resumed = await runPackedTui(
        installedExecutable,
        ['--resume', 'packed-e2e-session'],
        workspace,
        env,
        'packed artifact reply',
      )
      expect(resumed.exitCode).toBe(0)
      expect(resumed.signal).toBe(0)
      expect(resumed.output).not.toContain('Welcome back!')
      expect(resumed.output).toContain('run the packed artifact tool turn')
      expect(resumed.output).not.toContain(apiKey)

      const modelRequests = server.requests.filter(request => Array.isArray(request.body.tools))
      expect(modelRequests.length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(modelRequests.map(request => request.body))).toContain('packed tool result')
    } finally {
      await server.close()
    }
  }, 120_000)

  it('completes a packed tool turn through a physically separate compatible DSH', async () => {
    const apiKey = 'external-dsh-e2e-key'
    const server = await startMockDeepSeekServer(apiKey)
    const dshHome = join(packDirectory, 'external-dsh-turn-home')
    const workspace = join(packDirectory, 'external-dsh-turn-workspace')
    const modules = join(dshHome, 'profiles/node_modules/@deepseek-ai')
    const sourceRequire = createRequire(join(repositoryRoot, 'package.json'))
    const externalDshRoot = dirname(
      sourceRequire.resolve('@deepseek-ai/dsh/package.json'),
    )
    mkdirSync(workspace)
    mkdirSync(modules, { recursive: true })
    symlinkSync(externalDshRoot, join(modules, 'dsh'), 'dir')
    const env = stringEnvironment({
      DSH_HOME: dshHome,
      DSH_CLAUDE_TUI_RUNTIME: 'auto',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_BASE_URL: server.baseURL,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    })
    try {
      const outcome = await runPackedTui(
        installedExecutable,
        ['--session-id', 'external-dsh-e2e-session', 'run through the external dsh'],
        workspace,
        env,
        'packed artifact reply',
      )

      expect(outcome.exitCode).toBe(0)
      expect(outcome.signal).toBe(0)
      expect(outcome.output).toContain('Harness 0.1.0-rc.6 · system · PTC')
      expect(outcome.output).toContain('packed tool result')
      expect(outcome.output).not.toContain(apiKey)
      expect(realpathSync(join(modules, 'dsh'))).toBe(realpathSync(externalDshRoot))
      expect(server.requests.some(request => Array.isArray(request.body.tools))).toBe(true)
    } finally {
      await server.close()
    }
  }, 120_000)
})
