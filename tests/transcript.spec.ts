/** Durable transcript projection and terminal-control safety. */
import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { displayText, prettyArguments } from '../src/text.ts'
import { TranscriptModel } from '../src/transcript.ts'

describe('TranscriptModel', () => {
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
    model.replay(session.events)

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
    model.replay(session.events)

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
        block: { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
      },
    })

    const model = new TranscriptModel()
    model.replay(session.events)

    expect(model.items).toEqual([])
  })
})
