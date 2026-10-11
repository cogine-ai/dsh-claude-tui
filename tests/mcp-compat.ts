/** Real DSH MCP bridge qualification, reusable from source and installed tarball contexts. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface RpcMessage {
  id?: string | number
  method: string
  params?: { name?: string; arguments?: Record<string, unknown>; cursor?: string; requestId?: string | number }
}
interface Fixture {
  requests: RpcMessage[]
  toolLists: number
  handle(message: RpcMessage): unknown
}
interface ToolResult {
  isError: boolean
  content: Array<{ type: string; text?: string }>
  value?: unknown
  error?: { message?: string; info?: { code?: string } }
}
interface BridgeContext {
  plugin(plugin: unknown): unknown
  fiber: { dispose(): Promise<void> }
  tools: {
    schemas(): Array<{ name: string }>
    execute(input: { signal: AbortSignal; callId: string; name: string; arguments: Record<string, unknown> }): Promise<ToolResult>
  }
}
interface BridgeModules {
  Context: new () => BridgeContext
  SystemPrompt: unknown
  ToolRuntime: unknown
  apply(ctx: BridgeContext, config: Record<string, unknown>): Promise<void>
}
interface StdioEvent { event: string; pid?: number; message?: RpcMessage; credentialKeys?: string[] }
interface HttpEvent { verb: string; headers: IncomingMessage['headers']; message?: RpcMessage }

const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url))
const toolTimeoutMs = 8_000

async function until(predicate: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    assert(Date.now() < deadline, `MCP compatibility timed out: ${description}`)
    await delay(20)
  }
}

async function bounded<T>(promise: Promise<T>, description: string, timeoutMs = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP compatibility timed out: ${description}`)), timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
  }
}

function packageManifest(entry: string, expectedName: string): { path: string; version: string } {
  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    const path = join(directory, 'package.json')
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; version?: string }
      if (manifest.name === expectedName) {
        assert.equal(typeof manifest.version, 'string')
        return { path, version: manifest.version! }
      }
    }
    assert.notEqual(dirname(directory), directory, `Cannot find manifest for ${expectedName}`)
  }
}

function mcpOwnerRequire(packageJsonPath: string): NodeRequire {
  const consumerRequire = createRequire(resolve(packageJsonPath))
  // A direct dependency can be a different copy from DSH's actual bridge.
  // Both source and packed consumers must qualify the owner selected by DSH.
  const dshRequire = createRequire(consumerRequire.resolve('@deepseek-ai/dsh/package.json'))
  return createRequire(dshRequire.resolve('@deepseek-ai/dsh-mcp-client/package.json'))
}

async function loadBridge(ownerRequire: NodeRequire): Promise<BridgeModules> {
  const load = (name: string): Promise<Record<string, unknown>> => import(pathToFileURL(ownerRequire.resolve(name)).href)
  const [cordis, systemPrompt, tools, bridge] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-mcp-client'),
  ])
  return {
    Context: cordis.Context as BridgeModules['Context'], SystemPrompt: systemPrompt.default,
    ToolRuntime: tools.default, apply: bridge.apply as BridgeModules['apply'],
  }
}

async function mount(modules: BridgeModules): Promise<BridgeContext> {
  const ctx = new modules.Context()
  try {
    await ctx.plugin(modules.SystemPrompt)
    await ctx.plugin(modules.ToolRuntime)
    return ctx
  } catch (error) {
    await bounded(ctx.fiber.dispose(), 'registry startup cleanup')
    throw error
  }
}

function normalizedName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 51)}_${hash}`
}

async function verifyTools(ctx: BridgeContext, serverName: string): Promise<void> {
  const names = ctx.tools.schemas().map(({ name }) => name)
  const publicNames = ['add', 'admin.reset', 'fail', 'slow', 'structured'].map(name => normalizedName(serverName, name))
  assert.deepEqual(names.filter(name => name.startsWith(`mcp__${serverName}__`)).sort(), [...publicNames].sort())
  assert(!names.includes('add'), 'DSH must register the public name, not the wire name')
  let call = 0
  const execute = (rawName: string, args: Record<string, unknown> = {}) => bounded(ctx.tools.execute({
    signal: new AbortController().signal, callId: `${serverName}-${++call}`,
    name: normalizedName(serverName, rawName), arguments: args,
  }), `${serverName}: ${rawName}`)
  const sum = await execute('add', { a: 2, b: 3 })
  assert.equal(sum.isError, false)
  assert.equal(sum.content[0]?.text, '5')
  const dotted = await execute('admin.reset')
  assert.equal(dotted.isError, false)
  assert.equal(dotted.content[0]?.text, 'reset done')
  const failure = await execute('fail')
  assert.equal(failure.isError, true)
  assert.match(failure.content[0]?.text ?? '', /fixture failure/)
  const structured = await execute('structured')
  assert.equal(structured.isError, false)
  assert.deepEqual(structured.value, {
    content: [{ type: 'text', text: '42' }], structuredContent: { answer: 42 },
  })
}

async function verifyCancellation(
  ctx: BridgeContext, serverName: string, messages: () => RpcMessage[],
): Promise<void> {
  const controller = new AbortController()
  const execution = ctx.tools.execute({
    signal: controller.signal, callId: `${serverName}-cancel`,
    name: normalizedName(serverName, 'slow'), arguments: {},
  })
  // Attach the bound immediately, so an early rejection cannot escape the test.
  const pending = bounded(execution, `${serverName}: cancellation`)
  void pending.catch(() => {})
  try {
    await until(() => messages().some(message => message.method === 'tools/call' && message.params?.name === 'slow'), `${serverName}: slow request received`)
    controller.abort(new Error('local MCP qualification cancellation'))
    const result = await pending
    assert.equal(result.isError, true)
    // DSH preserves a rejected body's error. ABORTED only supersedes success;
    // the SDK rejects this started request with String(signal.reason).
    assert.equal(result.error?.message, 'Error: local MCP qualification cancellation')
    assert.equal(result.content[0]?.text, 'Error: Error: local MCP qualification cancellation')
    await until(() => messages().some(message => message.method === 'notifications/cancelled'), `${serverName}: protocol cancellation notification`)
    const call = messages().find(message => message.method === 'tools/call' && message.params?.name === 'slow')
    const cancellation = messages().find(message => message.method === 'notifications/cancelled')
    assert.equal(cancellation?.params?.requestId, call?.id)
  } finally {
    controller.abort()
    await pending.catch(() => {})
  }
}

async function verifyStdio(modules: BridgeModules): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-mcp-stdio-'))
  const eventPath = join(directory, 'events.jsonl')
  const events = (): StdioEvent[] => existsSync(eventPath)
    ? readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as StdioEvent)
    : []
  const messages = (): RpcMessage[] => events().flatMap(event => event.message === undefined ? [] : [event.message])
  let ctx: BridgeContext | undefined
  const childPid = (): number | undefined => events().find(event => event.event === 'started')?.pid
  const childIsRunning = (pid: number): boolean => {
    try { process.kill(pid, 0); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  try {
    ctx = await mount(modules)
    await bounded(modules.apply(ctx, {
      transport: 'stdio', serverName: 'compat_stdio', command: process.execPath,
      args: [join(fixtureDirectory, 'mcp-stdio.mjs'), eventPath], env: {}, cwd: directory,
      toolCallTimeoutMs: toolTimeoutMs, failOnStartupError: true, reconnect: { enabled: false },
    }), 'stdio bridge activation')
    assert.deepEqual(events().find(event => event.event === 'started')?.credentialKeys, [], 'DSH must scrub ambient credential-shaped and DSH_* environment names')
    assert.equal(messages().filter(message => message.method === 'tools/list').length, 3)
    await verifyTools(ctx, 'compat_stdio')
    await verifyCancellation(ctx, 'compat_stdio', messages)
  } finally {
    try {
      if (ctx !== undefined) await bounded(ctx.fiber.dispose(), 'stdio bridge disposal')
      const pid = childPid()
      if (pid !== undefined) {
        await until(() => !childIsRunning(pid), 'stdio child exits after disposal')
        assert(events().some(event => event.event === 'closed'), 'stdio child must close cleanly')
      }
    } finally {
      // A failed assertion or disposal deadline must not leave the owned fixture alive.
      // Keep its event file until after termination so its exit handler can still record.
      try {
        const pid = childPid()
        if (pid !== undefined && childIsRunning(pid)) {
          assert(pid > 0 && pid !== process.pid, 'cleanup may only terminate the fixture child')
          process.kill(pid, 'SIGTERM')
          try {
            await until(() => !childIsRunning(pid), 'stdio failure cleanup', 1_000)
          } catch {
            if (childIsRunning(pid)) process.kill(pid, 'SIGKILL')
            await until(() => !childIsRunning(pid), 'stdio forced failure cleanup')
          }
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  }
}

async function verifyHttp(modules: BridgeModules): Promise<void> {
  const { createMcpFixture } = await import(pathToFileURL(join(fixtureDirectory, 'mcp-protocol.mjs')).href) as {
    createMcpFixture(options?: { noProgress?: boolean }): Fixture
  }
  const fixture = createMcpFixture()
  const noProgress = createMcpFixture({ noProgress: true })
  const events: HttpEvent[] = []
  const pendingResponses = new Set<ServerResponse>()
  const pendingCalls = new Map<string | number, ServerResponse>()
  let slowRequestClosed = false
  const server = createServer((request, response) => {
    const record: HttpEvent = { verb: request.method ?? '', headers: request.headers }
    events.push(record)
    if (request.method === 'GET') { response.writeHead(405).end(); return }
    if (request.method === 'DELETE') { response.writeHead(204).end(); return }
    const chunks: Buffer[] = []
    request.on('error', () => response.destroy())
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcMessage
        record.message = message
        const active = request.url === '/no-progress' ? noProgress : fixture
        const reply = active.handle(message)
        if (message.id === undefined) {
          // In the legacy era the cancellation notification asks the server to
          // stop work; the SDK does not abort the original HTTP request stream.
          const requestId = message.params?.requestId
          if (message.method === 'notifications/cancelled' && requestId !== undefined) {
            pendingCalls.get(requestId)?.writeHead(202).end()
          }
          response.writeHead(202).end()
          return
        }
        if (reply === undefined) {
          pendingResponses.add(response)
          pendingCalls.set(message.id, response)
          response.on('close', () => {
            pendingResponses.delete(response)
            if (message.id !== undefined) pendingCalls.delete(message.id)
            slowRequestClosed = true
          })
          return
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          ...(message.method === 'initialize' ? { 'mcp-session-id': 'fixture-session' } : {}),
        })
        response.end(JSON.stringify(reply))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: String(error) }))
      }
    })
  })
  const contexts: BridgeContext[] = []
  try {
    await new Promise<void>((resolveListening, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListening)
    })
    const address = server.address()
    assert(address !== null && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const config = (serverName: string, path: string): Record<string, unknown> => ({
      transport: 'streamable-http', serverName, url: `${baseUrl}${path}`,
      headers: {
        authorization: 'Bearer local-fixture-only', 'x-compat-marker': 'local',
        'MCP-Session-ID': 'stale-session', 'MCP-Protocol-Version': 'stale-protocol',
      },
      toolCallTimeoutMs: toolTimeoutMs, failOnStartupError: true, reconnect: { enabled: false },
    })
    const ctx = await mount(modules)
    contexts.push(ctx)
    await bounded(modules.apply(ctx, config('compat_http', '/progress')), 'HTTP bridge activation')
    assert.equal(fixture.toolLists, 3, 'reused cursor with different items must reach the third page')
    await verifyTools(ctx, 'compat_http')
    await verifyCancellation(ctx, 'compat_http', () => fixture.requests)
    await until(() => slowRequestClosed, 'HTTP in-flight response closes on cancellation')
    const stalledCtx = await mount(modules)
    contexts.push(stalledCtx)
    await bounded(modules.apply(stalledCtx, config('compat_stalled', '/no-progress')), 'non-progress HTTP bridge activation')
    assert.equal(noProgress.toolLists, 2, 'same cursor and same items must stop without duplicate registration')
    assert.deepEqual(stalledCtx.tools.schemas().map(({ name }) => name), ['mcp__compat_stalled__add'])
    const stalled = await bounded(stalledCtx.tools.execute({
      signal: new AbortController().signal, callId: 'stalled-add',
      name: 'mcp__compat_stalled__add', arguments: { a: 8, b: 9 },
    }), 'non-progress tool remains usable')
    assert.equal(stalled.isError, false)
    assert.equal(stalled.content[0]?.text, '17')
    // DSH closes the SDK transport; close() aborts streams but does not DELETE
    // the remote session. Prove local disposal by closing a real in-flight call.
    slowRequestClosed = false
    const closeController = new AbortController()
    const closingCall = bounded(ctx.tools.execute({
      signal: closeController.signal, callId: 'http-close',
      name: 'mcp__compat_http__slow', arguments: {},
    }), 'HTTP in-flight call settles on bridge disposal', 5_000)
    void closingCall.catch(() => {})
    try {
      await until(() => fixture.requests.filter(message => message.method === 'tools/call' && message.params?.name === 'slow').length === 2, 'HTTP close request received')
      assert.equal(pendingResponses.size, 1)
      await bounded(ctx.fiber.dispose(), 'HTTP disposal with an in-flight request', 5_000)
      assert.equal((await closingCall).isError, true)
      await until(() => slowRequestClosed, 'HTTP in-flight response closes on disposal')
    } finally {
      closeController.abort()
      await closingCall.catch(() => {})
    }
    for (const event of events) {
      assert.equal(event.headers.authorization, 'Bearer local-fixture-only')
      assert.equal(event.headers['x-compat-marker'], 'local')
      // Auto negotiation probes server/discover before the legacy initialize;
      // no negotiated session or legacy protocol exists at that point.
      if (event.message !== undefined && !['initialize', 'server/discover'].includes(event.message.method)) {
        assert.equal(event.headers['mcp-session-id'], 'fixture-session')
        assert.equal(event.headers['mcp-protocol-version'], '2025-11-25')
      }
    }
    for (const context of contexts) await bounded(context.fiber.dispose(), 'HTTP bridge disposal')
    contexts.length = 0
    assert.equal(pendingResponses.size, 0)
  } finally {
    // Attempt every registry's cleanup even if one disposal rejects or times out.
    const cleanups = await Promise.allSettled(contexts.map(ctx => bounded(ctx.fiber.dispose(), 'HTTP cleanup')))
    try {
      for (const response of pendingResponses) response.destroy()
      const closed = new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
      server.closeAllConnections()
      await bounded(closed, 'HTTP fixture server closes', 5_000)
    } finally {
      const failures = cleanups.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'MCP HTTP registries failed to dispose')
    }
  }
}

/** Resolves the patched SDK through the actual DSH owner before exercising both transports. */
export async function verifyMcpCompatibility(packageJsonPath: string): Promise<void> {
  const ownerRequire = mcpOwnerRequire(packageJsonPath)
  const clientEntry = ownerRequire.resolve('@modelcontextprotocol/client')
  const client = packageManifest(clientEntry, '@modelcontextprotocol/client')
  const clientRequire = createRequire(clientEntry)
  const core = packageManifest(clientRequire.resolve('@modelcontextprotocol/core'), '@modelcontextprotocol/core')
  assert.equal(client.version, '2.2.0', `DSH-resolved MCP client: ${client.path}`)
  assert.equal(core.version, '2.2.0', `DSH-resolved MCP core: ${core.path}`)
  const modules = await loadBridge(ownerRequire)
  await verifyStdio(modules)
  await verifyHttp(modules)
}
