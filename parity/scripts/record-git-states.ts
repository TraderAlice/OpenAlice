/**
 * Recorder for parity/fixtures/git-states/ — 10 GitExportState snapshots.
 *
 * Each scenario builds a fresh TradingGit with a deterministic
 * mock-broker-style dispatcher, runs a fixed walk of operations, and
 * captures the result of `git.exportState()` to disk. The captures are
 * used by Phase 1+ for round-trip parity checks against the Rust
 * persistence layer.
 *
 * Determinism:
 *   - Date.now monkey-patched to 2026-05-02T00:00:00.000Z (same as
 *     parity/run-ts.ts).
 *   - Mock dispatcher emits stable order IDs starting at 1 per scenario.
 *   - Decimal-bearing output flows through `toCanonicalDecimalString`.
 *   - Sorted-key 2-space-indent JSON.
 *
 * Usage:
 *   pnpm tsx parity/scripts/record-git-states.ts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { Order, Contract, OrderCancel } from '@traderalice/ibkr'
import { TradingGit } from '../../src/domain/trading/git/TradingGit.js'
import type { Operation, GitState } from '../../src/domain/trading/git/types.js'
import { toCanonicalDecimalString } from '../canonical-decimal-temp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/git-states')

// ==================== Fake clock ====================

const FAKE_INSTANT = '2026-05-02T00:00:00.000Z'
const FAKE_MS = Date.parse(FAKE_INSTANT)

function installFakeClock(): void {
  const RealDate = Date
  const fakeDate = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new RealDate(FAKE_MS)
    // @ts-expect-error variadic Date construction
    return new RealDate(...args)
  } as unknown as DateConstructor
  fakeDate.now = () => FAKE_MS
  fakeDate.parse = RealDate.parse.bind(RealDate)
  fakeDate.UTC = RealDate.UTC.bind(RealDate)
  fakeDate.prototype = RealDate.prototype
  globalThis.Date = fakeDate
}

// ==================== Helpers ====================

function makeContract(symbol: string, secType: 'STK' | 'CRYPTO', exchange = 'SMART', currency = 'USD'): Contract {
  const c = new Contract()
  c.symbol = symbol
  c.secType = secType
  c.exchange = exchange
  c.currency = currency
  ;(c as Contract & { aliceId?: string }).aliceId = `${exchange}|${symbol}`
  return c
}

function makeOrder(action: 'BUY' | 'SELL', orderType: string, tif: string, qty: string, lmt?: string): Order {
  const o = new Order()
  o.action = action
  o.orderType = orderType
  o.tif = tif
  o.totalQuantity = new Decimal(qty)
  if (lmt) o.lmtPrice = new Decimal(lmt)
  return o
}

interface ScenarioConfig {
  /** Stable order IDs per dispatcher call. */
  nextOrderId: () => string
  /** What status the dispatcher reports for placeOrder. */
  defaultStatus: 'filled' | 'submitted' | 'cancelled'
  /** Optional fillPolicy override per call. */
  rejectAllPlaceOrders?: boolean
}

function makeDispatcher(scenario: ScenarioConfig): (op: Operation) => Promise<unknown> {
  return async (op: Operation): Promise<unknown> => {
    if (scenario.rejectAllPlaceOrders && op.action === 'placeOrder') {
      return { success: false, error: 'guard rejected: MaxPositionSize', status: 'rejected' }
    }
    const orderId = (op.action === 'placeOrder' || op.action === 'closePosition')
      ? scenario.nextOrderId()
      : ('orderId' in op ? op.orderId : 'sync')
    if (op.action === 'placeOrder') {
      const order = op.order
      const qty = order.totalQuantity
      return {
        success: true,
        orderId,
        status: scenario.defaultStatus,
        filledQty: scenario.defaultStatus === 'filled' ? toCanonicalDecimalString(qty) : undefined,
        filledPrice: scenario.defaultStatus === 'filled' && order.lmtPrice && !order.lmtPrice.equals(new Decimal('170141183460469231731687303715884105727'))
          ? toCanonicalDecimalString(order.lmtPrice)
          : (scenario.defaultStatus === 'filled' ? '100' : undefined),
      }
    }
    if (op.action === 'closePosition') {
      return {
        success: true,
        orderId,
        status: 'filled',
        filledQty: op.quantity ? toCanonicalDecimalString(op.quantity) : '100',
        filledPrice: '105',
      }
    }
    if (op.action === 'cancelOrder') {
      return { success: true, orderId, status: 'cancelled' }
    }
    if (op.action === 'modifyOrder') {
      return { success: true, orderId, status: 'submitted' }
    }
    if (op.action === 'syncOrders') {
      return { success: true, orderId: 'sync', status: 'submitted' }
    }
    return { success: false, error: 'unhandled', status: 'rejected' }
  }
}

