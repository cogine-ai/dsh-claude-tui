/** Durable transcript projection and terminal-control safety. */
import { describe, expect, it } from 'vitest'
import {
  AssistantStreamAccumulator,
  LlmAttemptId,
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { displayText, prettyArguments } from '../src/text.ts'
import { createPalette } from '../src/theme.ts'
import { TranscriptComponent, TranscriptModel } from '../src/transcript.ts'

function start(model: TranscriptModel, id = 'attempt-1'): void {
  model.applyStream({ type: 'start', attemptId: LlmAttemptId(id), revision: 1, turn: 1, step: 1 })
}

function text(model: TranscriptModel, value: string, id = 'attempt-1'): void {
  model.applyStream({
    type: 'chunk', attemptId: LlmAttemptId(id), revision: 2, index: 0, time: 300,
    chunk: { type: 'text-delta', index: 0, text: value },
  })
}

function settled(session: Session, value: string, interrupted = false): SessionEvent<'assistant/message'> {
  return session.append('assistant/message', {
    turn: 1, step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: value }],
      source: { provider: 'test', model: 'model' },
    }),
    stream: [{ type: 'text-chunks', time0: 300, index: 0, dt: [0], texts: [value] }],
    usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
    ...(interrupted ? { interrupted: true as const } : {}),
  }, { surfaceOp: 'append' })
}

