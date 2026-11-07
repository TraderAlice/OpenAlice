import { defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Match vitest.config.ts — workspace packages alias directly to src/*.ts so
// integration tests don't need packages/*/dist pre-built.
const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/guardian-runtime': resolve(__dirname, './packages/guardian-runtime/src/index.ts'),
  '@traderalice/connector-protocol': resolve(__dirname, './packages/connector-protocol/src/index.ts'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
  '@traderalice/update-lifecycle/node': resolve(__dirname, './packages/update-lifecycle/src/node.ts'),
  '@traderalice/update-lifecycle': resolve(__dirname, './packages/update-lifecycle/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

const uiAliases = {
  ...workspaceAliases,
  '@': resolve(__dirname, './ui/src'),
}

// Deterministic local integration only; these are not end-to-end app journeys. Public providers and local
// credentials belong to vitest.external.config.ts; tests that submit orders
// belong to vitest.uta-live.config.ts.
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    testTimeout: 60_000,
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
          include: ['tests/integration/**/*.spec.{ts,mjs,js}', 'tests/e2e/**/*.spec.{ts,mjs,js}'],
          exclude: [
            'tests/integration/{broker-market-data,hyperliquid-market-data,ibkr-wire-readonly,market-data-providers,market-data-routes,twse-provider,broker-alpaca-paper,broker-bybit-paper,broker-hyperliquid-paper,broker-ibkr-paper,broker-okx-paper,ibkr-wire-paper,bybit-diagnostic}/**',
            '**/node_modules/**',
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
          include: ['tests/integration/**/*.spec.tsx', 'tests/e2e/**/*.spec.tsx'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
})
