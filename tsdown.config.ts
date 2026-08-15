import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts', 'src/cli.ts'],
  outDir: 'lib',
  format: 'esm',
  outExtensions: () => ({ js: '.js' }),
  dts: true,
  sourcemap: true,
  clean: true,
  deps: {
    alwaysBundle: [/^semver(?:\/|$)/],
    onlyBundle: [/^semver(?:\/|$)/],
    neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//, 'commander'],
  },
})
