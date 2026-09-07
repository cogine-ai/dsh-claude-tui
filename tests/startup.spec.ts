/** App-owned command-line grammar for exact and interactive resume. */
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('reads the launcher fallback notice without turning it into a CLI argument', () => {
    vi.stubEnv('DSH_CLAUDE_TUI_LAUNCH_NOTICE', 'Using isolated DSH_HOME; sessions were not copied.')
    try {
      expect(parse([])).toMatchObject({
        launchNotice: 'Using isolated DSH_HOME; sessions were not copied.',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('accepts only a valid launcher runtime snapshot', () => {
    vi.stubEnv('DSH_CLAUDE_TUI_RUNTIME_SNAPSHOT', JSON.stringify({
      harnessVersion: '0.1.2-rc.1',
      runtimeKind: 'bundled',
      homeKind: 'shared',
      homePath: '/tmp/test-dsh-home',
      toolsMode: 'both',
    }))
    try {
      expect(parse([])).toMatchObject({
        runtimeSnapshot: {
          harnessVersion: '0.1.2-rc.1',
          runtimeKind: 'bundled',
          homeKind: 'shared',
          homePath: '/tmp/test-dsh-home',
          toolsMode: 'both',
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }

    vi.stubEnv('DSH_CLAUDE_TUI_RUNTIME_SNAPSHOT', '{"toolsMode":"invented"}')
    try {
      expect(parse([])).not.toHaveProperty('runtimeSnapshot')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
