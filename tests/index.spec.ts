/** Startup settlement must not await the Include entry that owns this plugin. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { awaitCompositionSettlement } from '../src/index.ts'

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
