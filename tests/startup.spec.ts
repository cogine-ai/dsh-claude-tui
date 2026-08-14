/** App-owned command-line grammar for exact and interactive resume. */
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/startup.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function parse(args: readonly string[]) {
  const ctx = new Context()
  contexts.push(ctx)
  provideCmdline(ctx, { args, exit: () => {} })
  apply(ctx)
  return ctx.claudeTuiStartup
}

describe('claude-tui startup grammar', () => {
  it('distinguishes an interactive --resume picker from exact-id resume', () => {
    expect(parse(['--resume'])).toMatchObject({ resumePicker: true, color: true })
    expect(parse(['--resume', 'session-123'])).toMatchObject({
      resumePicker: false,
      resumeSessionId: 'session-123',
      color: true,
    })
  })
})
