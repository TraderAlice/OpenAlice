import { collectionWideTestInputs } from './scripts/test-collection-inputs.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

import { integrationIncludes } from './scripts/test-lanes.mjs'

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

// Deterministic local integration only; these are not end-to-end app journeys. Public providers and local
// credentials belong to vitest.external.config.ts; tests that submit orders
// belong to vitest.uta-live.config.ts.
export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    forceRerunTriggers: collectionWideTestInputs(__dirname),
    include: integrationIncludes,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
  },
}