describe('TranscriptModel', () => {
  it('retains durable image count for Claude-like Session replay without polluting prompt text', () => {
    const session = Session.create(SessionId('image-projection'))
    const attachment = {
      attachmentId: 'image-1' as never, mediaType: 'image/png' as const,
      bytes: 8, width: 1, height: 1,
    }
    session.append('user/message', createUserMessage({
      content: [
        { type: 'image', attachment },
        { type: 'text', text: 'inspect this' },
        { type: 'image', attachment: { ...attachment, attachmentId: 'image-2' as never } },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())
    expect(model.items).toEqual([expect.objectContaining({ kind: 'user', text: 'inspect this', imageCount: 2 })])
    expect(new TranscriptComponent(model, createPalette(false), 100, 10, true).render(80).join('\n'))
      .toContain('❯ [Image #1] [Image #2] inspect this')
  })

  it('settles live text once and reproduces the same transcript and usage on V4 replay', () => {
    const session = Session.create(SessionId('projection'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'inspect' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())
    start(model)
    text(model, 'draft')
    expect(model.items[1]).toMatchObject({ text: 'draft', pending: true })
    model.apply(settled(session, 'final'))
    model.applyStream({
      type: 'end', attemptId: LlmAttemptId('attempt-1'), revision: 3, index: 1,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(3) },
    })
    model.apply(session.append('step/end', { turn: 1, step: 1 }))
    model.apply(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(model.items.map(item => item.kind)).toEqual(['user', 'assistant', 'completion'])
    expect(model.items[1]).toMatchObject({ text: 'final', pending: false })
    expect(model.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 })
    const replay = new TranscriptModel()
    replay.replay(session.snapshotEvents())
    expect(replay.items.map(({ revision: _revision, ...item }) => item))
      .toEqual(model.items.map(({ revision: _revision, ...item }) => item))
    expect(replay.usage).toEqual(model.usage)
    expect(replay.performance).toEqual(model.performance)
  })

  it('replays first-class tool-role results with direct text blocks and their error state', () => {
    const session = Session.create(SessionId('tool-role-projection'))
    const callId = ToolCallId('call-1')
    session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"pwd"}',
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId, isError: true,
        content: [
          { type: 'text', text: 'Permission denied\n' },
          { type: 'text', text: '\u001b[2J' },
        ],
      }),
    }, { surfaceOp: 'append' })
    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())
    expect(model.items).toEqual([expect.objectContaining({
      kind: 'tool', callId: 'call-1', name: 'bash',
      arguments: '{\n  "command": "pwd"\n}',
      result: 'Permission denied\n\\x1b[2J', error: true, pending: false,
    })])
    expect(new TranscriptComponent(model, createPalette(false), 100, 10, true).render(80).join('\n'))
      .toContain('Permission denied')
  })

  it('settles an existing call live and projects an unmatched V4 tool result', () => {
    const session = Session.create(SessionId('tool-role-live'))
    const model = new TranscriptModel()
    const callId = ToolCallId('call-1')
    model.apply(session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'bash', arguments: '{}',
    }))
    model.apply(session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId, isError: false, content: [{ type: 'text', text: '/workspace' }],
      }),
    }, { surfaceOp: 'append' }))
    model.apply(session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-2'), isError: true,
        content: [{ type: 'text', text: 'Command did not run' }],
      }),
      error: { name: 'ToolError', code: 'TOOL_NOT_STARTED', reason: 'Interrupted before dispatch' },
    }, { surfaceOp: 'append' }))
    expect(model.items).toEqual([
      expect.objectContaining({ kind: 'tool', callId: 'call-1', result: '/workspace', error: false, pending: false }),
      expect.objectContaining({ kind: 'tool', callId: 'call-2', name: 'tool', result: 'Command did not run', error: true, pending: false }),
    ])
    const replay = new TranscriptModel()
    replay.replay(session.snapshotEvents())
    expect(replay.items).toEqual(model.items)
  })

  it('shows notice summaries from concrete V4 producers without showing their model-facing text', () => {
    const session = Session.create(SessionId('producer-notice'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Detailed model-facing route change' }],
      source: { kind: 'model-selection', form: 'notice', summary: 'old/model → new/model\u0007' },
    }), { surfaceOp: 'append' })
    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())
    expect(model.items).toEqual([expect.objectContaining({
      kind: 'notice', text: 'old/model → new/model\\x07', tone: 'info',
    })])
  })

  it('explains an unfinished turn inherited by a fork without marking it as a failed request', () => {
    const session = Session.create(SessionId('forked-projection'))
    const model = new TranscriptModel()
    model.apply(session.append('turn/end', { turn: 1, reason: { kind: 'forked' } }))
    expect(model.items[0]).toMatchObject({
      kind: 'notice', text: 'Forked from an unfinished turn.', tone: 'info',
    })
  })

  it('discards failed and abandoned attempt drafts before retrying the same step', () => {
    const session = Session.create(SessionId('retry'))
    const model = new TranscriptModel()
    start(model)
    text(model, 'failed prefix')
    model.apply(session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }))
    expect(model.items).toEqual([])
    start(model, 'retry')
    text(model, 'stale frame', 'attempt-1')
    text(model, 'new prefix', 'retry')
    model.applyStream({ type: 'end', attemptId: LlmAttemptId('attempt-1'), revision: 3, index: 1, outcome: { kind: 'abandoned' } })
    expect(model.items).toEqual([expect.objectContaining({ text: 'new prefix', pending: true })])
    model.applyStream({ type: 'end', attemptId: LlmAttemptId('retry'), revision: 3, index: 1, outcome: { kind: 'abandoned' } })
    expect(model.items).toEqual([])
    model.replay(session.snapshotEvents())
    expect(model.items).toEqual([])
  })

  it('preserves a committed interrupted prefix after its live attempt ends', () => {
    const session = Session.create(SessionId('interrupted'))
    const model = new TranscriptModel()
    start(model)
    text(model, 'partial')
    model.apply(settled(session, 'partial', true))
    model.applyStream({ type: 'end', attemptId: LlmAttemptId('attempt-1'), revision: 3, index: 1, outcome: { kind: 'abandoned' } })
    model.apply(session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
    expect(model.items[0]).toMatchObject({ text: 'partial', pending: false })
    expect(model.items[1]).toMatchObject({ kind: 'notice', text: 'Interrupted by user.' })
  })

  it('renders untrusted terminal controls visibly and formats JSON arguments', () => {
    expect(displayText('safe\u001B[31mred\u0007')).toBe('safe\\x1b[31mred\\x07')
    expect(prettyArguments('{"path":"a","count":2}')).toBe('{\n  "path": "a",\n  "count": 2\n}')
    const model = new TranscriptModel()
    start(model)
    text(model, '\u001B[2J')
    expect(model.items[0]).toMatchObject({ text: '\\x1b[2J' })
  })

  it('does not create a working assistant for tool-only or finish-only streams', () => {
    const model = new TranscriptModel()
    start(model)
    model.applyStream({
      type: 'chunk', attemptId: LlmAttemptId('attempt-1'), revision: 2, index: 0, time: 100,
      chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'bash', arguments: '{}' } },
    })
    model.applyStream({
      type: 'chunk', attemptId: LlmAttemptId('attempt-1'), revision: 3, index: 1, time: 101,
      chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'missing key' } } },
    })
    expect(model.items).toEqual([])
  })

  it('uses compact stream token boundaries for tool-only timing after a cold replay', () => {
    const stream = new AssistantStreamAccumulator()
    stream.push({ time: 110, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } })
    stream.push({ time: 120, chunk: { type: 'text-delta', index: 0, text: '' } })
    stream.push({ time: 130, chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-timing'), argumentsDelta: '' } })
    stream.push({ time: 300, chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-timing'), name: 'bash', argumentsDelta: '' } })
    const events: SessionEvent[] = [
      { type: 'step/start', seq: SessionSeq(0), time: 100, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message', seq: SessionSeq(1), time: 500, surfaceOp: 'append',
        data: {
          turn: 1, step: 1,
          message: createAssistantMessage({
            content: [{ type: 'tool-call', id: ToolCallId('call-timing'), name: 'bash', arguments: '{}' }],
            source: { provider: 'test', model: 'model' },
          }),
          stream: [...stream.snapshot()], usage: { inputTokens: 10, outputTokens: 4 },
        },
      },
    ]
    const model = new TranscriptModel()
    model.replay(events)
    expect(model.performance).toEqual({ timeToFirstTokenMs: 200, outputTokensPerSecond: 20 })
  })
})
