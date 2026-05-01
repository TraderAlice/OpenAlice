/**
 * Generator for parity/fixtures/legacy-paths/.
 *
 * Emits three GitExportState files matching the legacy on-disk layout
 * read by `git-persistence.ts:18-22`:
 *   - bybit-main/crypto-trading_commit.json   → legacy: data/crypto-trading/commit.json
 *   - alpaca-paper/securities-trading_commit.json → legacy: data/securities-trading/commit.json
 *   - alpaca-live/securities-trading_commit.json  → legacy: data/securities-trading/commit.json
 *
 * Loader test (parity/load-legacy.ts) copies these into a tmp dir and
 * verifies that loadGitState() finds them via the legacy fallback.
 *
 * Usage:
 *   pnpm tsx parity/scripts/gen-legacy-paths.ts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../fixtures/legacy-paths')

// ==================== Fixture builders ====================

interface LegacyCommit {
  hash: string
  parentHash: string | null
  message: string
  operations: unknown[]
  results: unknown[]
  stateAfter: {
    netLiquidation: string
    totalCashValue: string
    unrealizedPnL: string
    realizedPnL: string
    positions: unknown[]
    pendingOrders: unknown[]
  }
  timestamp: string
  // Phase 2+ adds hashVersion/intentFullHash; legacy v1 fixtures omit them.
}

interface LegacyExport {
  head: string
  commits: LegacyCommit[]
}

// Bybit fixture — sub-satoshi qty + USDT pricing
const BYBIT: LegacyExport = {
  head: 'aaaa1111',
  commits: [
    {
      hash: 'aaaa1111',
      parentHash: null,
      message: 'BTC swing entry — sub-satoshi BUY MKT',
      operations: [
        {
          action: 'placeOrder',
          contract: {
            aliceId: 'bybit-main|BTC/USDT',
            symbol: 'BTC/USDT',
            secType: 'CRYPTO',
            currency: 'USDT',
            exchange: 'bybit',
          },
          order: {
            action: 'BUY',
            orderType: 'MKT',
            tif: 'GTC',
            // Legacy v1 stored Decimals as string — captured here verbatim.
            totalQuantity: '0.00012345',
          },
        },
      ],
      results: [
        {
          action: 'placeOrder',
          success: true,
          orderId: '1',
          status: 'filled',
          filledQty: '0.00012345',
          filledPrice: '67234.50',
        },
      ],
      stateAfter: {
        netLiquidation: '8.30307',
        totalCashValue: '0.00074',
        unrealizedPnL: '0',
        realizedPnL: '0',
        positions: [
          {
            accountId: 'bybit-main',
            symbol: 'BTC/USDT',
            quantity: '0.00012345',
            avgCost: '67234.50',
            marketPrice: '67234.50',
            marketValue: '8.30307',
            unrealizedPnL: '0',
          },
        ],
        pendingOrders: [],
      },
      timestamp: '2026-04-15T10:30:00.000Z',
    },
    {
      hash: 'bbbb2222',
      parentHash: 'aaaa1111',
      message: 'close BTC partial — realize tiny PnL',
      operations: [
        {
          action: 'closePosition',
          contract: {
            aliceId: 'bybit-main|BTC/USDT',
            symbol: 'BTC/USDT',
            secType: 'CRYPTO',
            currency: 'USDT',
            exchange: 'bybit',
          },
          quantity: '0.00006172',
        },
      ],
      results: [
        {
          action: 'closePosition',
          success: true,
          orderId: '2',
          status: 'filled',
          filledQty: '0.00006172',
          filledPrice: '67500.00',
        },
      ],
      stateAfter: {
        netLiquidation: '8.32',
        totalCashValue: '4.165',
        unrealizedPnL: '0.0163',
        realizedPnL: '0.01636',
        positions: [
          {
            accountId: 'bybit-main',
            symbol: 'BTC/USDT',
            quantity: '0.00006173',
            avgCost: '67234.50',
            marketPrice: '67500.00',
            marketValue: '4.165',
            unrealizedPnL: '0.0163',
          },
        ],
        pendingOrders: [],
      },
      timestamp: '2026-04-15T11:15:00.000Z',
    },
  ],
}

// Alpaca PAPER fixture — US equity, integer qty
const ALPACA_PAPER: LegacyExport = {
  head: 'cccc3333',
  commits: [
    {
      hash: 'cccc3333',
      parentHash: null,
      message: 'BUY 100 AAPL MKT (paper)',
      operations: [
        {
          action: 'placeOrder',
          contract: {
            aliceId: 'alpaca-paper|AAPL',
            symbol: 'AAPL',
            secType: 'STK',
            currency: 'USD',
            exchange: 'NASDAQ',
            primaryExchange: 'NASDAQ',
          },
          order: {
            action: 'BUY',
            orderType: 'MKT',
            tif: 'DAY',
            totalQuantity: '100',
          },
        },
      ],
      results: [
        {
          action: 'placeOrder',
          success: true,
          orderId: 'paper-1',
          status: 'filled',
          filledQty: '100',
          filledPrice: '180.50',
        },
      ],
      stateAfter: {
        netLiquidation: '99950',
        totalCashValue: '81900',
        unrealizedPnL: '0',
        realizedPnL: '0',
        positions: [
          {
            accountId: 'alpaca-paper',
            symbol: 'AAPL',
            quantity: '100',
            avgCost: '180.50',
            marketPrice: '180.50',
            marketValue: '18050',
            unrealizedPnL: '0',
          },
        ],
        pendingOrders: [],
      },
      timestamp: '2026-04-16T14:30:00.000Z',
    },
    {
      hash: 'dddd4444',
      parentHash: 'cccc3333',
      message: 'BUY 50 AAPL LMT @181 (paper)',
      operations: [
        {
          action: 'placeOrder',
          contract: {
            aliceId: 'alpaca-paper|AAPL',
            symbol: 'AAPL',
            secType: 'STK',
            currency: 'USD',
            exchange: 'NASDAQ',
            primaryExchange: 'NASDAQ',
          },
          order: {
            action: 'BUY',
            orderType: 'LMT',
            tif: 'GTC',
            totalQuantity: '50',
            lmtPrice: '181',
          },
        },
      ],
      results: [
        {
          action: 'placeOrder',
          success: true,
          orderId: 'paper-2',
          status: 'submitted',
        },
      ],
      stateAfter: {
        netLiquidation: '100050',
        totalCashValue: '72850',
        unrealizedPnL: '100',
        realizedPnL: '0',
        positions: [
          {
            accountId: 'alpaca-paper',
            symbol: 'AAPL',
            quantity: '100',
            avgCost: '180.50',
            marketPrice: '181.50',
            marketValue: '18150',
            unrealizedPnL: '100',
          },
        ],
        pendingOrders: [
          {
            accountId: 'alpaca-paper',
            orderId: 'paper-2',
            symbol: 'AAPL',
            action: 'BUY',
            orderType: 'LMT',
            totalQuantity: '50',
            lmtPrice: '181',
            status: 'submitted',
          },
        ],
      },
      timestamp: '2026-04-16T15:00:00.000Z',
    },
  ],
}

// Alpaca LIVE fixture — same legacy file path as paper, but commits are
// tagged with the 'alpaca-live' account id in operations. The loader
// test in load-legacy.ts proves both account ids resolve to the same
// physical legacy path (data/securities-trading/commit.json).
const ALPACA_LIVE: LegacyExport = {
  head: 'eeee5555',
  commits: [
    {
      hash: 'eeee5555',
      parentHash: null,
      message: 'BUY 100 AAPL MKT (LIVE)',
      operations: [
        {
          action: 'placeOrder',
          contract: {
            aliceId: 'alpaca-live|AAPL',
            symbol: 'AAPL',
            secType: 'STK',
            currency: 'USD',
            exchange: 'NASDAQ',
            primaryExchange: 'NASDAQ',
          },
          order: {
            action: 'BUY',
            orderType: 'MKT',
            tif: 'DAY',
            totalQuantity: '100',
          },
        },
      ],
      results: [
        {
          action: 'placeOrder',
          success: true,
          orderId: 'live-1',
          status: 'filled',
          filledQty: '100',
          filledPrice: '180.50',
        },
      ],
      stateAfter: {
        netLiquidation: '99950',
        totalCashValue: '81900',
        unrealizedPnL: '0',
        realizedPnL: '0',
        positions: [
          {
            accountId: 'alpaca-live',
            symbol: 'AAPL',
            quantity: '100',
            avgCost: '180.50',
            marketPrice: '180.50',
            marketValue: '18050',
            unrealizedPnL: '0',
          },
        ],
        pendingOrders: [],
      },
      timestamp: '2026-04-16T14:30:00.000Z',
    },
    {
      hash: 'ffff6666',
      parentHash: 'eeee5555',
      message: 'closePosition AAPL all (LIVE)',
      operations: [
        {
          action: 'closePosition',
          contract: {
            aliceId: 'alpaca-live|AAPL',
            symbol: 'AAPL',
            secType: 'STK',
            currency: 'USD',
            exchange: 'NASDAQ',
            primaryExchange: 'NASDAQ',
          },
          quantity: '100',
        },
      ],
      results: [
        {
          action: 'closePosition',
          success: true,
          orderId: 'live-2',
          status: 'filled',
          filledQty: '100',
          filledPrice: '181.00',
        },
      ],
      stateAfter: {
        netLiquidation: '100050',
        totalCashValue: '100050',
        unrealizedPnL: '0',
        realizedPnL: '50',
        positions: [],
        pendingOrders: [],
      },
      timestamp: '2026-04-16T16:00:00.000Z',
    },
  ],
}

// ==================== Stable JSON ====================

function sortedStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, sortedKeys(value), indent) + '\n'
}

function sortedKeys(_root: unknown): (string | number)[] {
  const seen = new Set<string>()
  const collect = (v: unknown): void => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) {
        if (!seen.has(k)) seen.add(k)
        collect((v as Record<string, unknown>)[k])
      }
    } else if (Array.isArray(v)) {
      for (const x of v) collect(x)
    }
  }
  collect(_root)
  return Array.from(seen).sort()
}

// ==================== Main ====================

function main(): void {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(resolve(ROOT, 'bybit-main'), { recursive: true })
  mkdirSync(resolve(ROOT, 'alpaca-paper'), { recursive: true })
  mkdirSync(resolve(ROOT, 'alpaca-live'), { recursive: true })

  writeFileSync(resolve(ROOT, 'bybit-main/crypto-trading_commit.json'),       sortedStringify(BYBIT))
  writeFileSync(resolve(ROOT, 'alpaca-paper/securities-trading_commit.json'), sortedStringify(ALPACA_PAPER))
  writeFileSync(resolve(ROOT, 'alpaca-live/securities-trading_commit.json'),  sortedStringify(ALPACA_LIVE))

  process.stdout.write('emitted 3 legacy-path fixtures\n')
  process.stdout.write(`directory: ${ROOT}\n`)
}

main()
