import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_PROFILE_NAME, PROFILE_NAME } from '../src/launch-plan.ts'
import {
  MANAGED_STATE_FILENAME,
  ensureManagedProfile,
  inspectManagedProfiles,
  type PackageIdentity,
} from '../src/managed-profile.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-managed-profile-'))
  temporaryDirectories.push(path)
  return path
}

function identity(root: string, version = '0.1.0'): PackageIdentity {
  mkdirSync(root, { recursive: true })
  return { root, version }
}

function profilePath(home: string, name: string): string {
  return join(home, 'profiles', name)
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('launcher-managed profiles', () => {
  it('distinguishes an unowned legacy profile from an available namespaced profile', () => {
    const home = temporaryDirectory()
    const legacy = profilePath(home, LEGACY_PROFILE_NAME)
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'package.json'), '{"name":"user-profile"}\n')

    expect(inspectManagedProfiles(home)).toEqual({
      legacy: { kind: 'unowned' },
      namespaced: { kind: 'absent' },
    })
  })

  it('treats a corrupt launcher marker as a hard conflict', () => {
    const home = temporaryDirectory()
    const legacy = profilePath(home, LEGACY_PROFILE_NAME)
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, MANAGED_STATE_FILENAME), '{broken')

    const assessment = inspectManagedProfiles(home)

    expect(assessment.legacy.kind).toBe('conflict')
    expect(assessment.legacy).toEqual({
      kind: 'conflict',
      reason: expect.stringContaining('cannot read managed state'),
    })
  })

  it('creates the namespaced profile without changing an unowned legacy profile', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const legacy = profilePath(home, LEGACY_PROFILE_NAME)
    mkdirSync(legacy, { recursive: true })
    const original = '{\n  "name": "user-owned-profile",\n  "keep": true\n}\n'
    writeFileSync(join(legacy, 'package.json'), original)
    const packageIdentity = identity(join(root, 'package'))

    ensureManagedProfile(
      home,
      { name: PROFILE_NAME, action: 'create' },
      packageIdentity,
    )

    expect(readFileSync(join(legacy, 'package.json'), 'utf8')).toBe(original)
    const namespaced = profilePath(home, PROFILE_NAME)
    expect(JSON.parse(readFileSync(join(namespaced, MANAGED_STATE_FILENAME), 'utf8')))
      .toEqual({
        schemaVersion: 1,
        package: 'dsh-claude-tui',
        profile: PROFILE_NAME,
        version: '0.1.0',
      })
    expect(resolve(
      dirname(join(namespaced, 'node_modules/dsh-claude-tui')),
      readlinkSync(join(namespaced, 'node_modules/dsh-claude-tui')),
    )).toBe(packageIdentity.root)
  })

  it('recognizes and reconciles a valid legacy launcher-managed profile', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const firstIdentity = identity(join(root, 'package-v1'), '0.1.0')
    ensureManagedProfile(
      home,
      { name: LEGACY_PROFILE_NAME, action: 'create' },
      firstIdentity,
    )
    const legacy = profilePath(home, LEGACY_PROFILE_NAME)
    const patchPath = join(legacy, 'cordis.patch.yml')
    writeFileSync(patchPath, '# user customization\n[]\n')
    const secondIdentity = identity(join(root, 'package-v2'), '0.1.1')

    expect(inspectManagedProfiles(home).legacy).toEqual({ kind: 'managed' })
    ensureManagedProfile(
      home,
      { name: LEGACY_PROFILE_NAME, action: 'reconcile' },
      secondIdentity,
    )

    expect(readFileSync(patchPath, 'utf8')).toBe('# user customization\n[]\n')
    expect(JSON.parse(readFileSync(join(legacy, MANAGED_STATE_FILENAME), 'utf8')))
      .toMatchObject({ profile: LEGACY_PROFILE_NAME, version: '0.1.1' })
    expect(resolve(
      dirname(join(legacy, 'node_modules/dsh-claude-tui')),
      readlinkSync(join(legacy, 'node_modules/dsh-claude-tui')),
    )).toBe(secondIdentity.root)
  })

  it('refuses a stale create plan instead of adopting a profile that appeared later', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const namespaced = profilePath(home, PROFILE_NAME)
    mkdirSync(namespaced, { recursive: true })
    writeFileSync(join(namespaced, 'package.json'), '{"name":"racing-user"}\n')

    expect(() => ensureManagedProfile(
      home,
      { name: PROFILE_NAME, action: 'create' },
      identity(join(root, 'package')),
    )).toThrow(/appeared during setup|not absent/u)
    expect(existsSync(join(namespaced, MANAGED_STATE_FILENAME))).toBe(false)
  })

  it('refuses to replace a launcher-owned bundle path that became a regular file', () => {
    const root = temporaryDirectory()
    const home = join(root, 'home')
    const packageIdentity = identity(join(root, 'package'))
    ensureManagedProfile(
      home,
      { name: PROFILE_NAME, action: 'create' },
      packageIdentity,
    )
    const bundle = join(profilePath(home, PROFILE_NAME), 'node_modules/dsh-claude-tui')
    unlinkSync(bundle)
    writeFileSync(bundle, 'user data')

    expect(inspectManagedProfiles(home).namespaced).toEqual({
      kind: 'conflict',
      reason: expect.stringContaining('not a symlink'),
    })
    expect(() => ensureManagedProfile(
      home,
      { name: PROFILE_NAME, action: 'reconcile' },
      packageIdentity,
    )).toThrow(/not a symlink/u)
    expect(lstatSync(bundle).isFile()).toBe(true)
    expect(readFileSync(bundle, 'utf8')).toBe('user data')
  })
})
