/** Startup settlement must not await the Include entry that owns this plugin. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply,
  awaitCompositionSettlement,
  internals,
  runCompatibilityProbe,
} from '../src/index.ts'

describe('awaitCompositionSettlement', () => {
  it('awaits the current entry tree instead of the root loader', async () => {
    const localAwait = vi.fn(async () => undefined)
    const rootAwait = vi.fn(async () => undefined)
    const ctx = {
      fiber: {
        entry: {
          parent: {
            tree: { await: localAwait },
          },
        },
      },
      get: vi.fn(() => ({ await: rootAwait })),
    } as unknown as Context

    await awaitCompositionSettlement(ctx)

    expect(localAwait).toHaveBeenCalledOnce()
    expect(rootAwait).not.toHaveBeenCalled()
  })

  it('falls back to the root loader when mounted outside an entry tree', async () => {
    const rootAwait = vi.fn(async () => undefined)
    const ctx = {
      fiber: { entry: undefined },
      get: vi.fn(() => ({ await: rootAwait })),
    } as unknown as Context

    await awaitCompositionSettlement(ctx)

    expect(rootAwait).toHaveBeenCalledOnce()
  })
})

describe('launcher compatibility probe', () => {
  it('creates, flushes, and disposes a temporary Agent without starting the terminal', async () => {
    const session = { id: 'probe-session' }
    const whenIdle = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const agent = { session, whenIdle }
    const create = vi.fn(async () => ({ agent, dispose }))
    const flush = vi.fn(async () => undefined)
    const localAwait = vi.fn(async () => undefined)
    const unregisterCommand = vi.fn()
    let commandHandler: ((invocation: never) => unknown) | undefined
    const register = vi.fn((definition: { handler: (invocation: never) => unknown }) => {
      commandHandler = definition.handler
      return unregisterCommand
    })
    const execute = vi.fn(async (
      target: typeof agent,
      line: string,
      attachments: readonly unknown[],
      signal: AbortSignal,
    ) => {
      const result = await commandHandler?.({ attachments, signal } as never)
      return result === undefined ? undefined : { commandId: 'probe-command', result }
    })
    const ctx = {
      fiber: { entry: { parent: { tree: { await: localAwait } } } },
      get: vi.fn((service: string) => {
        if (service === 'agents') return { create }
        if (service === 'commands') return { execute, register }
        if (service === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
        }
        if (service === 'sessions') return { flush }
        return undefined
      }),
    } as unknown as Context
    const controller = new AbortController()

    const result = await runCompatibilityProbe(
      ctx,
      '01234567-89ab-cdef-0123-456789abcdef',
      '0.1.0',
      controller.signal,
    )

    expect(result).toEqual({
      token: '01234567-89ab-cdef-0123-456789abcdef',
      package: 'dsh-claude-tui',
      version: '0.1.0',
      services: ['agentDefaultModel', 'agents', 'commands', 'sessions'],
    })
    expect(localAwait).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^dsh-claude-tui-probe-/u),
      agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
      signal: controller.signal,
    }))
    expect(whenIdle).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'dsh-claude-tui-probe',
      handler: expect.any(Function),
    }))
    expect(execute).toHaveBeenCalledWith(
      agent,
      '/dsh-claude-tui-probe',
      [],
      controller.signal,
    )
    expect(flush).toHaveBeenCalledWith(session)
    expect(unregisterCommand).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()

    const unregisterFailure = new Error('command unregister failed')
    unregisterCommand.mockImplementationOnce(() => { throw unregisterFailure })
    await expect(runCompatibilityProbe(
      ctx as never,
      '01234567-89ab-cdef-0123-456789abcdef',
      '0.1.0',
      controller.signal,
    ))
      .rejects.toThrow(unregisterFailure)
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('enters the hidden probe branch before enforcing the interactive TTY contract', () => {
    const previousTty = internals.isTty
    vi.stubEnv('DSH_CLAUDE_TUI_PROBE_TOKEN', '01234567-89ab-cdef-0123-456789abcdef')
    internals.isTty = () => false
    const effect = vi.fn()
    const ctx = {
      get: vi.fn((service: string) => service === 'appExit' ? vi.fn() : undefined),
      effect,
    } as unknown as Context
    try {
      expect(() => apply(ctx, {})).not.toThrow()
      expect(effect).toHaveBeenCalledOnce()
      expect(effect).toHaveBeenCalledWith(
        expect.any(Function),
        'claude-tui.compatibility-probe()',
      )
    } finally {
      internals.isTty = previousTty
      vi.unstubAllEnvs()
    }
  })
})
