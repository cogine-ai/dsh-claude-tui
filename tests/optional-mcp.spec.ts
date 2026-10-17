/** Qualify GenAI's optional SDK v1 bridge locally, without a model/provider request. */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type ClientModule = typeof import('@modelcontextprotocol/sdk/client/index.js')
type StdioModule = typeof import('@modelcontextprotocol/sdk/client/stdio.js')

interface GenAiCallableTool {
  tool(): Promise<{
    functionDeclarations?: Array<{ name?: string; parametersJsonSchema?: unknown }>
  }>
  callTool(calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<unknown[]>
}

interface StdioEvent {
  event: string
  pid?: number
  credentialKeys?: string[]
  message?: {
    method: string
    params?: { cursor?: string; name?: string; arguments?: Record<string, unknown> }
  }
}

async function bounded<T>(promise: Promise<T>, description: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Optional MCP timeout: ${description}`)), 10_000)
    })])
  } finally {
    clearTimeout(timeout)
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (isRunning(pid)) {
    if (Date.now() >= deadline) throw new Error('Optional MCP fixture did not exit')
    await delay(20)
  }
}

function sdkManifest(entry: string): { version: string } {
  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version: string }
      if (manifest.name === '@modelcontextprotocol/sdk') return manifest
    }
    if (dirname(directory) === directory) throw new Error('Cannot find GenAI-resolved SDK manifest')
  }
}

describe('optional workspace MCP compatibility', () => {
  it('lists paginated SDK v1 tools and calls them through the GenAI MCP bridge', async () => {
    const workspaceRequire = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
    const dshRequire = createRequire(workspaceRequire.resolve('@deepseek-ai/dsh/package.json'))
    const piOwnerPath = dshRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')
    expect(JSON.parse(readFileSync(piOwnerPath, 'utf8')).version).toBe('0.2.1-rc.2')
    const piOwnerRequire = createRequire(piOwnerPath)
    // pi-ai exposes only an import entry and hides its manifest. Use this
    // owner's lookup paths, then resolve the symlink to keep its peer context.
    const piManifestPath = piOwnerRequire.resolve.paths('@earendil-works/pi-ai')
      ?.map(directory => join(directory, '@earendil-works/pi-ai/package.json')).find(existsSync)
    if (!piManifestPath) throw new Error('DSH pi-ai owner is missing its pi-ai dependency')
    const piRequire = createRequire(realpathSync(piManifestPath))
    const genAiEntry = piRequire.resolve('@google/genai')
    const genAiRequire = createRequire(genAiEntry)
    const clientEntry = genAiRequire.resolve('@modelcontextprotocol/sdk/client/index.js')
    expect(sdkManifest(clientEntry).version).toBe('1.31.0')
    const { Client } = genAiRequire('@modelcontextprotocol/sdk/client/index.js') as ClientModule
    const { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } =
      genAiRequire('@modelcontextprotocol/sdk/client/stdio.js') as StdioModule
    const { mcpToTool } = piRequire('@google/genai') as {
      mcpToTool(client: InstanceType<ClientModule['Client']>, config: { timeout: number }): GenAiCallableTool
    }

    const directory = mkdtempSync(join(tmpdir(), 'dsh-optional-mcp-'))
    const eventPath = join(directory, 'stdio-events.jsonl')
    const events = (): StdioEvent[] => existsSync(eventPath)
      ? readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    // SDK v1 merges a small inherited environment even with env: {}. Override
    // every inherited name explicitly, then supply only test-owned base values.
    const env = {
      ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(name => [name, ''])),
      HOME: directory,
      USERPROFILE: directory,
      PATH: dirname(process.execPath),
      TMPDIR: directory,
      TEMP: directory,
      LANG: 'C',
      LC_ALL: 'C',
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url)), eventPath],
      cwd: directory,
      env,
      stderr: 'pipe',
    })
    transport.stderr?.on('data', () => {})
    const client = new Client({ name: 'local-genai-mcp-compat', version: '1.0.0' })
    let pid: number | undefined
    try {
      await bounded(client.connect(transport), 'stdio connection')
      pid = transport.pid ?? undefined
      expect(pid).toBeGreaterThan(0)
      expect(events().find(event => event.event === 'started')?.credentialKeys).toEqual([])

      const bridge = mcpToTool(client, { timeout: 5_000 })
      const tool = await bounded(bridge.tool(), 'GenAI tool declarations')
      expect(tool.functionDeclarations?.map(declaration => declaration.name).sort())
        .toEqual(['add', 'admin.reset', 'fail', 'slow', 'structured'].sort())
      expect(tool.functionDeclarations?.find(declaration => declaration.name === 'add')?.parametersJsonSchema)
        .toMatchObject({
          type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        })
      // Unlike SDK v2's aggregation, SDK v1 listTools returns one page. GenAI's
      // public mcpToTool walks nextCursor itself, including the reused cursor.
      // The real wire requests prove the bridge fetched all three fixture pages.
      const lists = events().filter(event => event.message?.method === 'tools/list')
      expect(lists.map(event => event.message?.params?.cursor)).toEqual([undefined, 'reused', 'reused'])

      const result = await bounded(bridge.callTool([{ name: 'add', args: { a: 4, b: 6 } }]), 'GenAI tool call')
      expect(result).toEqual([{
        functionResponse: {
          name: 'add',
          response: { content: [{ type: 'text', text: '10' }] },
        },
      }])
      expect(events().filter(event => event.message?.method === 'tools/call').map(event => event.message?.params))
        .toEqual([{ name: 'add', arguments: { a: 4, b: 6 } }])
    } finally {
      pid ??= transport.pid ?? events().find(event => event.event === 'started')?.pid
      try {
        await bounded(client.close(), 'SDK client cleanup')
        await bounded(transport.close(), 'stdio transport cleanup')
        if (pid !== undefined) {
          await waitForExit(pid, 2_000)
          expect(events().some(event => event.event === 'closed' && event.pid === pid)).toBe(true)
        }
      } finally {
        try {
          if (pid !== undefined && isRunning(pid)) {
            expect(pid).toBeGreaterThan(0)
            expect(pid).not.toBe(process.pid)
            process.kill(pid, 'SIGTERM')
            try {
              await waitForExit(pid, 1_000)
            } catch {
              if (isRunning(pid)) process.kill(pid, 'SIGKILL')
              await waitForExit(pid, 2_000)
            }
          }
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      }
    }
  }, 40_000)
})
