import satisfies from 'semver/functions/satisfies.js'

export const EXTERNAL_DSH_RANGE = '>=0.1.0-rc.8 <0.1.1'
export const LEGACY_PROFILE_NAME = 'claude-tui'
export const PROFILE_NAME = 'dsh-claude-tui'

export type RuntimePreference = 'auto' | 'system' | 'bundled'
export type RuntimeSource = 'home' | 'path' | 'bundled'

export interface DshRuntime {
  kind: 'system' | 'bundled'
  source: RuntimeSource
  version: string
  packageRoot: string
  executable: string
}

export type ProfileAssessment =
  | { kind: 'absent' }
  | { kind: 'managed' }
  | { kind: 'unowned' }
  | { kind: 'conflict'; reason: string }

export interface HomeAssessment {
  legacy: ProfileAssessment
  namespaced: ProfileAssessment
}

export interface RuntimeDiscovery {
  runtimes: readonly DshRuntime[]
  diagnostics: readonly string[]
}

export type RuntimeProbe =
  | { compatible: true }
  | { compatible: false; reason: string }

export interface LaunchPlannerAdapter {
  inspectHome(path: string): HomeAssessment
  discoverExternalRuntimes(home: string): Promise<RuntimeDiscovery>
  bundledRuntime(): DshRuntime
  probeRuntime(runtime: DshRuntime): Promise<RuntimeProbe>
}

export interface LaunchRequest {
  runtimePreference: RuntimePreference
  sharedHome: string
  isolatedHome: string
  explicitHome: boolean
}

export interface LaunchPlan {
  runtime: DshRuntime
  home: {
    kind: 'shared' | 'isolated'
    path: string
    explicit: boolean
  }
  profile: {
    name: typeof LEGACY_PROFILE_NAME | typeof PROFILE_NAME
    action: 'create' | 'reconcile'
  }
  notices: string[]
}

type ProfileChoice = LaunchPlan['profile'] | { unsafe: string }

/** Select one launcher-owned profile without adopting or overwriting user state. */
function chooseProfile(assessment: HomeAssessment): ProfileChoice {
  if (assessment.legacy.kind === 'managed') {
    return { name: LEGACY_PROFILE_NAME, action: 'reconcile' }
  }
  if (assessment.legacy.kind === 'conflict') {
    return { unsafe: `legacy ${LEGACY_PROFILE_NAME} profile: ${assessment.legacy.reason}` }
  }

  if (assessment.namespaced.kind === 'managed') {
    return { name: PROFILE_NAME, action: 'reconcile' }
  }
  if (assessment.namespaced.kind === 'absent') {
    return { name: PROFILE_NAME, action: 'create' }
  }
  if (assessment.namespaced.kind === 'unowned') {
    return {
      unsafe: `profile ${PROFILE_NAME} already exists but is not launcher-managed`,
    }
  }
  return { unsafe: `namespaced ${PROFILE_NAME} profile: ${assessment.namespaced.reason}` }
}

function isUnsafe(choice: ProfileChoice): choice is { unsafe: string } {
  return 'unsafe' in choice
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve the runtime after manifest/range checks and an isolated compatibility probe. */
async function chooseRuntime(
  adapter: LaunchPlannerAdapter,
  request: LaunchRequest,
  notices: string[],
): Promise<DshRuntime> {
  if (request.runtimePreference === 'bundled') return adapter.bundledRuntime()

  let discovery: RuntimeDiscovery
  try {
    discovery = await adapter.discoverExternalRuntimes(request.sharedHome)
  } catch (error) {
    notices.push(
      `Ignored external DeepSeek Harness discovery failure: ${errorMessage(error)}.`,
    )
    discovery = { runtimes: [], diagnostics: [] }
  }
  notices.push(...discovery.diagnostics)
  const seen = new Set<string>()
  for (const runtime of discovery.runtimes) {
    if (seen.has(runtime.executable)) continue
    seen.add(runtime.executable)
    if (!satisfies(runtime.version, EXTERNAL_DSH_RANGE)) {
      notices.push(
        `Ignored ${runtime.source} DeepSeek Harness ${runtime.version}; supported system range is ${EXTERNAL_DSH_RANGE}.`,
      )
      continue
    }
    try {
      const probe = await adapter.probeRuntime(runtime)
      if (probe.compatible) return runtime
      notices.push(`Ignored ${runtime.source} DeepSeek Harness ${runtime.version}: ${probe.reason}.`)
    } catch (error) {
      notices.push(
        `Ignored ${runtime.source} DeepSeek Harness ${runtime.version}: compatibility probe failed: ${errorMessage(error)}.`,
      )
    }
  }

  if (request.runtimePreference === 'system') {
    const details = notices.length === 0 ? '' : ` (${notices.join(' ')})`
    throw new Error(
      `no compatible system DeepSeek Harness found; expected ${EXTERNAL_DSH_RANGE}${details}`,
    )
  }
  return adapter.bundledRuntime()
}

export interface LaunchPlanner {
  resolve(request: LaunchRequest): Promise<LaunchPlan>
}

/** Build a complete, side-effect-free launch decision before touching a user DSH home. */
export function createLaunchPlanner(adapter: LaunchPlannerAdapter): LaunchPlanner {
  return {
    async resolve(request: LaunchRequest): Promise<LaunchPlan> {
      const sharedProfile = chooseProfile(adapter.inspectHome(request.sharedHome))
      if (isUnsafe(sharedProfile)) {
        if (request.explicitHome) {
          throw new Error(
            `explicit DSH_HOME ${request.sharedHome} is unsafe: ${sharedProfile.unsafe}`,
          )
        }
        if (request.runtimePreference === 'system') {
          throw new Error(
            `system runtime mode cannot switch to bundled isolated state: ${sharedProfile.unsafe}`,
          )
        }

        const isolatedProfile = chooseProfile(adapter.inspectHome(request.isolatedHome))
        if (isUnsafe(isolatedProfile)) {
          throw new Error(
            `isolated DSH_HOME ${request.isolatedHome} is unsafe: ${isolatedProfile.unsafe}`,
          )
        }
        const notices = [
          `Using isolated DSH_HOME ${request.isolatedHome} because ${sharedProfile.unsafe}.`,
          'Existing DeepSeek Harness sessions and credentials remain in the shared DSH_HOME and were not copied.',
        ]
        return {
          runtime: adapter.bundledRuntime(),
          home: { kind: 'isolated', path: request.isolatedHome, explicit: false },
          profile: isolatedProfile,
          notices,
        }
      }

      const notices: string[] = []
      const runtime = await chooseRuntime(adapter, request, notices)
      return {
        runtime,
        home: { kind: 'shared', path: request.sharedHome, explicit: request.explicitHome },
        profile: sharedProfile,
        notices,
      }
    },
  }
}
