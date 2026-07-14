import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (process.env.OPENALICE_UTA_LIVE_PAPER !== '1') {
  throw new Error([
    'UTA live-paper tests submit real orders to configured demo/paper accounts.',
    'Run only after verifying those accounts, then acknowledge with:',
    'OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper',
  ].join('\n'))
}

const workspaceAliases = {
  '@': resolve(__dirname, './src'),
  '@traderalice/ibkr': resolve(__dirname, './packages/ibkr/src/index.ts'),
  '@traderalice/uta-protocol': resolve(__dirname, './packages/uta-protocol/src/index.ts'),
  '@traderalice/opentypebb': resolve(__dirname, './packages/opentypebb/src/index.ts'),
}

export default {
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['services/uta/src/domain/trading/__test__/e2e/*.e2e.spec.ts'],
    exclude: [
      'services/uta/src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts',
      'services/uta/src/domain/trading/__test__/e2e/ccxt-hyperliquid-markets.e2e.spec.ts',
    ],
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
