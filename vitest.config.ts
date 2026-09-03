import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const workspaceGlob = (pattern: string): string => (
  resolve(__dirname, pattern).replaceAll('\\', '/')
)

export const collectionWideTestInputs = [
  workspaceGlob('**/package.json'),
  workspaceGlob('**/{vitest,vite}.config.*'),
]

// Workspace packages are aliased directly to their `src/*.ts` entry points so
// vitest doesn't need them pre-built into `dist/`. Vite's import-analysis
// resolver ignores `resolve.conditions` for npm packages (the deps optimizer
// path), so a literal alias is the reliable mechanism. tsx for backend dev
// gets the same effect via NODE_OPTIONS=--conditions=source (see scripts/guardian/dev.ts).
const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/guardian-runtime': resolve(__dirname, './packages/guardian-runtime/src/index.ts'),
  '@traderalice/connector-protocol': resolve(__dirname, './packages/connector-protocol/src/index.ts'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
}

const uiAliases = {
  ...workspaceAliases,
  '@': resolve(__dirname, './ui/src'),
}

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    // Vitest's affected-test lane follows static imports, but collection-wide
    // inputs must invalidate every project. Vitest compares changed files as
    // absolute paths, so relative defaults do not match this workspace; keep
    // absolute, slash-normalized globs explicit for every platform.
    forceRerunTriggers: collectionWideTestInputs,
    // The Node suite includes installer, PTY, and Guardian specs that spawn
    // their own process trees. CPU-relative worker counts scale the contention
    // back up on larger development hosts and turn fast installer checks into
    // timeout flakes. Keep this deterministic across laptops and CI: two
    // workers retain useful parallelism while leaving capacity for child
    // processes owned by each worker.
    maxWorkers: 2,
    projects: [
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.spec.*', 'packages/**/*.spec.*', 'services/**/*.spec.*', 'apps/**/*.spec.*', 'scripts/**/*.spec.*'],
          exclude: [
            '**/*.e2e.spec.*',
            '**/*.bbProvider.spec.*',
            '**/*.live.spec.*',
            '**/node_modules/**',
          ],
        },
      },
      {
        resolve: {
          alias: uiAliases,
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['ui/**/*.spec.*'],
        },
      },
    ],
  },
})
