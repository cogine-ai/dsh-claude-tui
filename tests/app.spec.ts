/** Real pi-tui application behavior over a fake Agent and ANSI terminal. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
  UserQuestionProvider,
} from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeTuiApplication } from '../src/app.ts'
import { resolveConfig } from '../src/config.ts'
import type { ClaudeTuiRuntimeSnapshot } from '../src/runtime-snapshot.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

interface Bench {
  ctx: Context
  app: ClaudeTuiApplication
  terminal: HeadlessTerminal
  followups: UserMessage[]
  commandCalls: Array<{
    agent: Agent
    line: string
    attachments: readonly unknown[]
    signal: AbortSignal
  }>
  exitCodes: number[]
  setStatus(status: Agent['status']): void
  askQuestions(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

interface ModelFixture {
  readonly selection: ModelSelectionRef
  defaultSelection: ModelSelection
  readonly catalogModels: string[]
  readonly efforts: Record<string, Array<{ id: string; name: string }>>
  readonly savedDefaults: ModelSelection[]
}

interface CredentialFixture {
  info: {
    configured: boolean
    source?: string
    writable: boolean
  }
  readonly writes: Array<{ ref: string; value: string }>
  setError?: (value: string) => Error
}

interface BenchOptions {
  readonly commands?: ReadonlyArray<{ name: string; description: string }>
  readonly models?: ModelFixture
  readonly credentials?: CredentialFixture
  readonly seed?: (session: Session) => void
  readonly seedEvents?: readonly SessionEvent[]
  readonly launchNotice?: string
  readonly welcomeExpanded?: boolean
  readonly tuiVersion?: string
  readonly runtimeSnapshot?: ClaudeTuiRuntimeSnapshot
  readonly color?: boolean
}

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Assemble only the services the terminal directly consumes. */
function bench(
  columns = 90,
  rows = 28,
  now: () => number = () => 1_000,
  options: BenchOptions = {},
): Bench {
  const ctx = new Context()
  contexts.push(ctx)
  let questionProvider: UserQuestionProvider | undefined
  const commandCalls: Bench['commandCalls'] = []
  ctx.provide('commands', {
    list: () => options.commands ?? [],
    execute: (
      agent: Agent,
      line: string,
      attachments: readonly unknown[],
      signal: AbortSignal,
    ) => {
      commandCalls.push({ agent, line, attachments, signal })
      return Promise.resolve(undefined)
    },
  } as never)
  ctx.provide('userQuestions', {
    registerProvider: (provider: UserQuestionProvider) => {
      questionProvider = provider
      return () => { questionProvider = undefined }
    },
  } as never)
  if (options.models !== undefined || options.credentials !== undefined) {
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listConfigurableProviders: () => options.credentials === undefined
        ? []
        : [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: 'llm-deepseek',
            settingsPath: [],
          }],
      listModels: async () => (options.models?.catalogModels ?? [
        'deepseek-v4-flash',
        'deepseek-v4-pro',
      ]).map(model => ({
          provider: 'deepseek-official',
          id: model,
          name: model === 'deepseek-v4-flash'
            ? 'DeepSeek V4 Flash'
            : model === 'deepseek-v4-pro'
              ? 'DeepSeek V4 Pro'
              : model,
          description: model === 'deepseek-v4-flash'
            ? 'Fast coding model'
            : model === 'deepseek-v4-pro'
              ? 'More capable coding model'
              : 'Exact DSH route outside the advertised catalog',
        })),
      resolveModelInfo: async (_provider: string, model: string) => ({
        provider: 'deepseek-official',
        id: model,
        name: model === 'deepseek-v4-flash'
          ? 'DeepSeek V4 Flash'
          : model === 'deepseek-v4-pro'
            ? 'DeepSeek V4 Pro'
            : model,
        reasoning: {
          efforts: options.models?.efforts[model] ?? [],
          defaultEffort: 'high',
        },
      }),
    } as never)
  }
  if (options.models !== undefined) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({
        ...options.models!.defaultSelection,
      }),
      saveSelection: async (selection: ModelSelection) => {
        options.models?.savedDefaults.push({ ...selection })
        if (options.models !== undefined) options.models.defaultSelection = { ...selection }
      },
    } as never)
  }
  if (options.credentials !== undefined) {
    ctx.provide('settings', {
      get: () => ({ apiKeyEnv: 'DEEPSEEK_API_KEY' }),
    } as never)
    ctx.provide('credentials', {
      describe: async () => ({ ...options.credentials!.info }),
      set: async (ref: string, value: string) => {
        if (options.credentials!.setError !== undefined) throw options.credentials!.setError(value)
        options.credentials!.writes.push({ ref, value })
        options.credentials!.info = { configured: true, source: 'file', writable: true }
      },
      unset: async () => {},
      resolve: async () => undefined,
    } as never)
  }

  const session = Session.create(SessionId('terminal-test'), options.seedEvents, {
    version: 0,
    id: SessionId('terminal-test'),
    createdAt: 1,
    cwd: '/workspace/project',
  })
  options.seed?.(session)
  const followups: UserMessage[] = []
  let status: Agent['status'] = 'idle'
  const agent = {} as Agent
  const agentCtx = ctx.extend({ agent })
  Object.defineProperties(agent, {
    id: { value: session.id },
    options: { value: { provider: 'test', model: 'model' } },
    session: { value: session },
    inbox: { value: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }) },
    status: { get: () => status },
    ctx: { value: agentCtx },
    cancel: { value: () => { status = 'idle' } },
    whenIdle: { value: () => Promise.resolve() },
    runMaintenance: { value: () => Promise.reject(new Error('not used')) },
    send: { value: () => {} },
    followup: { value: (message: UserMessage) => { followups.push(message) } },
    steer: { value: (message: UserMessage) => { followups.push(message) } },
    inject: { value: () => {} },
  })

  const terminal = new HeadlessTerminal(columns, rows)
  const exitCodes: number[] = []
  const app = new ClaudeTuiApplication(ctx, agent, resolveConfig({ color: options.color ?? false }), {
    terminal,
    exit: (code: number) => { exitCodes.push(code) },
    now,
    ...(options.launchNotice === undefined ? {} : { launchNotice: options.launchNotice }),
    ...(options.welcomeExpanded === undefined
      ? {}
      : { welcomeExpanded: options.welcomeExpanded }),
    ...(options.tuiVersion === undefined ? {} : { tuiVersion: options.tuiVersion }),
    ...(options.runtimeSnapshot === undefined
      ? {}
      : { runtimeSnapshot: options.runtimeSnapshot }),
    ...(options.models === undefined ? {} : { modelSelection: options.models.selection }),
  } as never)
  return {
    ctx,
    app,
    terminal,
    followups,
    commandCalls,
    exitCodes,
    setStatus: nextStatus => { status = nextStatus },
    askQuestions: request => {
      if (questionProvider === undefined) throw new Error('question provider is not registered')
      return questionProvider.ask(request)
    },
  }
}

function modelFixture(): ModelFixture {
  return {
    selection: {
      current: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high' as never,
      },
      assembled: undefined,
    },
    defaultSelection: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high' as never,
    },
    catalogModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    efforts: {
      'deepseek-v4-flash': [
        { id: 'off', name: 'Off' },
        { id: 'high', name: 'High' },
      ],
      'deepseek-v4-pro': [
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ],
      'deepseek-v4-legacy': [
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ],
    },
    savedDefaults: [],
  }
}

