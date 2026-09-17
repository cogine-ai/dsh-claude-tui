/** Node invocation and environment defaults shared by the launcher and probe. */
const EXPLICIT_CLI_ENTRY = `
import { pathToFileURL } from 'node:url'
const cli = await import(pathToFileURL(process.argv[1]).href)
if (typeof cli.runCli === 'function') await cli.runCli()
`

/** Keep argv and the process boundary identical to a direct file invocation. */
export function harnessNodeArgs(
  executable: string,
  args: readonly string[],
  nodeVersion = process.versions.node,
): string[] {
  if (!/^24\.[01]\./u.test(nodeVersion)) return [executable, ...args]
  // DSH 0.1.5 guards its entry with import.meta.main (Node 24.2+/22.18+).
  // Imported guarded CLIs need explicit dispatch; self-starting CLIs already ran.
  return ['--input-type=module', '--eval', EXPLICIT_CLI_ENTRY, '--', executable, ...args]
}

/** Avoid native macOS watcher shutdown deadlocks without disabling live updates. */
export function harnessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return { ...environment }
  return {
    ...environment,
    CHOKIDAR_USEPOLLING: environment.CHOKIDAR_USEPOLLING ?? 'true',
    CHOKIDAR_INTERVAL: environment.CHOKIDAR_INTERVAL ?? '1000',
  }
}
