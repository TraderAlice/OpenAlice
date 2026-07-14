import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Match vitest.config.ts — workspace packages alias directly to src/*.ts so
// e2e tests don't need packages/*/dist pre-built.
const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

// Safe product/integration E2E only. Tests that submit orders to configured
// demo/paper accounts live in vitest.uta-live.config.ts and require an explicit
// OPENALICE_UTA_LIVE_PAPER=1 acknowledgement.
export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: [
      'src/**/*.e2e.spec.*',
      'services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.e2e.spec.ts',
      'services/uta/src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts',
      'services/uta/src/domain/trading/__test__/e2e/ccxt-hyperliquid-markets.e2e.spec.ts',
    ],
    testTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
    // Cap CCXT init retries during e2e — production defaults (8 retries with
    // exponential backoff) burn ~140s per market type when a testnet is
    // unreachable, blocking the entire serial setup. 2 retries × 250ms base
    // bounds a failing init's backoff to under a second (the bulk of the time
    // is still the underlying CCXT HTTP timeouts, which setup.ts caps with
    // its own 30s per-broker race).
    env: {
      CCXT_INIT_RETRIES: '2',
      CCXT_INIT_RETRY_BASE_MS: '250',
    },
  },
}
