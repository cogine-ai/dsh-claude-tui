import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  LEGACY_PROFILE_NAME,
  PROFILE_NAME,
  type HomeAssessment,
  type LaunchPlan,
  type ProfileAssessment,
} from './launch-plan.ts'

const BASE_BUNDLE = '@deepseek-ai/dsh-base'
const TUI_BUNDLE = 'dsh-claude-tui'
export const MANAGED_STATE_FILENAME = '.dsh-claude-tui-managed.json'
const PROFILE_PATCH = `# User patch layer for the launcher-managed dsh-claude-tui profile.
# This file is never rewritten by dsh-claude-tui after first-run creation.
[]
`
const PROFILE_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

interface PackageManifest {
  dsh?: { profile?: { bundles?: unknown } }
  [key: string]: unknown
}

interface ManagedState {
  schemaVersion: 1
  package: typeof TUI_BUNDLE
  profile: typeof LEGACY_PROFILE_NAME | typeof PROFILE_NAME
  version: string
}

export interface PackageIdentity {
  root: string
  version: string
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function readJson(path: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} at ${path} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function inspectProfile(
  profileDirectory: string,
  profileName: ManagedState['profile'],
): ProfileAssessment {
  try {
    if (!pathEntryExists(profileDirectory)) return { kind: 'absent' }
    const directoryStat = lstatSync(profileDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return { kind: 'unowned' }
    }
    const statePath = join(profileDirectory, MANAGED_STATE_FILENAME)
    if (!pathEntryExists(statePath)) return { kind: 'unowned' }

    const stateStat = lstatSync(statePath)
    if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
      throw new Error(`managed state ${statePath} must be a regular file`)
    }
    const state = readJson(statePath, 'managed state')
    if (
      state.schemaVersion !== 1
      || state.package !== TUI_BUNDLE
      || state.profile !== profileName
      || typeof state.version !== 'string'
      || state.version.trim() === ''
    ) {
      throw new Error(
        `managed state ${statePath} is not a supported ${TUI_BUNDLE} marker for ${profileName}`,
      )
    }

    const manifestPath = join(profileDirectory, 'package.json')
    if (!pathEntryExists(manifestPath)) {
      throw new Error(`managed profile is missing ${manifestPath}`)
    }
    const manifestStat = lstatSync(manifestPath)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error(`profile manifest ${manifestPath} must be a regular file`)
    }
    const manifest = readJson(manifestPath, 'profile manifest') as PackageManifest
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) {
      throw new Error(`profile manifest ${manifestPath} must declare dsh.profile.bundles as strings`)
    }
    if (!bundles.includes(BASE_BUNDLE)) {
      throw new Error(`managed profile ${manifestPath} no longer contains ${BASE_BUNDLE}`)
    }

    const patchPath = join(profileDirectory, 'cordis.patch.yml')
    if (!pathEntryExists(patchPath)) {
      throw new Error(`managed profile is missing ${patchPath}`)
    }
    const patchStat = lstatSync(patchPath)
    if (!patchStat.isFile() || patchStat.isSymbolicLink()) {
      throw new Error(`profile patch ${patchPath} must be a regular file`)
    }

    const modulesDirectory = join(profileDirectory, 'node_modules')
    if (pathEntryExists(modulesDirectory)) {
      const modulesStat = lstatSync(modulesDirectory)
      if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
        throw new Error(`profile modules path ${modulesDirectory} must be a real directory`)
      }
      const bundleLink = join(modulesDirectory, TUI_BUNDLE)
      if (pathEntryExists(bundleLink)) {
        const linkStat = lstatSync(bundleLink)
        if (!linkStat.isSymbolicLink()) {
          throw new Error(`launcher-owned bundle path ${bundleLink} is not a symlink`)
        }
      }
    }
    return { kind: 'managed' }
  } catch (error) {
    return {
      kind: 'conflict',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Inspect both launcher profile names without changing the selected DSH home. */
export function inspectManagedProfiles(home: string): HomeAssessment {
  const profiles = join(home, 'profiles')
  return {
    legacy: inspectProfile(join(profiles, LEGACY_PROFILE_NAME), LEGACY_PROFILE_NAME),
    namespaced: inspectProfile(join(profiles, PROFILE_NAME), PROFILE_NAME),
  }
}

function writeTextAtomic(path: string, content: string, mode: number): void {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' })
    chmodSync(temporaryPath, mode & 0o777)
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function createBundleLink(link: string, packageRoot: string): void {
  symlinkSync(packageRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
}

function createManagedProfile(
  profileDirectory: string,
  profileName: ManagedState['profile'],
  identity: PackageIdentity,
): void {
  const profilesDirectory = dirname(profileDirectory)
  mkdirSync(profilesDirectory, { recursive: true })
  const stagingDirectory = mkdtempSync(
    join(profilesDirectory, `.${profileName}-${randomUUID()}-`),
  )
  try {
    const manifest: PackageManifest = {
      name: `dsh-profile-${profileName}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [BASE_BUNDLE, TUI_BUNDLE] } },
    }
    writeFileSync(
      join(stagingDirectory, 'package.json'),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
    )
    writeFileSync(join(stagingDirectory, 'cordis.patch.yml'), PROFILE_PATCH)
    writeFileSync(join(stagingDirectory, 'pnpm-workspace.yaml'), PROFILE_WORKSPACE)
    const modulesDirectory = join(stagingDirectory, 'node_modules')
    mkdirSync(modulesDirectory)
    createBundleLink(join(modulesDirectory, TUI_BUNDLE), identity.root)
    const state: ManagedState = {
      schemaVersion: 1,
      package: TUI_BUNDLE,
      profile: profileName,
      version: identity.version,
    }
    writeFileSync(
      join(stagingDirectory, MANAGED_STATE_FILENAME),
      `${JSON.stringify(state, undefined, 2)}\n`,
    )
    renameSync(stagingDirectory, profileDirectory)
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error(
        `profile ${profileDirectory} appeared during setup; rerun after the other launcher exits`,
      )
    }
    throw error
  }
}

function reconcileManagedProfile(
  profileDirectory: string,
  profileName: ManagedState['profile'],
  identity: PackageIdentity,
): void {
  const directoryStat = lstatSync(profileDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`managed profile path ${profileDirectory} must be a real directory`)
  }

  const statePath = join(profileDirectory, MANAGED_STATE_FILENAME)
  const stateStat = lstatSync(statePath)
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
    throw new Error(`managed state ${statePath} must be a regular file`)
  }
  const state = readJson(statePath, 'managed state')
  if (
    state.schemaVersion !== 1
    || state.package !== TUI_BUNDLE
    || state.profile !== profileName
  ) {
    throw new Error(
      `managed state ${statePath} is not a supported ${TUI_BUNDLE} marker for ${profileName}`,
    )
  }

  const manifestPath = join(profileDirectory, 'package.json')
  if (!pathEntryExists(manifestPath)) {
    throw new Error(`managed profile is missing ${manifestPath}; refusing to reconstruct user state`)
  }
  const manifestStat = lstatSync(manifestPath)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`profile manifest ${manifestPath} must be a regular file`)
  }
  const manifest = readJson(manifestPath, 'profile manifest') as PackageManifest
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`profile manifest ${manifestPath} must declare dsh.profile.bundles as strings`)
  }
  if (!bundles.includes(BASE_BUNDLE)) {
    throw new Error(
      `managed profile ${manifestPath} no longer contains ${BASE_BUNDLE}; refusing to guess the user's composition`,
    )
  }

  const modulesDirectory = join(profileDirectory, 'node_modules')
  if (pathEntryExists(modulesDirectory)) {
    const modulesStat = lstatSync(modulesDirectory)
    if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
      throw new Error(`profile modules path ${modulesDirectory} must be a real directory`)
    }
  }
  const bundleLink = join(modulesDirectory, TUI_BUNDLE)
  let staleBundleLink = false
  try {
    const linkStat = lstatSync(bundleLink)
    if (!linkStat.isSymbolicLink()) {
      throw new Error(
        `launcher-owned bundle path ${bundleLink} is not a symlink; refusing to overwrite it`,
      )
    }
    const linkTarget = resolve(dirname(bundleLink), readlinkSync(bundleLink))
    staleBundleLink = realpathSync(linkTarget) !== realpathSync(identity.root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    staleBundleLink = true
  }

  let seen = false
  const reconciledBundles = bundles.filter((bundle) => {
    if (bundle !== TUI_BUNDLE) return true
    if (seen) return false
    seen = true
    return true
  })
  if (!seen) reconciledBundles.push(TUI_BUNDLE)
  if (reconciledBundles.length !== bundles.length || !seen) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: reconciledBundles },
    }
    writeTextAtomic(
      manifestPath,
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      manifestStat.mode,
    )
  }

  if (staleBundleLink) {
    mkdirSync(modulesDirectory, { recursive: true })
    try {
      unlinkSync(bundleLink)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    createBundleLink(bundleLink, identity.root)
  }
  if (state.version !== identity.version) {
    const reconciledState: ManagedState = {
      schemaVersion: 1,
      package: TUI_BUNDLE,
      profile: profileName,
      version: identity.version,
    }
    writeTextAtomic(
      statePath,
      `${JSON.stringify(reconciledState, undefined, 2)}\n`,
      stateStat.mode,
    )
  }
}

/** Apply a previously resolved profile action with a fresh ownership check. */
export function ensureManagedProfile(
  home: string,
  profile: LaunchPlan['profile'],
  identity: PackageIdentity,
): void {
  const profileDirectory = join(home, 'profiles', profile.name)
  const current = inspectProfile(profileDirectory, profile.name)
  if (profile.action === 'create') {
    if (current.kind !== 'absent') {
      throw new Error(
        `profile ${profileDirectory} is not absent (${current.kind}); refusing a stale create plan`,
      )
    }
    createManagedProfile(profileDirectory, profile.name, identity)
    return
  }
  if (current.kind !== 'managed') {
    const reason = current.kind === 'conflict' ? `: ${current.reason}` : ''
    throw new Error(
      `profile ${profileDirectory} is no longer launcher-managed (${current.kind}${reason})`,
    )
  }
  reconcileManagedProfile(profileDirectory, profile.name, identity)
}