const FIXED_GIT_STATE: GitState = {
  netLiquidation:  '100000',
  totalCashValue:  '100000',
  unrealizedPnL:   '0',
  realizedPnL:     '0',
  positions:       [],
  pendingOrders:   [],
}

async function fakeGetGitState(): Promise<GitState> {
  return FIXED_GIT_STATE
}

function makeScenarioCounter(): () => string {
  let n = 0
  return () => String(++n)
}

function newGit(scenario: ScenarioConfig): TradingGit {
  return new TradingGit({
    executeOperation: makeDispatcher(scenario),
    getGitState: fakeGetGitState,
  })
}

// ==================== Stable JSON ====================

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isDecimal(x: unknown): x is Decimal { return x instanceof Decimal }

function canonicalize(value: unknown): unknown {
  if (isDecimal(value)) return { kind: 'value', value: toCanonicalDecimalString(value) }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k])
    return out
  }
  return value
}

function suppressTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(suppressTime)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) out[k] = k === 'timestamp' ? '<time-suppressed>' : suppressTime(value[k])
    return out
  }
  return value
}

function writeState(filename: string, git: TradingGit): void {
  const exportState = git.exportState()
  const payload = {
    fakeClockInstant: FAKE_INSTANT,
    hashFromFakeClock: true,
    state: suppressTime(canonicalize(exportState)),
  }
  writeFileSync(resolve(FIXTURE_ROOT, filename), JSON.stringify(payload, null, 2) + '\n')
}

// ==================== Scenarios ====================

interface Scenario {
  filename: string
  description: string
  build: () => Promise<TradingGit>
}

const aapl  = makeContract('AAPL',  'STK',    'NASDAQ',  'USD')
const tsla  = makeContract('TSLA',  'STK',    'NASDAQ',  'USD')
const nvda  = makeContract('NVDA',  'STK',    'NASDAQ',  'USD')
const btc   = makeContract('BTC/USDT', 'CRYPTO', 'bybit',  'USDT')
const eth   = makeContract('ETH/USDT', 'CRYPTO', 'bybit',  'USDT')