function credentialFixture(
  info: CredentialFixture['info'] = { configured: false, writable: true },
): CredentialFixture {
  return { info, writes: [] }
}

interface ReferenceFrame {
  frame: {
    buffer: 'normal' | 'alternate'
    cursor: { column: number; row: number }
    lines: Array<{
      text: string
      runs: Array<{
        from: number
        to: number
        fg: string
        bg: string
        attrs: string[]
      }>
    }>
  }
}

/** Extract only geometry visible across product-specific labels and live model state. */
function shellGeometry(buffer: 'normal' | 'alternate', lines: string[]) {
  const dividerRows = lines.flatMap((line, row) => /^─+$/u.test(line) ? [row] : [])
  const firstDivider = dividerRows[0]
  return {
    buffer,
    logoRows: lines.slice(0, firstDivider ?? 0).filter(line => /[▐▛█▜▌]/u.test(line)).length,
    dividerRows,
    dividerWidths: dividerRows.map(row => lines[row]?.length ?? 0),
    promptRow: lines.findIndex(line => line.startsWith('❯')),
    shortcutsRow: lines.findIndex(line => line.includes('? for shortcuts')),
  }
}

/** User-approved safety inset between the terminal viewport and Claude-style shell. */
const HEADER_TOP_INSET = 1

function candidateRow(referenceRow: number): number {
  return referenceRow < 0 ? referenceRow : referenceRow + HEADER_TOP_INSET
}

function candidateCursor(cursor: { column: number; row: number }) {
  return { ...cursor, row: candidateRow(cursor.row) }
}

function candidateShellGeometry(geometry: ReturnType<typeof shellGeometry>) {
  return {
    ...geometry,
    dividerRows: geometry.dividerRows.map(candidateRow),
    promptRow: candidateRow(geometry.promptRow),
    shortcutsRow: candidateRow(geometry.shortcutsRow),
  }
}

/** Resolve one independently captured reference cell from run-length data. */
function referenceCell(reference: ReferenceFrame, row: number, column: number) {
  const run = reference.frame.lines[row]?.runs.find(item => item.from <= column && column < item.to)
  return {
    fg: run?.fg ?? 'default',
    bg: run?.bg ?? 'default',
    bold: run?.attrs.includes('bold') ?? false,
    dim: run?.attrs.includes('dim') ?? false,
    inverse: run?.attrs.includes('inverse') ?? false,
  }
}

/** Column where a two-column slash row starts its description. */
function descriptionColumn(line: string): number {
  const match = /^\/\S+\s{2,}\S/u.exec(line)
  return match === null ? -1 : match[0].length - 1
}

