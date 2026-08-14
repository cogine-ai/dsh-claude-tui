/** Bounded local-workspace discovery for Claude-like file mentions. */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** One displayable path relative to the active Session workspace. */
export interface WorkspaceEntry {
  path: string
  directory: boolean
}

/** Filesystem boundary injected into the terminal application. */
export type ListWorkspaceEntries = (
  cwd: string,
  signal: AbortSignal,
) => Promise<readonly WorkspaceEntry[]>

const MAX_ENTRIES = 5_000
const MAX_DEPTH = 6
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  'coverage',
  'dist',
  'lib',
  'node_modules',
])

/** Discover a stable, bounded set without following directory symlinks. */
export const listLocalWorkspaceEntries: ListWorkspaceEntries = async (cwd, signal) => {
  const found: WorkspaceEntry[] = []
  const pending: Array<{ absolute: string; relative: string; depth: number }> = [
    { absolute: cwd, relative: '', depth: 0 },
  ]
  while (pending.length > 0 && found.length < MAX_ENTRIES) {
    signal.throwIfAborted()
    const current = pending.shift()
    if (current === undefined) break
    let children
    try {
      children = await readdir(current.absolute, { withFileTypes: true })
    } catch (error: unknown) {
      if (current.depth === 0) throw error
      continue
    }
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      signal.throwIfAborted()
      if (found.length >= MAX_ENTRIES) break
      const relative = current.relative === '' ? child.name : `${current.relative}/${child.name}`
      const directory = child.isDirectory()
      found.push({ path: relative, directory })
      if (directory && current.depth < MAX_DEPTH && !SKIPPED_DIRECTORIES.has(child.name)) {
        pending.push({ absolute: join(current.absolute, child.name), relative, depth: current.depth + 1 })
      }
    }
  }
  return found.sort(compareEntries)
}

/** Prefer useful root files, then shallow paths, while remaining deterministic. */
function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  const leftParts = left.path.split('/').length
  const rightParts = right.path.split('/').length
  if (leftParts !== rightParts) return leftParts - rightParts
  const leftReadme = /^README(?:\.|$)/iu.test(left.path) ? 0 : 1
  const rightReadme = /^README(?:\.|$)/iu.test(right.path) ? 0 : 1
  if (leftReadme !== rightReadme) return leftReadme - rightReadme
  if (left.directory !== right.directory) return left.directory ? 1 : -1
  return left.path.localeCompare(right.path)
}