const SCENARIOS: Scenario[] = [
  {
    filename: 'state-01-empty.json',
    description: 'Fresh TradingGit, no commits',
    build: async () => newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' }),
  },
  {
    filename: 'state-02-single-buy.json',
    description: 'Single BUY MKT, filled',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'MKT', 'DAY', '100') })
      git.commit('BUY 100 AAPL MKT')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-03-bracket-filled.json',
    description: 'BUY LMT with TP+SL bracket, all filled',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' })
      git.add({
        action: 'placeOrder',
        contract: aapl,
        order: makeOrder('BUY', 'LMT', 'GTC', '100', '180'),
        tpsl: { takeProfit: { price: new Decimal('189') }, stopLoss: { price: new Decimal('171') } },
      } as Operation)
      git.commit('BUY 100 AAPL LMT @180 with TP/SL')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-04-rejected-by-guard.json',
    description: 'Operation rejected by mock guard',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled', rejectAllPlaceOrders: true })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'MKT', 'DAY', '100000') })
      git.commit('BUY 100000 AAPL — guard should reject')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-05-mixed-multi-symbol.json',
    description: 'Three symbols, ten commits — multi-symbol log',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' })
      const ops: { contract: Contract; qty: string; type: string; lmt?: string }[] = [
        { contract: aapl, qty: '100', type: 'MKT' },
        { contract: tsla, qty: '50',  type: 'MKT' },
        { contract: nvda, qty: '25',  type: 'MKT' },
        { contract: aapl, qty: '50',  type: 'LMT', lmt: '195' },
        { contract: tsla, qty: '20',  type: 'LMT', lmt: '210' },
        { contract: nvda, qty: '15',  type: 'LMT', lmt: '900' },
        { contract: aapl, qty: '30',  type: 'MKT' },
        { contract: tsla, qty: '10',  type: 'MKT' },
        { contract: nvda, qty: '5',   type: 'MKT' },
        { contract: aapl, qty: '10',  type: 'MKT' },
      ]
      let i = 0
      for (const o of ops) {
        i += 1
        git.add({ action: 'placeOrder', contract: o.contract, order: makeOrder('BUY', o.type, 'DAY', o.qty, o.lmt) })
        git.commit(`commit ${i}: BUY ${o.qty} ${o.contract.symbol} ${o.type}`)
        await git.push()
      }
      return git
    },
  },
  {
    filename: 'state-06-with-sync.json',
    description: 'Pending order then sync to filled',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'submitted' })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'LMT', 'GTC', '100', '180') })
      git.commit('BUY LMT 100 AAPL @180 — will be synced to filled')
      await git.push()
      // Simulate a sync update from the broker.
      await git.sync(
        [{ orderId: '1', symbol: 'AAPL', previousStatus: 'submitted', currentStatus: 'filled', filledQty: '100', filledPrice: '180' }],
        FIXED_GIT_STATE,
      )
      return git
    },
  },
  {
    filename: 'state-07-close-position.json',
    description: 'Open then close position',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'MKT', 'DAY', '100') })
      git.commit('open BUY 100 AAPL')
      await git.push()
      git.add({ action: 'closePosition', contract: aapl, quantity: new Decimal('100') })
      git.commit('close 100 AAPL')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-08-cancel-order.json',
    description: 'Place GTC then cancel',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'submitted' })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'LMT', 'GTC', '100', '170') })
      git.commit('BUY 100 AAPL LMT @170 GTC')
      await git.push()
      git.add({ action: 'cancelOrder', orderId: '1', orderCancel: new OrderCancel() })
      git.commit('cancel order 1')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-09-modify-order.json',
    description: 'Place then modify',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'submitted' })
      git.add({ action: 'placeOrder', contract: aapl, order: makeOrder('BUY', 'LMT', 'GTC', '100', '170') })
      git.commit('place BUY 100 AAPL LMT @170')
      await git.push()
      git.add({ action: 'modifyOrder', orderId: '1', changes: { lmtPrice: new Decimal('175') } })
      git.commit('modify lmtPrice 170 → 175')
      await git.push()
      return git
    },
  },
  {
    filename: 'state-10-adversarial-decimals.json',
    description: 'Sub-satoshi qty + 18dp price end-to-end',
    build: async () => {
      const git = newGit({ nextOrderId: makeScenarioCounter(), defaultStatus: 'filled' })
      git.add({ action: 'placeOrder', contract: btc, order: makeOrder('BUY', 'LMT', 'GTC', '0.00012345', '67234.50') })
      git.commit('BUY 0.00012345 BTC/USDT LMT @67234.50 (sub-satoshi)')
      await git.push()
      git.add({ action: 'placeOrder', contract: eth, order: makeOrder('BUY', 'LMT', 'GTC', '0.000000000000000001', '0.000000000000000001') })
      git.commit('BUY 1e-18 ETH/USDT LMT @1e-18 (18dp)')
      await git.push()
      git.add({ action: 'placeOrder', contract: btc, order: makeOrder('SELL', 'LMT', 'GTC', '1e30', '1e-30') })
      git.commit('SELL 1e30 BTC/USDT LMT @1e-30 (extreme magnitudes)')
      await git.push()
      return git
    },
  },
]

// ==================== Main ====================

async function main(): Promise<void> {
  installFakeClock()
  if (existsSync(FIXTURE_ROOT)) {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
  mkdirSync(FIXTURE_ROOT, { recursive: true })

  for (const scenario of SCENARIOS) {
    const git = await scenario.build()
    writeState(scenario.filename, git)
  }

  process.stdout.write(`emitted ${SCENARIOS.length} git-state fixtures\n`)
  process.stdout.write(`directory: ${FIXTURE_ROOT}\n`)
}

main().catch((err) => {
  process.stderr.write(`record-git-states.ts error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