describe('ClaudeTuiApplication', () => {
  it('renders the captured full welcome panel for a new Session', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/welcome-100x30.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const expectedLines = reference.frame.lines.map(line => line.text)
    const expectedPanelBottom = expectedLines.findIndex(line => line.startsWith('╰'))
    const expectedDividerColumn = expectedLines[1]?.indexOf('│', 1)
    const test = bench(100, 30, () => 1_000, {
      welcomeExpanded: true,
      color: true,
      models: modelFixture(),
      tuiVersion: '0.1.1',
      runtimeSnapshot: {
        harnessVersion: '0.1.1-rc.2',
        runtimeKind: 'bundled',
        homeKind: 'shared',
        homePath: join(homedir(), '.dsh'),
        toolsMode: 'code',
      },
    })

    await test.app.start()
    await test.terminal.settle()

    const lines = test.terminal.lines()
    const text = test.terminal.text()
    expect({
      topBorder: lines[0]?.startsWith('╭─── DSH Claude TUI v0.1.1'),
      panelBottom: lines.findIndex(line => line.startsWith('╰')),
      dividerColumn: lines[1]?.indexOf('│', 1),
      sectionDivider: lines[3],
      welcomeRow: lines.findIndex(line => line.includes('Welcome back!')),
      tipsRow: lines.findIndex(line => line.includes('Tips for getting started')),
      runtimeRow: lines.findIndex(line => line.includes('Runtime')),
      helpVisible: text.includes('Run /help for commands and shortcuts'),
      harnessVisible: text.includes('Harness 0.1.1-rc.2 · bundled · PTC'),
      homeVisible: text.includes('Home ~/.dsh · shared'),
      modelVisible: text.includes('deepseek-official/deepseek-v4-flash · high'),
      sessionIdVisible: text.includes('terminal-test'),
      cwdVisible: text.includes('/workspace/project'),
      badgeVisible: lines[9]?.slice(0, -1).trimEnd().endsWith('powered by dsh'),
      copiedClaudeReleaseNotes: text.includes("What's new"),
      innerBorderStyle: test.terminal.cellStyle(1, 46),
      tipsStyle: test.terminal.cellStyle(1, 48),
      runtimeStyle: test.terminal.cellStyle(4, 48),
      guidanceStyle: test.terminal.cellStyle(5, 48),
      badgeStyle: test.terminal.cellStyle(9, lines[9]?.indexOf('powered by dsh') ?? -1),
    }).toEqual({
      topBorder: true,
      panelBottom: expectedPanelBottom,
      dividerColumn: expectedDividerColumn,
      sectionDivider: expectedLines[3],
      welcomeRow: expectedLines.findIndex(line => line.includes('Welcome back!')),
      tipsRow: expectedLines.findIndex(line => line.includes('Tips for getting started')),
      runtimeRow: expectedLines.findIndex(line => line.includes("What's new")),
      helpVisible: true,
      harnessVisible: true,
      homeVisible: true,
      modelVisible: true,
      sessionIdVisible: false,
      cwdVisible: true,
      badgeVisible: true,
      copiedClaudeReleaseNotes: false,
      innerBorderStyle: {
        fg: '#d77757', bg: 'default', bold: false, dim: true, inverse: false,
      },
      tipsStyle: {
        fg: '#d77757', bg: 'default', bold: true, dim: false, inverse: false,
      },
      runtimeStyle: {
        fg: '#d77757', bg: 'default', bold: true, dim: false, inverse: false,
      },
      guidanceStyle: {
        fg: '#999999', bg: 'default', bold: false, dim: false, inverse: false,
      },
      badgeStyle: {
        fg: '#ffffff', bg: '#4d6bfe', bold: false, dim: false, inverse: false,
      },
    })

    await test.app.dispose()
  })

  it('maps only DSH native, code, and both tools modes into product-facing labels', async () => {
    const cases = [
      ['native', 'Standard'],
      ['code', 'PTC'],
      ['both', 'Both (Native + PTC)'],
    ] as const
    for (const [toolsMode, label] of cases) {
      const test = bench(100, 30, () => 1_000, {
        welcomeExpanded: true,
        tuiVersion: '0.1.1',
        runtimeSnapshot: {
          harnessVersion: '0.1.1-rc.2',
          runtimeKind: 'system',
          homeKind: 'isolated',
          homePath: '/tmp/dsh-claude-tui',
          toolsMode,
        },
      })

      await test.app.start()
      await test.terminal.settle()
      expect(test.terminal.text()).toContain(`Harness 0.1.1-rc.2 · system · ${label}`)
      await test.app.dispose()
    }
  })

  it('shows an isolated-home notice without persisting it to the Session', async () => {
    const test = bench(80, 24, () => 1_000, {
      launchNotice: 'Using isolated DSH_HOME; existing sessions were not copied.',
    })

    await test.app.start()
    await test.terminal.settle()

    expect(test.terminal.text()).toContain(
      'Using isolated DSH_HOME; existing sessions were not copied.',
    )
    expect(test.app.agent.session.events).toEqual([])
    await test.app.dispose()
  })

  it('left-aligns both prompt status rows', async () => {
    const test = bench(100, 30)

    await test.app.start()
    await test.terminal.settle()

    const lines = test.terminal.lines()
    const primaryRow = lines.findIndex(line => line.includes('? for shortcuts'))
    expect(primaryRow).toBeGreaterThanOrEqual(0)
    expect([
      lines[primaryRow]?.search(/\S/u),
      lines[primaryRow + 1]?.search(/\S/u),
    ]).toEqual([2, 2])

    await test.app.dispose()
  })

  it('keeps the plan-mode status detail left-aligned too', async () => {
    const test = bench(100, 30, () => 1_000, {
      seed: session => {
        const withPlanMode = session as unknown as {
          append(type: string, data: unknown): unknown
        }
        withPlanMode.append('plan/mode', { active: true })
      },
    })

    await test.app.start()
    await test.terminal.settle()

    const lines = test.terminal.lines()
    const primaryRow = lines.findIndex(line => line.includes('plan mode on'))
    expect(primaryRow).toBeGreaterThanOrEqual(0)
    expect([
      lines[primaryRow]?.search(/\S/u),
      lines[primaryRow + 1]?.search(/\S/u),
    ]).toEqual([2, 2])

    await test.app.dispose()
  })

  it('shows cache, token, first-token, and throughput statistics on the second status row', async () => {
    const user = createUserMessage({
      content: [{ type: 'text', text: 'measure this response' }],
      source: { kind: 'user' },
    })
    const assistant = createAssistantMessage({
      content: [{ type: 'text', text: 'done' }],
      source: { provider: 'test', model: 'model' },
    })
    const seedEvents: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 2, time: 1_000, data: user, surfaceOp: 'append' },
      {
        type: 'assistant/chunk',
        seq: 3,
        time: 1_250,
        data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      },
      {
        type: 'assistant/chunk',
        seq: 4,
        time: 2_000,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'done' } },
      },
      {
        type: 'assistant/message',
        seq: 5,
        time: 2_250,
        data: {
          turn: 1,
          step: 1,
          message: assistant,
          usage: {
            inputTokens: 30,
            outputTokens: 10,
            cacheReadTokens: 60,
            cacheWriteTokens: 10,
          },
        },
        surfaceOp: 'append',
        sourceEventSeqs: [3, 4],
      },
      { type: 'step/end', seq: 6, time: 2_250, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 7, time: 2_300, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const test = bench(110, 30, () => 1_000, { seedEvents })

    await test.app.start()
    await test.terminal.settle()

    const status = test.terminal.lines().find(line => line.includes('cache 60%'))
    expect(status?.trim()).toBe(
      'cache 60% · ↑100 ↓10 · TTFT 1.0s · 40.0 tok/s · reasoning on · transcript compact',
    )

    await test.app.dispose()
  })

  it('keeps the Claude logo below a safe top row and uses the DSH Claude TUI identity', async () => {
    const test = bench(80, 24)
    await test.app.start()
    await test.terminal.settle()

    const lines = test.terminal.lines()
    expect({
      top: lines[0],
      identity: lines[1],
      route: lines[2],
      cwdPreserved: lines[3]?.startsWith('  ▘▘ ▝▝    /workspace/project'),
      badgeVisible: lines[3]?.includes('powered by dsh'),
      terminalTitle: test.terminal.title,
      legacyTargetVisible: test.terminal.text().includes('Claude Code 2.1.227 target'),
    }).toEqual({
      top: '',
      identity: ' ▐▛███▜▌   DSH Claude TUI',
      route: '▝▜█████▛▘  test/model · terminal-test',
      cwdPreserved: true,
      badgeVisible: true,
      terminalTitle: 'DSH Claude TUI',
      legacyTargetVisible: false,
    })

    await test.app.dispose()
  })

  it('renders a responsive official powered by dsh badge on the third header row', async () => {
    const test = bench(80, 24)
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const wideRow = test.terminal.lines()[3] ?? ''
    const badgeColumn = wideRow.indexOf('powered by dsh')
    expect({
      leftPreserved: wideRow.startsWith('  ▘▘ ▝▝    /workspace/project'),
      rightAligned: wideRow.trimEnd().endsWith('powered by dsh'),
      badgeColumn,
      badgeStyle: test.terminal.cellStyle(3, badgeColumn),
    }).toEqual({
      leftPreserved: true,
      rightAligned: true,
      badgeColumn: 65,
      badgeStyle: {
        fg: '#ffffff',
        bg: '#4d6bfe',
        bold: false,
        dim: false,
        inverse: false,
      },
    })

    test.terminal.resize(32, 24)
    await test.terminal.settle()
    expect(test.terminal.lines()[3]).not.toContain('powered by dsh')

    await coloredApp.dispose()
  })

  it('matches the Claude Code idle shell geometry captured from a real PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/idle-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    await test.app.start()
    await test.terminal.settle()

    const expected = shellGeometry(reference.frame.buffer, reference.frame.lines.map(line => line.text))
    const actual = shellGeometry(test.terminal.bufferType(), test.terminal.lines())
    expect(actual).toEqual(candidateShellGeometry(expected))

    await test.app.dispose()
  })

  it('matches the Claude Code welcome and prompt palette captured from a real PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/idle-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const positions = [[0, 1], [0, 11], [2, 11], [5, 0]] as const
    const expected = positions.map(([row, column]) => referenceCell(reference, row, column))
    const actual = positions.map(([row, column]) => test.terminal.cellStyle(candidateRow(row), column))
    expect(actual).toEqual(expected)

    await coloredApp.dispose()
  })

  it('opens Ctrl+R prompt search in the row captured from a real Claude PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/history-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    await test.app.start()
    test.terminal.send('\u0012')
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    expect({
      buffer: test.terminal.bufferType(),
      searchRow: actualLines.findIndex(line => line.includes('search prompts:')),
      promptCursor: test.terminal.cellStyle(candidateRow(6), 2),
      cursor: test.terminal.cursor(),
    }).toEqual({
      buffer: reference.frame.buffer,
      searchRow: candidateRow(expectedLines.findIndex(line => line.includes('search prompts:'))),
      promptCursor: referenceCell(reference, 6, 2),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await test.app.dispose()
  })

  it('opens slash suggestions directly below the prompt like the real Claude PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/slash-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    test.terminal.send('/')
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const actualSuggestionRow = actualLines.findIndex((line, row) => row > 7 && line.startsWith('/'))
    const expectedSuggestionRow = expectedLines.findIndex((line, row) => row > 7 && line.startsWith('/'))
    expect({
      prompt: actualLines[candidateRow(6)],
      firstSuggestionRow: actualSuggestionRow,
      descriptionColumn: descriptionColumn(actualLines[actualSuggestionRow] ?? ''),
      selectedStyle: test.terminal.cellStyle(actualSuggestionRow, 0),
      cursor: test.terminal.cursor(),
    }).toEqual({
      prompt: '❯\u00a0/ ',
      firstSuggestionRow: candidateRow(expectedSuggestionRow),
      descriptionColumn: descriptionColumn(expectedLines[expectedSuggestionRow] ?? ''),
      selectedStyle: referenceCell(reference, expectedSuggestionRow, 0),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('opens file mentions directly below the prompt like the real Claude PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/file-mention-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      {
        terminal: test.terminal,
        exit: code => { test.exitCodes.push(code) },
        listWorkspaceEntries: async () => [
          { path: 'README.zh.md', directory: false },
          { path: '.jscpd.json', directory: false },
          { path: 'native', directory: true },
        ],
      },
    )
    await coloredApp.start()
    test.terminal.send('@')
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const actualSuggestionRow = actualLines.findIndex((line, row) => row > 7 && line.startsWith('+ '))
    const expectedSuggestionRow = expectedLines.findIndex((line, row) => row > 7 && line.startsWith('+ '))
    expect({
      prompt: actualLines[candidateRow(6)],
      firstSuggestionRow: actualSuggestionRow,
      selectedStyle: test.terminal.cellStyle(actualSuggestionRow, 0),
      cursor: test.terminal.cursor(),
    }).toEqual({
      prompt: reference.frame.lines[6]?.text,
      firstSuggestionRow: candidateRow(expectedSuggestionRow),
      selectedStyle: referenceCell(reference, expectedSuggestionRow, 0),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('completes a file mention without submitting the prompt like the real Claude PTY', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/file-mention-selected-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const app = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: false }),
      {
        terminal: test.terminal,
        exit: code => { test.exitCodes.push(code) },
        listWorkspaceEntries: async () => [
          { path: 'README.zh.md', directory: false },
          { path: 'native', directory: true },
        ],
      },
    )
    await app.start()
    test.terminal.send('@')
    await test.terminal.settle()
    test.terminal.send('\r')
    await test.terminal.settle()

    expect({
      prompt: test.terminal.lines()[candidateRow(6)],
      cursor: test.terminal.cursor(),
      menuVisible: test.terminal.lines().some(line => line.startsWith('+ ')),
      submitted: test.followups.length,
    }).toEqual({
      prompt: reference.frame.lines[6]?.text,
      cursor: candidateCursor(reference.frame.cursor),
      menuVisible: false,
      submitted: 0,
    })

    await app.dispose()
  })

  it('matches the captured prompt text and hardware cursor after typing', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/prompt-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    await test.app.start()
    for (const character of 'inspect this repository') test.terminal.send(character)
    await test.terminal.settle()

    expect({ prompt: test.terminal.lines()[candidateRow(6)], cursor: test.terminal.cursor() }).toEqual({
      prompt: reference.frame.lines[6]?.text,
      cursor: candidateCursor(reference.frame.cursor),
    })

    await test.app.dispose()
  })

  it('filters Ctrl+R history and accepts the selected prompt through the editor', async () => {
    const test = bench(80, 24)
    await test.app.start()
    for (const prompt of ['first prompt', 'second prompt']) {
      for (const character of prompt) test.terminal.send(character)
      test.terminal.send('\r')
    }
    test.terminal.send('\u0012')
    for (const character of 'first') test.terminal.send(character)
    test.terminal.send('\r')
    test.terminal.send('\r')

    expect(test.followups.map(message => message.content)).toEqual([
      [{ type: 'text', text: 'first prompt' }],
      [{ type: 'text', text: 'second prompt' }],
      [{ type: 'text', text: 'first prompt' }],
    ])

    await test.app.dispose()
  })

  it('executes the selected slash suggestion through the normal command surface', async () => {
    const test = bench(80, 24)
    await test.app.start()
    test.terminal.send('/')
    test.terminal.send('\u001B[B')
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('transcript expanded')

    await test.app.dispose()
  })

  it('uses the rc2 command envelope with an empty image attachment batch', async () => {
    const test = bench(80, 24, () => 1_000, {
      commands: [{ name: 'plan', description: 'Enter plan mode' }],
    })
    await test.app.start()
    for (const character of '/plan') test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.commandCalls).toHaveLength(1)
    expect(test.commandCalls[0]).toMatchObject({
      agent: test.app.agent,
      line: '/plan',
      attachments: [],
    })
    expect(test.commandCalls[0]?.signal.aborted).toBe(false)

    await test.app.dispose()
  })

  it('toggles DSH plan mode when macOS sends legacy Shift+Tab', async () => {
    const test = bench(80, 24, () => 1_000, {
      commands: [{ name: 'plan', description: 'Enter or leave plan mode' }],
    })
    await test.app.start()

    test.terminal.send('\u001B[Z')
    await test.terminal.settle()

    expect(test.commandCalls.map(call => call.line)).toEqual(['/plan'])

    const sessionWithPlanEvents = test.app.agent.session as unknown as {
      append(type: string, data: unknown): SessionEvent
    }
    const event = sessionWithPlanEvents.append('plan/mode', { active: true })
    test.app.agent.ctx.emit('session/event', test.app.agent.session, event)
    await test.terminal.settle()
    expect(test.terminal.text()).toContain('plan mode on')

    test.terminal.send('\u001B[Z')
    await test.terminal.settle()

    expect(test.commandCalls.map(call => call.line)).toEqual(['/plan', '/plan off'])

    await test.app.dispose()
  })

  it('opens the live DSH model catalog with Alt+P and keeps the prompt draft', async () => {
    const models = modelFixture()
    models.selection.assembled = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high' as never,
    }
    const test = bench(90, 28, () => 1_000, { models })
    await test.app.start()
    for (const character of 'keep this draft') test.terminal.send(character)

    test.terminal.send('\u001Bp')
    await test.terminal.settle()

    const lines = test.terminal.lines()
    const flash = lines.find(line => line.includes('DeepSeek V4 Flash'))
    expect(test.terminal.text()).toContain('Select model')
    expect(test.terminal.text()).toContain('DeepSeek V4 Pro')
    expect(test.terminal.text()).not.toContain('OpenAI')
    expect(flash).toContain('current')
    expect(flash).toContain('default')

    test.terminal.send('\u001B[B')
    test.terminal.send('\u001B[C')
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(models.selection.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(models.savedDefaults).toEqual([])
    expect(models.selection.assembled).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    expect(test.terminal.text()).toContain('keep this draft')

    await test.app.dispose()
  })

  it('uses d in /model to switch the current Agent and save the DSH default', async () => {
    const models = modelFixture()
    const test = bench(90, 28, () => 1_000, { models })
    await test.app.start()
    for (const character of '/model') test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()

    test.terminal.send('\u001B[B')
    test.terminal.send('d')
    await test.terminal.settle()

    expect(models.selection.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    })
    expect(models.savedDefaults).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    }])

    await test.app.dispose()
  })

  it('shows a model-switch notice while an Agent is running in plan mode', async () => {
    const models = modelFixture()
    const test = bench(100, 30, () => 1_000, {
      models,
      seed: session => {
        const sessionWithPlanEvents = session as unknown as {
          append(type: string, data: unknown): unknown
        }
        sessionWithPlanEvents.append('plan/mode', { active: true })
      },
    })
    test.setStatus('running')
    await test.app.start()

    test.terminal.send('\u001Bp')
    await test.terminal.settle()
    test.terminal.send('\u001B[B')
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('plan mode on')
    expect(test.terminal.text()).toContain(
      'Using deepseek-official/deepseek-v4-pro from the next model request',
    )

    await test.app.dispose()
  })

  it('uses the DSH-saved effort when selecting a non-current default model', async () => {
    const models = modelFixture()
    models.defaultSelection = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max' as never,
    }
    const test = bench(90, 28, () => 1_000, { models })
    await test.app.start()
    test.terminal.send('\u001Bp')
    await test.terminal.settle()

    const defaultRow = test.terminal.lines().find(line => line.includes('DeepSeek V4 Pro'))
    expect(defaultRow).toContain('default')
    test.terminal.send('\u001B[B')
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(models.selection.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })

    await test.app.dispose()
  })

  it('keeps an unadvertised current route and refreshes an open picker on DSH topology changes', async () => {
    const models = modelFixture()
    models.catalogModels.splice(0, models.catalogModels.length, 'deepseek-v4-flash')
    models.selection.current = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-legacy',
      reasoningEffort: 'high' as never,
    }
    const test = bench(90, 28, () => 1_000, { models })
    await test.app.start()
    test.terminal.send('\u001Bp')
    await test.terminal.settle()

    const legacy = test.terminal.lines().find(line => (
      line.includes('deepseek-v4-legacy') && line.includes('not advertised')
    ))
    expect(legacy).toContain('current')
    expect(legacy).toContain('not advertised')
    expect(test.terminal.text()).not.toContain('DeepSeek V4 Pro')

    models.catalogModels.push('deepseek-v4-pro')
    test.ctx.emit('llm/adapters-updated')
    await test.terminal.settle()
    expect(test.terminal.text()).toContain('DeepSeek V4 Pro')

    test.terminal.send('\u001B[A')
    test.terminal.send('\u001B[C')
    models.efforts['deepseek-v4-pro'] = [{ id: 'high', name: 'High' }]
    test.ctx.emit('llm/adapters-updated')
    await test.terminal.settle()
    expect(test.terminal.text()).not.toContain('Max')
    test.terminal.send('\r')
    await test.terminal.settle()
    expect(models.selection.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    })

    await test.app.dispose()
  })

  it('confirms a route change after prior assistant output before mutating DSH selection', async () => {
    const models = modelFixture()
    const test = bench(90, 28, () => 1_000, {
      models,
      seed: (session) => {
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'Use the original model.' }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'Original response.' }],
            source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          }),
        }, { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    await test.app.start()

    test.terminal.send('\u001Bp')
    await test.terminal.settle()
    test.terminal.send('\u001B[B')
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('Switch model for the next request?')
    expect(models.selection.current?.model).toBe('deepseek-v4-flash')

    test.terminal.send('\r')
    await test.terminal.settle()
    expect(models.selection.current?.model).toBe('deepseek-v4-pro')

    await test.app.dispose()
  })

  it('lists DSH provider credential state and never renders a replacement API key', async () => {
    const credentials = credentialFixture({ configured: true, source: 'file', writable: true })
    const test = bench(90, 28, () => 1_000, { credentials })
    await test.app.start()
    for (const character of '/provider') test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('Configure provider')
    expect(test.terminal.text()).toContain('DeepSeek')
    expect(test.terminal.text()).toContain('configured · file')

    test.terminal.send('\r')
    await test.terminal.settle()
    const secret = 'sk-super-secret'
    for (const character of secret) test.terminal.send(character)
    await test.terminal.settle()
    expect(test.terminal.text()).toContain('••••')
    expect(test.terminal.text()).not.toContain(secret)

    test.terminal.send('\r')
    await test.terminal.settle()
    expect(credentials.writes).toEqual([{ ref: 'DEEPSEEK_API_KEY', value: secret }])
    expect(test.terminal.text()).not.toContain(secret)
    expect(JSON.stringify(test.app.agent.session.events)).not.toContain(secret)

    await test.app.dispose()
  })

  it('collects the sole missing DSH credential before submitting an initial prompt', async () => {
    const credentials = credentialFixture()
    const test = bench(90, 28, () => 1_000, { credentials })
    await test.app.start('run after setup')
    await test.terminal.settle()

    expect(test.followups).toEqual([])
    expect(test.terminal.text()).toContain('Connect DeepSeek')
    expect(test.terminal.text()).toContain('DEEPSEEK_API_KEY')

    const secret = 'sk-first-run'
    for (const character of secret) test.terminal.send(character)
    await test.terminal.settle()
    expect(test.terminal.text()).not.toContain(secret)
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(credentials.writes).toEqual([{ ref: 'DEEPSEEK_API_KEY', value: secret }])
    expect(test.followups[0]?.content).toEqual([{ type: 'text', text: 'run after setup' }])
    expect(test.terminal.text()).not.toContain(secret)
    expect(JSON.stringify(test.app.agent.session.events)).not.toContain(secret)

    await test.app.dispose()
  })

  it('keeps an initial prompt as a draft when first-run credential setup is cancelled', async () => {
    const credentials = credentialFixture()
    const test = bench(90, 28, () => 1_000, { credentials })
    await test.app.start('keep this queued prompt')
    await test.terminal.settle()

    test.terminal.send('\u001B')
    await test.terminal.settle()

    expect(credentials.writes).toEqual([])
    expect(test.followups).toEqual([])
    expect(test.terminal.text()).toContain('keep this queued prompt')

    await test.app.dispose()
  })

  it('treats an environment-supplied DSH credential as configured and read-only', async () => {
    const credentials = credentialFixture({ configured: true, source: 'env', writable: false })
    const test = bench(90, 28, () => 1_000, { credentials })
    await test.app.start()
    for (const character of '/provider') test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('configured · env · read-only')
    test.terminal.send('\r')
    await test.terminal.settle()
    expect(test.terminal.text()).toContain('managed outside this TUI')
    expect(credentials.writes).toEqual([])

    await test.app.dispose()
  })

  it('redacts an API key even if a DSH credential provider includes it in an error', async () => {
    const credentials = credentialFixture({ configured: true, source: 'file', writable: true })
    credentials.setError = value => new Error(`provider rejected key prefix ${value.slice(0, 8)}`)
    const test = bench(90, 28, () => 1_000, { credentials })
    await test.app.start()
    for (const character of '/provider') test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()
    test.terminal.send('\r')
    await test.terminal.settle()

    const secret = 'sk-never-render-this'
    for (const character of secret) test.terminal.send(character)
    test.terminal.send('\r')
    await test.terminal.settle()

    expect(test.terminal.text()).toContain('Error details are hidden')
    expect(test.terminal.text()).toContain('to protect the key')
    expect(test.terminal.text()).not.toContain(secret)
    expect(test.terminal.text()).not.toContain(secret.slice(0, 8))
    expect(credentials.writes).toEqual([])

    await test.app.dispose()
  })

  it('preserves the captured idle geometry at 100 columns', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/idle-100x30.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(100, 30)
    await test.app.start()
    await test.terminal.settle()

    expect(shellGeometry(test.terminal.bufferType(), test.terminal.lines())).toEqual(
      candidateShellGeometry(shellGeometry(reference.frame.buffer, reference.frame.lines.map(line => line.text))),
    )

    await test.app.dispose()
  })

  it('restores the Claude-like plan indicator from durable Session state', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/permission-plan-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const sessionWithPlanEvents = test.app.agent.session as unknown as {
      append(type: string, data: unknown): unknown
    }
    sessionWithPlanEvents.append('plan/mode', { active: true })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedRow = reference.frame.lines.findIndex(line => line.text.includes('plan mode on'))
    const actualRow = test.terminal.lines().findIndex(line => line.includes('plan mode on'))
    expect({
      buffer: test.terminal.bufferType(),
      planRow: actualRow,
      planStyle: test.terminal.cellStyle(actualRow, 2),
      cursor: test.terminal.cursor(),
    }).toEqual({
      buffer: reference.frame.buffer,
      planRow: candidateRow(expectedRow),
      planStyle: referenceCell(reference, expectedRow, 2),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('matches the captured failed-turn transcript geometry and semantic colors', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/not-logged-in-error-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '!pwd' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'AUTH', message: 'Not logged in · Please run /login' } },
    })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedUserRow = expectedLines.findIndex(line => line.includes('!pwd'))
    const expectedErrorRow = expectedLines.findIndex(line => line.includes('Please run /login'))
    const expectedCompletionRow = expectedLines.findIndex(line => line.startsWith('✻'))
    const actualUserRow = actualLines.findIndex(line => line.includes('!pwd'))
    const actualErrorRow = actualLines.findIndex(line => line.includes('Please run /login'))
    const actualCompletionRow = actualLines.findIndex(line => line.startsWith('✻'))
    expect({
      userRow: actualUserRow,
      errorRow: actualErrorRow,
      completionRow: actualCompletionRow,
      userPrefix: test.terminal.cellStyle(actualUserRow, 0),
      userText: test.terminal.cellStyle(actualUserRow, 2),
      errorText: test.terminal.cellStyle(actualErrorRow, 5),
      cursor: test.terminal.cursor(),
    }).toEqual({
      userRow: candidateRow(expectedUserRow),
      errorRow: candidateRow(expectedErrorRow),
      completionRow: candidateRow(expectedCompletionRow),
      userPrefix: referenceCell(reference, expectedUserRow, 0),
      userText: referenceCell(reference, expectedUserRow, 2),
      errorText: referenceCell(reference, expectedErrorRow, 5),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('matches the captured completed assistant-response geometry', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/response-complete-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Return one deterministic reference response.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Streaming reference response.' }],
        source: { provider: 'test', model: 'model' },
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedAssistantRow = expectedLines.findIndex(line => line.startsWith('⏺ Streaming'))
    const actualAssistantRow = actualLines.findIndex(line => line.startsWith('⏺ Streaming'))
    const expectedCompletionRow = expectedLines.findIndex(line => line.startsWith('✻'))
    const actualCompletionRow = actualLines.findIndex(line => line.startsWith('✻'))
    expect({
      assistantRow: actualAssistantRow,
      assistant: actualLines[actualAssistantRow],
      assistantGlyph: test.terminal.cellStyle(actualAssistantRow, 0),
      completionRow: actualCompletionRow,
      completionStyle: test.terminal.cellStyle(actualCompletionRow, 0),
      cursor: test.terminal.cursor(),
    }).toEqual({
      assistantRow: candidateRow(expectedAssistantRow),
      assistant: expectedLines[expectedAssistantRow],
      assistantGlyph: referenceCell(reference, expectedAssistantRow, 0),
      completionRow: candidateRow(expectedCompletionRow),
      completionStyle: referenceCell(reference, expectedCompletionRow, 0),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('matches the captured in-flight response rows with a stable working label', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/response-streaming-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Stream one deterministic reference response.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'Streaming reference response.' },
    })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedAssistantRow = expectedLines.findIndex(line => line.startsWith('⏺ Streaming'))
    const actualAssistantRow = actualLines.findIndex(line => line.startsWith('⏺ Streaming'))
    const expectedWorkingRow = expectedLines.findIndex(line => line.startsWith('✢'))
    const actualWorkingRow = actualLines.findIndex(line => line.startsWith('✢ Working'))
    expect({
      assistantRow: actualAssistantRow,
      assistant: actualLines[actualAssistantRow],
      workingRow: actualWorkingRow,
      working: actualLines[actualWorkingRow],
      workingGlyph: test.terminal.cellStyle(actualWorkingRow, 0),
      firstDividerRow: actualLines.findIndex((line, row) => row > actualWorkingRow && /^─+$/u.test(line)),
      cursor: test.terminal.cursor(),
    }).toEqual({
      assistantRow: candidateRow(expectedAssistantRow),
      assistant: expectedLines[expectedAssistantRow],
      workingRow: candidateRow(expectedWorkingRow),
      working: '✢ Working…',
      workingGlyph: referenceCell(reference, expectedWorkingRow, 0),
      firstDividerRow: candidateRow(expectedLines.findIndex((line, row) => row > expectedWorkingRow && /^─+$/u.test(line))),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('matches the captured pending Bash call geometry and semantic colors', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/approval-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Run the reference command.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('tool-reference'),
      name: 'Bash',
      arguments: JSON.stringify({
        command: 'touch /tmp/claude-tui-approval-reference',
        description: 'Create a temporary approval reference marker',
      }),
    })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedToolRow = expectedLines.findIndex(line => line.startsWith('⏺ Bash('))
    const expectedWaitingRow = expectedLines.findIndex(line => line.includes('Waiting…'))
    const actualToolRow = actualLines.findIndex(line => line.startsWith('⏺ Bash('))
    const actualWaitingRow = actualLines.findIndex(line => line.includes('Waiting…'))
    expect({
      toolRow: actualToolRow,
      toolLine: actualLines[actualToolRow],
      waitingRow: actualWaitingRow,
      waitingLine: actualLines[actualWaitingRow],
      toolGlyph: test.terminal.cellStyle(actualToolRow, 0),
      toolName: test.terminal.cellStyle(actualToolRow, 2),
      waiting: test.terminal.cellStyle(actualWaitingRow, 2),
    }).toEqual({
      toolRow: candidateRow(expectedToolRow),
      toolLine: expectedLines[expectedToolRow],
      waitingRow: candidateRow(expectedWaitingRow),
      waitingLine: expectedLines[expectedWaitingRow],
      toolGlyph: referenceCell(reference, expectedToolRow, 0),
      toolName: referenceCell(reference, expectedToolRow, 2),
      waiting: referenceCell(reference, expectedWaitingRow, 2),
    })

    await coloredApp.dispose()
  })

  it('matches the captured completed Bash call, result, and follow-up response', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/tool-complete-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    const callId = CallId('tool-reference-complete')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Run the deterministic print reference.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'Bash',
      arguments: JSON.stringify({
        command: "printf 'claude-tui-reference\\n'",
        description: 'Print a local reference marker',
      }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'claude-tui-reference' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'The local reference action completed.' }],
        source: { provider: 'test', model: 'model' },
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const referenceRows = [7, 8, 10]
    const actualRows = referenceRows.map(candidateRow)
    expect({
      lines: actualRows.map(row => actualLines[row]),
      toolGlyph: test.terminal.cellStyle(candidateRow(7), 0),
      toolName: test.terminal.cellStyle(candidateRow(7), 2),
      result: test.terminal.cellStyle(candidateRow(8), 2),
      assistantGlyph: test.terminal.cellStyle(candidateRow(10), 0),
      completionRow: actualLines.findIndex(line => line.startsWith('✻')),
      cursor: test.terminal.cursor(),
    }).toEqual({
      lines: referenceRows.map(row => expectedLines[row]),
      toolGlyph: referenceCell(reference, 7, 0),
      toolName: referenceCell(reference, 7, 2),
      result: referenceCell(reference, 8, 2),
      assistantGlyph: referenceCell(reference, 10, 0),
      completionRow: candidateRow(expectedLines.findIndex(line => line.startsWith('✻'))),
      cursor: candidateCursor(reference.frame.cursor),
    })

    await coloredApp.dispose()
  })

  it('matches the captured foreground-subagent initialization and active-agent roster', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/subagent-foreground-pending-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Delegate one deterministic reference task.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('subagent-reference-pending'),
      name: 'subagent',
      arguments: JSON.stringify({
        description: 'Inspect reference',
        prompt: 'Return exactly CHILD_REFERENCE.',
        run_in_background: false,
      }),
    })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    const runId = SubagentRunId('subagent-run-reference')
    test.app.agent.ctx.emit('subagent/start', {
      runId,
      provider: 'spawn',
      id: SessionId('subagent-reference-child'),
      local: true,
    })
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedToolRow = expectedLines.findIndex(line => line.includes('Agent(Inspect reference)'))
    const actualToolRow = actualLines.findIndex(line => line.includes('Agent(Inspect reference)'))
    const expectedMainRow = expectedLines.findIndex(line => line.trim() === '⏺ main')
    const actualMainRow = actualLines.findIndex(line => line.trim() === '⏺ main')
    expect({
      toolVisible: actualToolRow >= 0,
      initializing: actualLines[actualToolRow + 1]?.trimEnd(),
      toolName: test.terminal.cellStyle(actualToolRow, 2),
      mainVisible: actualMainRow >= 0,
      child: actualLines[actualMainRow + 1]?.trimEnd(),
      childStyle: test.terminal.cellStyle(actualMainRow + 1, 2),
    }).toEqual({
      toolVisible: expectedToolRow >= 0,
      initializing: expectedLines[expectedToolRow + 1],
      toolName: referenceCell(reference, expectedToolRow, 2),
      mainVisible: expectedMainRow >= 0,
      child: '  ◯ spawn  Inspect reference',
      childStyle: referenceCell(reference, expectedMainRow + 1, 2),
    })

    test.terminal.send('\u001B[D')
    await test.terminal.settle()
    expect(test.terminal.lines().some(line => line.trim() === '⏺ main')).toBe(false)
    test.terminal.send('\u001B[D')
    await test.terminal.settle()
    expect(test.terminal.lines().some(line => line.trim() === '⏺ main')).toBe(true)
    test.app.agent.ctx.emit('subagent/end', {
      runId,
      provider: 'spawn',
      id: SessionId('subagent-reference-child'),
      local: true,
      stopReason: 'completed',
    })
    await test.terminal.settle()
    expect(test.terminal.lines().some(line => line.trim() === '⏺ main')).toBe(false)

    await coloredApp.dispose()
  })

  it('matches the captured foreground-subagent completion without inventing Claude-only metrics', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/subagent-foreground-complete-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    const callId = CallId('subagent-reference-complete')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Delegate one deterministic reference task.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'subagent',
      arguments: JSON.stringify({
        description: 'Inspect reference',
        prompt: 'Return exactly CHILD_REFERENCE.',
        run_in_background: false,
      }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'CHILD_REFERENCE' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'The subagent reference completed.' }],
        source: { provider: 'test', model: 'model' },
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedToolRow = expectedLines.findIndex(line => line.startsWith('⏺ Agent('))
    const actualToolRow = actualLines.findIndex(line => line.startsWith('⏺ Agent('))
    const actualAssistantRow = actualLines.findIndex(line => line.startsWith('⏺ The subagent'))
    expect({
      title: actualLines[actualToolRow],
      done: actualLines[actualToolRow + 1]?.trimEnd(),
      expand: actualLines[actualToolRow + 2]?.trimEnd(),
      toolGlyph: test.terminal.cellStyle(actualToolRow, 0),
      assistant: actualLines[actualAssistantRow],
    }).toEqual({
      title: expectedLines[expectedToolRow],
      done: '  ⎿ \u00a0Done',
      expand: expectedLines[expectedToolRow + 2],
      toolGlyph: referenceCell(reference, expectedToolRow, 0),
      assistant: '⏺ The subagent reference completed.',
    })

    await coloredApp.dispose()
  })

  it('renders the captured background-agent handoff without claiming an unavailable manager', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/subagent-background-pending-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    const callId = CallId('subagent-reference-background')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Launch one deterministic background reference task.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'subagent',
      arguments: JSON.stringify({
        description: 'Inspect reference',
        prompt: 'Return exactly CHILD_REFERENCE.',
        run_in_background: true,
      }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'started background subagent task subagent-1' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const expectedToolRow = expectedLines.findIndex(line => line.startsWith('⏺ Agent('))
    const toolRow = actualLines.findIndex(line => line.startsWith('⏺ Agent('))
    expect({
      title: actualLines[toolRow],
      outcome: actualLines[toolRow + 1]?.trimEnd(),
      toolGlyph: test.terminal.cellStyle(toolRow, 0),
      claimsClaudeManager: actualLines.some(line => line.includes('↓ to manage')),
    }).toEqual({
      title: expectedLines[expectedToolRow],
      outcome: expectedLines[expectedToolRow + 1]?.replace('↓ to manage', '← for agents'),
      toolGlyph: referenceCell(reference, expectedToolRow, 0),
      claimsClaudeManager: false,
    })

    await coloredApp.dispose()
  })

  it('matches the captured approval panel while exposing the Harness grant boundary', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/approval-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    const session = test.app.agent.session
    const callId = CallId('tool-reference-approval')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Run the reference command.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'Bash',
      arguments: JSON.stringify({
        command: 'touch /tmp/claude-tui-approval-reference',
        description: 'Create a temporary approval reference marker',
      }),
    })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    const outcome = test.app.agent.ctx.waterfall(
      'approval/request',
      {
        agent: test.app.agent,
        toolName: 'Bash',
        callId,
        reason: 'Create a temporary approval reference marker',
      },
      () => Promise.resolve('unavailable'),
    )
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    expect({
      divider: actualLines[10],
      heading: actualLines[11]?.trimEnd(),
      command: actualLines[13]?.trimEnd(),
      description: actualLines[14]?.trimEnd(),
      question: actualLines[16]?.trimEnd(),
      allow: actualLines[17]?.trimEnd(),
      unavailable: actualLines[18]?.trimEnd(),
      reject: actualLines[19]?.trimEnd(),
      dividerStyle: test.terminal.cellStyle(10, 0),
      headingStyle: test.terminal.cellStyle(11, 1),
      selectionStyle: test.terminal.cellStyle(17, 1),
      numberStyle: test.terminal.cellStyle(17, 3),
      cursor: test.terminal.cursor(),
    }).toEqual({
      divider: expectedLines[10],
      heading: expectedLines[11],
      command: expectedLines[13],
      description: expectedLines[14],
      question: expectedLines[16],
      allow: expectedLines[17],
      unavailable: '   2. Always allow is unavailable in Harness',
      reject: expectedLines[19],
      dividerStyle: referenceCell(reference, 10, 0),
      headingStyle: referenceCell(reference, 11, 1),
      selectionStyle: referenceCell(reference, 17, 1),
      numberStyle: referenceCell(reference, 17, 3),
      cursor: reference.frame.cursor,
    })

    test.terminal.send('\r')
    await expect(outcome).resolves.toBe('allowed-once')
    await coloredApp.dispose()
  })

  it('maps the approval panel No row to a rejected Harness outcome', async () => {
    const test = bench(80, 24)
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    const outcome = test.app.agent.ctx.waterfall(
      'approval/request',
      { agent: test.app.agent, toolName: 'write', reason: 'Modify one workspace file' },
      () => Promise.resolve('unavailable'),
    )
    await test.terminal.settle()

    test.terminal.send('\u001B[B')
    await test.terminal.settle()
    expect(test.terminal.lines()[19]?.trimEnd()).toBe(' ❯ 3. No')
    expect(test.terminal.cursor()).toEqual({ column: 1, row: 19 })
    test.terminal.send('\r')
    await expect(outcome).resolves.toBe('rejected')

    await coloredApp.dispose()
  })

  it('matches the captured structured-question panel and returns its selected label', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/user-question-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    test.app.agent.session.append('turn/start', { turn: 1 })
    test.app.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Ask one deterministic reference question.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const coloredApp = new ClaudeTuiApplication(
      test.ctx,
      test.app.agent,
      resolveConfig({ color: true }),
      { terminal: test.terminal, exit: code => { test.exitCodes.push(code) } },
    )
    await coloredApp.start()
    const answer = test.askQuestions({
      agent: test.app.agent,
      questions: [{
        id: 'reference',
        header: 'Reference',
        question: 'Which reference option should be used?',
        options: [
          { label: 'Alpha', description: 'Use the first deterministic option.' },
          { label: 'Beta', description: 'Use the second deterministic option.' },
        ],
      }],
    })
    await test.terminal.settle()

    const expectedLines = reference.frame.lines.map(line => line.text)
    const actualLines = test.terminal.lines()
    const rows = [6, 7, 9, 11, 12, 13, 14, 15, 16, 17, 19]
    expect({
      lines: rows.map(row => row === 7
        ? actualLines[row]?.slice(0, expectedLines[row]?.length)
        : actualLines[row]?.trimEnd()),
      divider: test.terminal.cellStyle(6, 0),
      tab: test.terminal.cellStyle(7, 0),
      question: test.terminal.cellStyle(9, 0),
      arrow: test.terminal.cellStyle(11, 0),
      number: test.terminal.cellStyle(11, 2),
      label: test.terminal.cellStyle(11, 5),
      cursor: test.terminal.cursor(),
    }).toEqual({
      lines: rows.map(row => expectedLines[row]),
      divider: referenceCell(reference, 6, 0),
      tab: referenceCell(reference, 7, 0),
      question: referenceCell(reference, 9, 0),
      arrow: referenceCell(reference, 11, 0),
      number: referenceCell(reference, 11, 2),
      label: referenceCell(reference, 11, 5),
      cursor: reference.frame.cursor,
    })

    test.terminal.send('\r')
    await expect(answer).resolves.toEqual({
      answers: [{ id: 'reference', selected: ['Alpha'] }],
    })
    await coloredApp.dispose()
  })

  it('requires the captured second Ctrl+D gesture before exiting an empty prompt', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/ctrl-d-confirm-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    await test.app.start()
    test.terminal.send('\u0004')
    await test.terminal.settle()

    const expectedRow = reference.frame.lines.findIndex(line => line.text.includes('Press Ctrl-D again to exit'))
    expect({
      exitCodes: test.exitCodes,
      confirmationRow: test.terminal.lines().findIndex(line => line.includes('Press Ctrl-D again to exit')),
      buffer: test.terminal.bufferType(),
      cursor: test.terminal.cursor(),
    }).toEqual({
      exitCodes: [],
      confirmationRow: candidateRow(expectedRow),
      buffer: reference.frame.buffer,
      cursor: candidateCursor(reference.frame.cursor),
    })

    test.terminal.send('\u0004')
    await test.app.requestExit()
    expect(test.exitCodes).toEqual([0])
  })

  it('leaves a non-empty draft untouched when Ctrl+D is pressed', async () => {
    const test = bench(80, 24)
    await test.app.start()
    for (const character of 'draft') test.terminal.send(character)
    test.terminal.send('\u0004')
    await test.terminal.settle()

    expect({
      prompt: test.terminal.lines()[candidateRow(6)],
      confirmationVisible: test.terminal.text().includes('Press Ctrl-D again to exit'),
      exitCodes: test.exitCodes,
    }).toEqual({
      prompt: '❯\u00a0draft ',
      confirmationVisible: false,
      exitCodes: [],
    })

    await test.app.dispose()
  })

  it('uses the measured 800ms window for a second exit gesture', async () => {
    let now = 1_000
    const test = bench(80, 24, () => now)
    await test.app.start()
    test.terminal.send('\u0004')
    now += 801
    test.terminal.send('\u0004')
    await test.terminal.settle()

    expect(test.exitCodes).toEqual([])
    expect(test.terminal.text()).toContain('Press Ctrl-D again to exit')

    now += 799
    test.terminal.send('\u0004')
    await test.app.requestExit()
    expect(test.exitCodes).toEqual([0])
  })

  it('requires the captured second Ctrl+C gesture before exiting an empty prompt', async () => {
    const reference = JSON.parse(readFileSync(
      new URL('./fixtures/claude-code-2.1.227/ctrl-c-confirm-80x24.json', import.meta.url),
      'utf8',
    )) as ReferenceFrame
    const test = bench(80, 24)
    await test.app.start()
    test.terminal.send('\u0003')
    await test.terminal.settle()

    const expectedRow = reference.frame.lines.findIndex(line => line.text.includes('Press Ctrl-C again to exit'))
    expect({
      exitCodes: test.exitCodes,
      confirmationRow: test.terminal.lines().findIndex(line => line.includes('Press Ctrl-C again to exit')),
      buffer: test.terminal.bufferType(),
      cursor: test.terminal.cursor(),
    }).toEqual({
      exitCodes: [],
      confirmationRow: candidateRow(expectedRow),
      buffer: reference.frame.buffer,
      cursor: candidateCursor(reference.frame.cursor),
    })

    test.terminal.send('\u0003')
    await test.app.requestExit()
    expect(test.exitCodes).toEqual([0])
  })

  it('renders the Claude-like main-screen shell and submits a prompt to an idle Agent', async () => {
    const test = bench()
    await test.app.start()
    await test.terminal.settle()

    expect(test.terminal.started).toBe(1)
    expect(test.terminal.title).toBe('DSH Claude TUI')
    expect(test.terminal.text()).toContain('DSH Claude TUI')
    expect(test.terminal.text()).toContain('/workspace/project')
    expect(test.terminal.text()).toContain('terminal-test')
    expect(test.terminal.text()).toContain('test/model')
    expect(test.terminal.text()).toContain('? for shortcuts')

    for (const character of 'inspect this') test.terminal.send(character)
    test.terminal.send('\r')
    expect(test.followups).toHaveLength(1)
    expect(test.followups[0]?.content).toEqual([{ type: 'text', text: 'inspect this' }])

    await test.app.dispose()
    expect(test.terminal.drained).toBe(1)
    expect(test.terminal.stopped).toBe(1)
  })

  it('maps Ctrl+O to expanded transcript and a confirmed Ctrl+D to graceful exit', async () => {
    const test = bench()
    await test.app.start()
    test.terminal.send('\u000F')
    await test.terminal.settle()
    expect(test.terminal.text()).toContain('transcript expanded')

    test.terminal.send('\u0004')
    expect(test.exitCodes).toEqual([])
    test.terminal.send('\u0004')
    await test.app.requestExit()
    expect(test.exitCodes).toEqual([0])
    expect(test.terminal.stopped).toBe(1)
  })
})
