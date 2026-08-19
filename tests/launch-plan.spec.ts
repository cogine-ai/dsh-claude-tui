import { describe, expect, it, vi } from 'vitest'
import {
  createLaunchPlanner,
  type DshRuntime,
  type HomeAssessment,
  type LaunchPlannerAdapter,
  type LaunchRequest,
  type ProfileAssessment,
} from '../src/launch-plan.ts'

const bundled: DshRuntime = {
  kind: 'bundled',
  source: 'bundled',
  version: '0.1.0-rc.8',
  packageRoot: '/package/node_modules/@deepseek-ai/dsh',
  executable: '/package/node_modules/@deepseek-ai/dsh/lib/bin.js',
}

function absent(): ProfileAssessment {
  return { kind: 'absent' }
}

function managed(): ProfileAssessment {
  return { kind: 'managed' }
}

function unowned(): ProfileAssessment {
  return { kind: 'unowned' }
}

function conflict(reason: string): ProfileAssessment {
  return { kind: 'conflict', reason }
}

function home(
  legacy: ProfileAssessment = absent(),
  namespaced: ProfileAssessment = absent(),
): HomeAssessment {
  return { legacy, namespaced }
}

function system(
  version: string,
  source: 'home' | 'path' = 'path',
  suffix = version,
): DshRuntime {
  return {
    kind: 'system',
    source,
    version,
    packageRoot: `/system/${suffix}/@deepseek-ai/dsh`,
    executable: `/system/${suffix}/@deepseek-ai/dsh/lib/bin.js`,
  }
}

function request(overrides: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    runtimePreference: 'auto',
    sharedHome: '/home/user/.dsh',
    isolatedHome: '/home/user/.dsh-claude-tui',
    explicitHome: false,
    ...overrides,
  }
}

function adapter(options: {
  shared?: HomeAssessment
  isolated?: HomeAssessment
  candidates?: readonly DshRuntime[]
  compatible?: Readonly<Record<string, boolean>>
  diagnostics?: readonly string[]
} = {}): LaunchPlannerAdapter {
  const shared = options.shared ?? home()
  const isolated = options.isolated ?? home()
  const compatible = options.compatible ?? {}
  return {
    inspectHome: vi.fn((path: string) => path === '/home/user/.dsh' ? shared : isolated),
    discoverExternalRuntimes: vi.fn(async () => ({
      runtimes: options.candidates ?? [],
      diagnostics: options.diagnostics ?? [],
    })),
    bundledRuntime: vi.fn(() => bundled),
    probeRuntime: vi.fn(async (runtime: DshRuntime) => {
      if (compatible[runtime.executable] === false) {
        return { compatible: false as const, reason: `probe rejected ${runtime.version}` }
      }
      return { compatible: true as const }
    }),
  }
}

