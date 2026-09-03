import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

import { externalReadonlyIncludes } from './scripts/test-lanes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/guardian-runtime': resolve(__dirname, './packages/guardian-runtime/src/index.ts'),
  '@traderalice/connector-protocol': resolve(__dirname, './packages/connector-protocol/src/index.ts'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

// Explicit read-only integration lane. These tests may contact public providers,
// a locally running TWS/Gateway, or APIs backed by keys in the local OpenAlice
// config, but they never submit broker orders.
export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: externalReadonlyIncludes,
    testTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
    env: {
      CCXT_E2E: '1',
      TWSE_LIVE: '1',
      CCXT_INIT_RETRIES: '2',
      CCXT_INIT_RETRY_BASE_MS: '250',
    },
  },
}
