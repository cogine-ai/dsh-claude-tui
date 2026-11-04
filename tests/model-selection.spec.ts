/** TUI setup over the real DSH model-selection projection and Session log. */
import { Context } from '@deepseek-ai/cordis'
import { AgentModel, modelSelectionProjectionDefinition, type ModelSelection } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it } from 'vitest'
import { setupModelSelection } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  const session = ctx.sessions.create(SessionId('tui-model-selection'))
  const defaults = { provider: 'test', model: 'default' }
  const model = new AgentModel(projection.readerFor(session), session, defaults)
  const agent = { model }
  return { ctx, session, model, agent, projection, defaults }
}

describe('DSH-owned model selection', () => {
  it('preserves a choice made before any request through log reconstruction and TUI setup', async () => {
    const { ctx, session, model, projection, defaults } = await fixture()
    const picked = { provider: 'test', model: 'unused-choice', reasoningEffort: 'high' as never }
    model.select(picked)
    expect(session.requestHeader()).toBeUndefined()
    const history = session.snapshotEvents()
    expect(history.at(-1)).toMatchObject({ type: 'model/selection', data: picked })

    const restored = Session.fromRestore(session.id, history, session.header, SessionLogOffset(0), 'shared-frozen')
    const restoredEvents = restored.snapshotEvents()
    const resumed = new AgentModel(projection.readerFor(restored), restored, defaults)
    setupModelSelection()(ctx.extend(), { model: resumed })

    expect(resumed.current()).toEqual(picked)
    expect(restored.snapshotEvents()).toEqual(restoredEvents)
    expect(restoredEvents.slice(0, history.length)).toEqual(history)
  })

  it.each([true, false])('inherits saved explicit effort only on the same invocation route (%s)', async sameRoute => {
    const { ctx, session, model, agent } = await fixture()
    model.select({ provider: 'test', model: 'saved', reasoningEffort: 'high' as never })
    const override = { provider: sameRoute ? 'test' : 'other', model: 'saved' }

    setupModelSelection(override)(ctx.extend(), agent)

    expect(model.current()).toEqual({
      ...override,
      ...(sameRoute ? { reasoningEffort: 'high' } : {}),
    })
    expect(session.snapshotEvents().at(-1)).toMatchObject({
      type: 'model/selection', data: model.current(),
    })
  })

  it('records an explicit invocation choice before the first request without mutating defaults', async () => {
    const { ctx, session, model, agent, defaults } = await fixture()
    const override: ModelSelection = { provider: 'other', model: 'chosen' }
    setupModelSelection(override)(ctx.extend(), agent)
    expect(model.current()).toEqual(override)
    expect(session.snapshotEvents().at(-1)).toMatchObject({ type: 'model/selection', data: override })
    expect(defaults).toEqual({ provider: 'test', model: 'default' })
  })
})
