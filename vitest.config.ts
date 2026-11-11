import { defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Workspace packages are aliased directly to their `src/*.ts` entry points so
// vitest doesn't need them pre-built into `dist/`. Vite's import-analysis
// resolver ignores `resolve.conditions` for npm packages (the deps optimizer
// path), so a literal alias is the reliable mechanism. tsx for backend dev
// gets the same effect via NODE_OPTIONS=--conditions=source (see scripts/guardian/dev.ts).
const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/update-lifecycle/node': resolve(__dirname, './packages/update-lifecycle/src/node.ts'),
  '@traderalice/update-lifecycle': resolve(__dirname, './packages/update-lifecycle/src/index.ts'),
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
    maxWorkers: process.env.CI ? 2 : undefined,
    projects: [
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.spec.*', 'packages/**/*.spec.*', 'services/**/*.spec.*', 'apps/**/*.spec.*'],
          exclude: [
            '**/*.e2e.spec.*',
            '**/*.bbProvider.spec.*',
            '**/*.live.spec.*',
            '**/node_modules/**',
            'apps/landing/**',
          ],
        },
      },
      {
        esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
        resolve: {
          alias: uiAliases,
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          execArgv: ['--no-experimental-webstorage'],
          setupFiles: ['./vitest.setup.ts'],
          include: ['ui/**/*.spec.*'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
})