describe('launcher environment planning', () => {
  it('prefers a compatible DSH associated with the shared home', async () => {
    const homeRuntime = system('0.1.0-rc.8', 'home', 'home-runtime')
    const pathRuntime = system('0.1.0', 'path', 'path-runtime')
    const boundary = adapter({ candidates: [homeRuntime, pathRuntime] })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(homeRuntime)
    expect(plan.home).toEqual({ kind: 'shared', path: '/home/user/.dsh', explicit: false })
    expect(plan.profile).toEqual({ name: 'dsh-claude-tui', action: 'create' })
    expect(boundary.probeRuntime).toHaveBeenCalledTimes(1)
  })

  it('skips an out-of-range candidate and tries the next compatible runtime', async () => {
    const oldHomeRuntime = system('0.1.0-rc.7', 'home', 'old-home-runtime')
    const pathRuntime = system('0.1.0', 'path', 'path-runtime')
    const boundary = adapter({ candidates: [oldHomeRuntime, pathRuntime] })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(pathRuntime)
    expect(boundary.probeRuntime).toHaveBeenCalledOnce()
    expect(boundary.probeRuntime).toHaveBeenCalledWith(pathRuntime)
  })

  it('falls back to the pinned bundled runtime when external probes fail', async () => {
    const pathRuntime = system('0.1.0', 'path')
    const boundary = adapter({
      candidates: [pathRuntime],
      compatible: { [pathRuntime.executable]: false },
    })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(bundled)
    expect(plan.notices.join('\n')).toContain('probe rejected 0.1.0')
  })

  it('falls back to the pinned bundled runtime when discovery throws', async () => {
    const boundary = adapter()
    vi.mocked(boundary.discoverExternalRuntimes)
      .mockRejectedValueOnce(new Error('PATH inspection failed'))

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(bundled)
    expect(plan.notices.join('\n')).toContain('PATH inspection failed')
  })

  it('continues to the next candidate when a compatibility probe throws', async () => {
    const first = system('0.1.0-rc.8', 'home', 'first')
    const second = system('0.1.0', 'path', 'second')
    const boundary = adapter({ candidates: [first, second] })
    vi.mocked(boundary.probeRuntime)
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce({ compatible: true })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(second)
    expect(plan.notices.join('\n')).toContain('cleanup failed')
  })

  it('fails deterministically in system mode when no external runtime qualifies', async () => {
    const boundary = adapter({
      candidates: [system('0.1.1', 'path')],
      diagnostics: ['ignored malformed dsh candidate'],
    })

    await expect(
      createLaunchPlanner(boundary).resolve(request({ runtimePreference: 'system' })),
    ).rejects.toThrow(/no compatible system DeepSeek Harness.*ignored malformed/u)
  })

  it('reports a discovery exception when forced system mode cannot continue', async () => {
    const boundary = adapter()
    vi.mocked(boundary.discoverExternalRuntimes)
      .mockRejectedValueOnce(new Error('home traversal failed'))

    await expect(
      createLaunchPlanner(boundary).resolve(request({ runtimePreference: 'system' })),
    ).rejects.toThrow(/no compatible system DeepSeek Harness.*home traversal failed/u)
  })

  it('does not discover or probe external runtimes in bundled mode', async () => {
    const boundary = adapter({ candidates: [system('0.1.0')] })

    const plan = await createLaunchPlanner(boundary).resolve(
      request({ runtimePreference: 'bundled' }),
    )

    expect(plan.runtime).toEqual(bundled)
    expect(boundary.discoverExternalRuntimes).not.toHaveBeenCalled()
    expect(boundary.probeRuntime).not.toHaveBeenCalled()
  })

  it('leaves an unowned legacy profile untouched and uses the namespaced profile', async () => {
    const boundary = adapter({ shared: home(unowned(), absent()) })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.home.kind).toBe('shared')
    expect(plan.profile).toEqual({ name: 'dsh-claude-tui', action: 'create' })
  })

  it('reconciles a valid launcher-managed legacy profile in place', async () => {
    const boundary = adapter({ shared: home(managed(), unowned()) })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.home.kind).toBe('shared')
    expect(plan.profile).toEqual({ name: 'claude-tui', action: 'reconcile' })
  })

  it('uses the bundled runtime and isolated home after an unsafe default-home conflict', async () => {
    const external = system('0.1.0', 'home')
    const boundary = adapter({
      shared: home(conflict('legacy marker is corrupt'), absent()),
      isolated: home(),
      candidates: [external],
    })

    const plan = await createLaunchPlanner(boundary).resolve(request())

    expect(plan.runtime).toEqual(bundled)
    expect(plan.home).toEqual({
      kind: 'isolated',
      path: '/home/user/.dsh-claude-tui',
      explicit: false,
    })
    expect(plan.profile).toEqual({ name: 'dsh-claude-tui', action: 'create' })
    expect(plan.notices.join('\n')).toContain('legacy marker is corrupt')
    expect(boundary.discoverExternalRuntimes).not.toHaveBeenCalled()
  })

  it('does not violate forced system mode by silently switching to bundled isolation', async () => {
    const boundary = adapter({
      shared: home(conflict('shared conflict'), absent()),
      isolated: home(),
      candidates: [system('0.1.0')],
    })

    await expect(createLaunchPlanner(boundary).resolve(request({
      runtimePreference: 'system',
    }))).rejects.toThrow(/system runtime mode.*shared conflict/u)
    expect(boundary.discoverExternalRuntimes).not.toHaveBeenCalled()
  })

  it('never replaces an explicit DSH_HOME after an unsafe profile conflict', async () => {
    const boundary = adapter({
      shared: home(absent(), conflict('namespaced marker is unsupported')),
    })

    await expect(createLaunchPlanner(boundary).resolve(request({ explicitHome: true })))
      .rejects.toThrow(/explicit DSH_HOME.*namespaced marker is unsupported/u)
    expect(boundary.inspectHome).toHaveBeenCalledTimes(1)
  })

  it('does not recursively fall back when the isolated home is also unsafe', async () => {
    const boundary = adapter({
      shared: home(conflict('shared conflict'), absent()),
      isolated: home(absent(), unowned()),
    })

    await expect(createLaunchPlanner(boundary).resolve(request()))
      .rejects.toThrow(/isolated DSH_HOME.*already exists but is not launcher-managed/u)
    expect(boundary.inspectHome).toHaveBeenCalledTimes(2)
  })
})
