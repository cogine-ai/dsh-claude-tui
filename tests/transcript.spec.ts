/** Durable transcript projection and terminal-control safety. */
import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { displayText, prettyArguments } from '../src/text.ts'
import { createPalette } from '../src/theme.ts'
import { TranscriptComponent, TranscriptModel } from '../src/transcript.ts'

describe('TranscriptModel', () => {
  it('retains durable image count for Claude-like Session replay without polluting prompt text', () => {
    const session = Session.create(SessionId('image-projection'))
    const attachment = {
      attachmentId: 'image-1' as never,
      mediaType: 'image/png' as const,
      bytes: 8,
      width: 1,
      height: 1,
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

    expect(model.items).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'inspect this',
        imageCount: 2,
      }),
    ])
    const rendered = new TranscriptComponent(model, createPalette(false), 100, 10, true)
      .render(80)
      .join('\n')
    expect(rendered).toContain('❯ [Image #1] [Image #2] inspect this')
  })

  it('replays user, assistant, tool, usage, and turn outcomes in log order', () => {
    const session = Session.create(SessionId('projection'))
    const user = createUserMessage({
      content: [{ type: 'text', text: 'inspect' }],
      source: { kind: 'user' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', user, { surfaceOp: 'append' })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'draft' },
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'check first' },
          { type: 'text', text: 'final' },
        ],
        source: { provider: 'test', model: 'model' },
      }),
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
      },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())

    expect(model.items.map(item => item.kind)).toEqual(['user', 'assistant', 'completion'])
    expect(model.items[1]).toMatchObject({ text: 'final', reasoning: 'check first', pending: false })
    expect(model.items[2]).toMatchObject({ kind: 'completion', seconds: 0 })
    expect(model.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
  })

  it('renders untrusted terminal controls visibly and formats JSON arguments', () => {
    expect(displayText('safe\u001B[31mred\u0007')).toBe('safe\\x1b[31mred\\x07')
    expect(prettyArguments('{"path":"a","count":2}')).toBe('{\n  "path": "a",\n  "count": 2\n}')
  })

  it('removes an empty pending assistant when a provider fails at finish', () => {
    const session = Session.create(SessionId('failed-finish'))
    session.append('turn/start', { turn: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'missing key' } },
      },
    })
    session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'missing key' } },
    })

    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())

    expect(model.items.map(item => item.kind)).toEqual(['notice', 'completion'])
  })

  it('does not create a working assistant for a tool-call stream block', () => {
    const session = Session.create(SessionId('tool-stream'))
    session.append('turn/start', { turn: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'bash', arguments: '{}' },
      },
    })

    const model = new TranscriptModel()
    model.replay(session.snapshotEvents())

    expect(model.items).toEqual([])
  })

  it('uses the DSH token boundary for tool-only response timing', () => {
    const message = createAssistantMessage({
      content: [{
        type: 'tool-call',
        id: ToolCallId('call-timing'),
        name: 'bash',
        arguments: '{}',
      }],
      source: { provider: 'test', model: 'model' },
    })
    const events = [
      { type: 'step/start', seq: SessionSeq(0), time: 100, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/chunk',
        seq: SessionSeq(1),
        time: 110,
        data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
      },
      {
        type: 'assistant/chunk',
        seq: SessionSeq(2),
        time: 120,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '' } },
      },
      {
        type: 'assistant/chunk',
        seq: SessionSeq(3),
        time: 130,
        data: {
          turn: 1,
          step: 1,
          chunk: {
            type: 'tool-call-delta',
            index: 0,
            id: ToolCallId('call-timing'),
            argumentsDelta: '',
          },
        },
      },
      {
        type: 'assistant/chunk',
        seq: SessionSeq(4),
        time: 300,
        data: {
          turn: 1,
          step: 1,
          chunk: {
            type: 'tool-call-delta',
            index: 0,
            id: ToolCallId('call-timing'),
            name: 'bash',
            argumentsDelta: '',
          },
        },
      },
      {
        type: 'assistant/message',
        seq: SessionSeq(5),
        time: 500,
        data: {
          turn: 1,
          step: 1,
          message,
          usage: { inputTokens: 10, outputTokens: 4 },
        },
        sourceEventSeqs: [SessionSeq(1), SessionSeq(2), SessionSeq(3), SessionSeq(4)],
      },
    ] satisfies SessionEvent[]
    const model = new TranscriptModel()

    model.replay(events)

    expect(model.performance).toEqual({
      timeToFirstTokenMs: 200,
      outputTokensPerSecond: 20,
    })
  })
})
