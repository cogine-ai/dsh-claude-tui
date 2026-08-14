/** Capture fixed-size Claude Code PTY frames as independent visual reference data. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import xtermHeadless from '@xterm/headless'
import * as pty from 'node-pty'
import { startReferenceAnthropicServer } from './mock-anthropic-reference.mjs'

const { Terminal } = xtermHeadless

const TARGET_VERSION = '2.1.227'
const DEFAULT_COMMAND = 'claude'
const DEFAULT_OUTPUT = 'tests/fixtures/claude-code-2.1.227'
const DEFAULT_CWD = process.cwd()

/** pnpm preserves node-pty's reviewed binary but npm's tar mode drops this bit on macOS. */
function ensureNodePtyHelper() {
  const entry = fileURLToPath(import.meta.resolve('node-pty'))
  const packageRoot = dirname(dirname(entry))
  const candidates = [
    join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    join(packageRoot, 'build', 'Release', 'spawn-helper'),
  ]
  for (const helper of candidates) {
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}

ensureNodePtyHelper()

const scenarios = [
  { name: 'idle', columns: 80, rows: 24, input: '', expected: '? for shortcuts' },
  { name: 'prompt', columns: 80, rows: 24, input: 'inspect this repository', expected: 'inspect this repository' },
  { name: 'slash', columns: 80, rows: 24, input: '/', expected: '/add-dir' },
  { name: 'file-mention', columns: 80, rows: 24, input: '@', expected: 'README.zh.md' },
  {
    name: 'file-mention-selected',
    columns: 80,
    rows: 24,
    steps: [
      { input: '@', expected: 'README.zh.md' },
      { input: '\r', expected: '@README.zh.md' },
    ],
  },
  { name: 'history', columns: 80, rows: 24, input: '\u0012', expected: 'search prompts:' },
  {
    name: 'permission-accept-edits',
    columns: 80,
    rows: 24,
    steps: [{ input: '\u001b[Z', expected: 'accept edits on' }],
  },
  {
    name: 'permission-plan',
    columns: 80,
    rows: 24,
    steps: [
      { input: '\u001b[Z', expected: 'accept edits on' },
      { input: '\u001b[Z', expected: 'plan mode on' },
    ],
  },
  {
    name: 'permission-auto',
    columns: 80,
    rows: 24,
    steps: [
      { input: '\u001b[Z', expected: 'accept edits on' },
      { input: '\u001b[Z', expected: 'plan mode on' },
      { input: '\u001b[Z', expected: 'auto mode on' },
    ],
  },
  {
    name: 'session-picker-empty',
    columns: 80,
    rows: 24,
    args: ['--resume'],
    startupExpected: 'No conversations found in this project.',
    isolatedConfig: true,
  },
  {
    name: 'session-picker-list',
    columns: 80,
    rows: 24,
    args: ['--resume'],
    startupExpected: 'Review the session picker implementation',
    isolatedConfig: true,
    seedSession: true,
  },
  {
    name: 'not-logged-in-error',
    columns: 80,
    rows: 24,
    tools: 'Bash',
    steps: [{ input: '!pwd\r', expected: 'Not logged in · Please run /login' }],
    isolatedConfig: true,
  },
  {
    name: 'approval',
    columns: 80,
    rows: 24,
    tools: 'Bash',
    mockApi: 'approval',
    steps: [{ input: 'Run the reference command.\r', expected: 'Do you want to proceed?' }],
    isolatedConfig: true,
  },
  {
    name: 'user-question',
    columns: 80,
    rows: 24,
    tools: 'AskUserQuestion',
    mockApi: 'question',
    steps: [{ input: 'Ask one deterministic reference question.\r', expected: 'Which reference option should be used?' }],
    isolatedConfig: true,
  },
  {
    name: 'response-streaming',
    columns: 80,
    rows: 24,
    mockApi: 'streaming-slow',
    steps: [{ input: 'Stream one deterministic reference response.\r', expected: 'Streaming' }],
    isolatedConfig: true,
  },
  {
    name: 'response-complete',
    columns: 80,
    rows: 24,
    mockApi: 'response',
    steps: [{ input: 'Return one deterministic reference response.\r', expected: 'Streaming reference response.' }],
    isolatedConfig: true,
  },
  {
    name: 'tool-complete',
    columns: 80,
    rows: 24,
    tools: 'Bash',
    mockApi: 'tool',
    steps: [{ input: 'Run the deterministic print reference.\r', expected: 'The local reference action completed.' }],
    isolatedConfig: true,
  },
  {
    name: 'subagent-foreground-pending',
    columns: 80,
    rows: 24,
    tools: 'Agent',
    mockApi: 'subagent-foreground',
    steps: [{ input: 'Delegate one deterministic reference task.\r', expected: 'Inspect reference' }],
    isolatedConfig: true,
  },
  {
    name: 'subagent-foreground-complete',
    columns: 80,
    rows: 24,
    tools: 'Agent',
    mockApi: 'subagent-foreground',
    steps: [{ input: 'Delegate one deterministic reference task.\r', expected: 'The subagent reference completed.' }],
    isolatedConfig: true,
  },
  {
    name: 'subagent-background-pending',
    columns: 80,
    rows: 24,
    tools: 'Agent',
    mockApi: 'subagent-background',
    steps: [{ input: 'Launch one deterministic background reference task.\r', expected: 'Inspect reference' }],
    isolatedConfig: true,
  },
  { name: 'ctrl-d-confirm', columns: 80, rows: 24, input: '\u0004', expected: 'Press Ctrl-D again to exit' },
  { name: 'ctrl-c-confirm', columns: 80, rows: 24, input: '\u0003', expected: 'Press Ctrl-C again to exit' },
  { name: 'idle', columns: 100, rows: 30, input: '', expected: '? for shortcuts' },
]

function readOptions(argv) {
  const result = { command: DEFAULT_COMMAND, cwd: DEFAULT_CWD, output: DEFAULT_OUTPUT, scenario: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--') continue
    const value = argv[index + 1]
    if (name === '--command' && value !== undefined) result.command = value
    else if (name === '--cwd' && value !== undefined) result.cwd = resolve(value)
    else if (name === '--output' && value !== undefined) result.output = resolve(value)
    else if (name === '--scenario' && value !== undefined) result.scenario = value
    else throw new Error(`unknown or incomplete option: ${name}`)
    index += 1
  }
  result.output = resolve(result.output)
  return result
}

function claudeArguments(scenario) {
  return [
    '--settings', '{}',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--tools', scenario.tools ?? '',
    '--permission-mode', 'manual',
    ...(scenario.args ?? []),
  ]
}

function captureEnvironment(configDir, mockBaseUrl) {
  const env = { ...process.env }
  delete env.NO_COLOR
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.DISABLE_AUTOUPDATER = '1'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  if (configDir !== undefined) env.CLAUDE_CONFIG_DIR = configDir
  if (mockBaseUrl !== undefined) {
    env.ANTHROPIC_BASE_URL = mockBaseUrl
    env.ANTHROPIC_API_KEY = 'sk-ant-reference-only'
    env.NO_PROXY = '127.0.0.1'
  }
  return env
}

/** Seed only local onboarding and trust facts; never copy account or session data. */
async function isolatedConfig(cwd, seedSession) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-claude-reference-'))
  await writeFile(join(directory, '.claude.json'), `${JSON.stringify({
    firstStartTime: new Date(0).toISOString(),
    machineID: 'dsh-claude-reference-isolated',
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: ['k-ant-reference-only'], rejected: [] },
    opusProMigrationComplete: true,
    sonnet1m45MigrationComplete: true,
    seenNotifications: {},
    hasResetAutoModeOptInForDefaultOffer: true,
    migrationVersion: 13,
    projects: {
      [cwd]: {
        mcpContextUris: [],
        mcpServers: {},
        enabledMcpjsonServers: [],
        disabledMcpjsonServers: [],
        hasTrustDialogAccepted: true,
        projectOnboardingSeenCount: 0,
      },
    },
  }, undefined, 2)}\n`, 'utf8')
  if (seedSession === true) {
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const projectDirectory = join(directory, 'projects', cwd.replaceAll('/', '-'))
    await mkdir(projectDirectory, { recursive: true })
    const record = {
      parentUuid: null,
      isSidechain: false,
      promptId: 'reference-prompt',
      type: 'user',
      message: { role: 'user', content: 'Review the session picker implementation' },
      uuid: '22222222-2222-4222-8222-222222222222',
      timestamp: new Date().toISOString(),
      permissionMode: 'manual',
      userType: 'external',
      entrypoint: 'cli',
      cwd,
      sessionId,
      version: TARGET_VERSION,
      gitBranch: 'main',
      slug: 'reference-picker-session',
    }
    await writeFile(join(projectDirectory, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8')
  }
  return directory
}

function visibleText(terminal) {
  const buffer = terminal.buffer.active
  const lines = []
  for (let row = 0; row < terminal.rows; row += 1) {
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

function color(cell, foreground) {
  const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB()
  const palette = foreground ? cell.isFgPalette() : cell.isBgPalette()
  const value = foreground ? cell.getFgColor() : cell.getBgColor()
  if (rgb) return `#${value.toString(16).padStart(6, '0')}`
  if (palette) return `ansi:${value}`
  return 'default'
}

function style(cell) {
  return {
    fg: color(cell, true),
    bg: color(cell, false),
    attrs: [
      cell.isBold() ? 'bold' : '',
      cell.isDim() ? 'dim' : '',
      cell.isItalic() ? 'italic' : '',
      cell.isUnderline() ? 'underline' : '',
      cell.isInverse() ? 'inverse' : '',
      cell.isStrikethrough() ? 'strike' : '',
    ].filter(Boolean),
  }
}

function styleKey(value) {
  return `${value.fg}|${value.bg}|${value.attrs.join(',')}`
}

function extractFrame(terminal) {
  const buffer = terminal.buffer.active
  const viewport = buffer.viewportY
  const lines = []
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(viewport + row)
    const text = line?.translateToString(true) ?? ''
    const runs = []
    let active
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line?.getCell(column)
      if (cell === undefined) continue
      const current = style(cell)
      const key = styleKey(current)
      if (key === 'default|default|') {
        if (active !== undefined) {
          runs.push(active)
          active = undefined
        }
        continue
      }
      if (active !== undefined && active.key === key && active.to === column) {
        active.to = column + 1
      } else {
        if (active !== undefined) runs.push(active)
        active = { from: column, to: column + 1, ...current, key }
      }
    }
    if (active !== undefined) runs.push(active)
    lines.push({
      text,
      runs: runs.map(({ key: _key, ...run }) => run),
    })
  }
  return {
    buffer: buffer.type,
    cursor: { column: buffer.cursorX, row: buffer.cursorY },
    lines,
  }
}

async function waitForScreen(terminal, pendingWrites, predicate, timeoutMs, processExited) {
  const deadline = Date.now() + timeoutMs
  let lastText = ''
  while (Date.now() < deadline) {
    await pendingWrites()
    const text = visibleText(terminal)
    lastText = text
    if (text.includes('Quick safety check:')) {
      throw new Error('Claude Code requested workspace trust; approve it manually before reference capture')
    }
    if (predicate(text)) {
      await new Promise(resolve => setTimeout(resolve, 350))
      await pendingWrites()
      return
    }
    if (processExited()) throw new Error('Claude Code exited before the expected frame appeared')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (process.env.DSH_CLAUDE_CAPTURE_DEBUG === '1') {
    process.stderr.write(`\n--- last isolated capture frame ---\n${lastText}\n--- end frame ---\n`)
  }
  throw new Error(`timed out waiting for Claude Code frame after ${timeoutMs}ms`)
}

async function capture(options, scenario) {
  const terminal = new Terminal({
    cols: scenario.columns,
    rows: scenario.rows,
    scrollback: 2_000,
    allowProposedApi: true,
    drawBoldTextInBrightColors: false,
    logLevel: 'off',
  })
  const raw = []
  let writeTail = Promise.resolve()
  let exited = false
  const mockApi = scenario.mockApi === undefined
    ? undefined
    : await startReferenceAnthropicServer(scenario.mockApi)
  const configDir = scenario.isolatedConfig === true
    ? await isolatedConfig(options.cwd, scenario.seedSession)
    : undefined
  const args = claudeArguments(scenario)
  const child = pty.spawn(options.command, args, {
    name: 'xterm-256color',
    cols: scenario.columns,
    rows: scenario.rows,
    cwd: options.cwd,
    env: captureEnvironment(configDir, mockApi?.baseUrl),
  })
  const dataSubscription = child.onData((data) => {
    raw.push(data)
    writeTail = writeTail.then(() => new Promise(resolveWrite => terminal.write(data, resolveWrite)))
  })
  const terminalSubscription = terminal.onData(data => child.write(data))
  const exitPromise = new Promise(resolveExit => {
    child.onExit((event) => {
      exited = true
      resolveExit(event)
    })
  })
  try {
    await waitForScreen(
      terminal,
      () => writeTail,
      text => scenario.startupExpected === undefined
        ? text.includes('? for shortcuts') && text.includes('Claude Code')
        : text.includes(scenario.startupExpected),
      10_000,
      () => exited,
    )
    const steps = scenario.steps
      ?? (scenario.startupExpected === undefined ? [{ input: scenario.input, expected: scenario.expected }] : [])
    for (const step of steps) {
      if (step.input !== '') child.write(step.input)
      await waitForScreen(
        terminal,
        () => writeTail,
        text => text.includes(step.expected),
        5_000,
        () => exited,
      )
    }
    const frame = extractFrame(terminal)
    const rawOutput = raw.join('')
    child.write('\u0003')
    await new Promise(resolve => setTimeout(resolve, 50))
    if (!exited) child.write('\u0004\u0004')
    const exit = await Promise.race([
      exitPromise,
      new Promise(resolveExit => setTimeout(() => resolveExit(undefined), 2_000)),
    ])
    if (exit === undefined && !exited) {
      child.write('\u0004\u0004')
      await Promise.race([
        exitPromise,
        new Promise(resolveExit => setTimeout(() => resolveExit(undefined), 2_000)),
      ])
    }
    if (!exited) {
      child.kill('SIGTERM')
      await Promise.race([
        exitPromise,
        new Promise(resolveExit => setTimeout(() => resolveExit(undefined), 2_000)),
      ])
    }
    return {
      formatVersion: 1,
      source: {
        product: 'Claude Code',
        version: TARGET_VERSION,
        command: options.command,
        args,
        cwd: options.cwd,
        ...(mockApi === undefined ? {} : { transport: 'loopback-reference-api' }),
      },
      scenario: scenario.name,
      dimensions: { columns: scenario.columns, rows: scenario.rows },
      rawSha256: createHash('sha256').update(rawOutput).digest('hex'),
      frame,
    }
  } finally {
    dataSubscription.dispose()
    terminalSubscription.dispose()
    terminal.dispose()
    if (!exited) {
      child.kill('SIGTERM')
      await Promise.race([
        exitPromise,
        new Promise(resolveExit => setTimeout(() => resolveExit(undefined), 2_000)),
      ])
    }
    if (configDir !== undefined) await rm(configDir, { recursive: true, force: true })
    await mockApi?.close()
  }
}

const options = readOptions(process.argv.slice(2))
const versionOutput = execFileSync(options.command, ['--version'], {
  cwd: options.cwd,
  env: captureEnvironment(),
  encoding: 'utf8',
}).trim()
if (!versionOutput.startsWith(TARGET_VERSION)) {
  throw new Error(`expected Claude Code ${TARGET_VERSION}, received ${versionOutput}`)
}

await mkdir(options.output, { recursive: true })
const selectedScenarios = scenarios.filter(scenario => (
  options.scenario === undefined
  || options.scenario === scenario.name
  || options.scenario === `${scenario.name}-${scenario.columns}x${scenario.rows}`
))
if (selectedScenarios.length === 0) throw new Error(`unknown scenario: ${options.scenario}`)
for (const scenario of selectedScenarios) {
  const result = await capture(options, scenario)
  const filename = `${scenario.name}-${scenario.columns}x${scenario.rows}.json`
  await writeFile(resolve(options.output, filename), `${JSON.stringify(result, undefined, 2)}\n`, 'utf8')
  process.stdout.write(`captured ${filename}\n`)
}
