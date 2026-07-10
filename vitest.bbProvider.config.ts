import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Match vitest.config.ts — workspace packages alias directly to src/*.ts so
// these tests don't need packages/*/dist pre-built.
const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['src/**/*.bbProvider.spec.*'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
}
