import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

import {
  assertLivePaperAcknowledgement,
  livePaperExcludes,
  livePaperIncludes,
} from './scripts/test-lanes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

assertLivePaperAcknowledgement()

// Live-paper acceptance deliberately does not load vitest.setup.ts because it
// must resolve the verified demo/paper accounts from the real local config.

const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/guardian-runtime': resolve(__dirname, './packages/guardian-runtime/src/index.ts'),
  '@traderalice/connector-protocol': resolve(__dirname, './packages/connector-protocol/src/index.ts'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: livePaperIncludes,
    exclude: livePaperExcludes,
    testTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
    env: {
      CCXT_INIT_RETRIES: '2',
      CCXT_INIT_RETRY_BASE_MS: '250',
    },
  },
}
