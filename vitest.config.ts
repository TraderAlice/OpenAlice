import { defineConfig } from 'vitest/config'
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
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/opentypebb/server': resolve(__dirname, './packages/opentypebb/src/server.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
}

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
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
          exclude: ['**/*.e2e.spec.*', '**/*.bbProvider.spec.*', '**/node_modules/**'],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./ui/src/test/setup-localstorage.ts'],
          include: ['ui/**/*.spec.*'],
        },
      },
    ],
  },
})
