/** Security fixes and MCP compatibility in the workspace dependency graph. */
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { verifyMcpCompatibility } from './mcp-compat.ts'
import { verifySecurityDependencies } from './security-dependency-checks.ts'

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))

describe('workspace dependency security and compatibility', () => {
  it('loads patched native image, Office ZIP, and URI parsers through their DSH owners', async () => {
    await verifySecurityDependencies(packageJsonPath)
  }, 40_000)

  it('preserves DSH 0.2.1-rc.2 MCP behavior with the official SDK', async () => {
    await verifyMcpCompatibility(packageJsonPath)
  }, 40_000)
})
