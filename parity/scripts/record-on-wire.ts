/**
 * Recorder for parity/fixtures/orders-on-wire/.
 *
 * Snapshots `JSON.stringify` output of real IBKR carrier instances built
 * in TS. These captures lock in the on-disk / on-wire shape that
 * Phase 1b's wire adapters must recognize and round-trip. They are
 * intentionally redundant with the `sentinels/` fixtures (which target
 * single fields) — this directory targets full carriers in real-shaped
 * configurations.
 *
 * Each fixture file:
 *   {
 *     "name": "...",
 *     "carrier": "Order"|"Contract"|"Execution"|"OrderState",
 *     "raw": <native JSON shape after JSON.stringify(JSON.parse(...))>,
 *     "stringified": "<the literal JSON.stringify output>"
 *   }
 *
 * The "stringified" string is what TradingGit currently writes to disk;
 * "raw" is the parsed re-shaped object. Both must round-trip Phase 1b's
 * `wireAdapters.{ibkrOrderToWire, wireToIbkrOrder}`.
 *
 * Usage:
 *   pnpm tsx parity/scripts/record-on-wire.ts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { Order, Contract, ContractDetails, Execution, ExecutionFilter, OrderState, OrderAllocation, UNSET_DECIMAL } from '@traderalice/ibkr'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/orders-on-wire')

// Phase-0 finding: PHASE0_PLAN.md §4 attributed minSize/sizeIncrement/etc.
// to Contract, but they live on ContractDetails. Same for OrderState
// position fields (→ OrderAllocation) and Execution.lastNDays (→ ExecutionFilter).
type Carrier = 'Order' | 'Contract' | 'ContractDetails' | 'Execution' | 'ExecutionFilter' | 'OrderState' | 'OrderAllocation'

interface OnWireFixture {
  name: string
  carrier: Carrier
  raw: unknown
  stringified: string
}

// ==================== Builders ====================

function makeStockContract(symbol: string): Contract {
  const c = new Contract()
  c.symbol = symbol
  c.secType = 'STK'
  c.exchange = 'SMART'
  c.currency = 'USD'
  c.primaryExchange = 'NASDAQ'
  return c
}

function makeOptionContract(): Contract {
  const c = new Contract()
  c.symbol = 'AAPL'
  c.secType = 'OPT'
  c.exchange = 'SMART'
  c.currency = 'USD'
  c.lastTradeDateOrContractMonth = '20260620'
  c.strike = 250
  c.right = 'C'
  c.multiplier = '100'
  return c
}

function makeCryptoContract(): Contract {
  const c = new Contract()
  c.symbol = 'BTC/USDT'
  c.secType = 'CRYPTO'
  c.exchange = 'bybit'
  c.currency = 'USDT'
  return c
}

function makeCryptoContractDetails(): ContractDetails {
  const cd = new ContractDetails()
  cd.contract = makeCryptoContract()
  cd.minSize = new Decimal('0.0001')
  cd.sizeIncrement = new Decimal('0.0001')
  cd.suggestedSizeIncrement = new Decimal('0.0001')
  cd.lastPricePrecision = new Decimal('2')
  cd.lastSizePrecision = new Decimal('8')
  return cd
}

function makeOrderMktBuy(qty: string): Order {
  const o = new Order()
  o.action = 'BUY'
  o.orderType = 'MKT'
  o.tif = 'DAY'
  o.totalQuantity = new Decimal(qty)
  return o
}

function makeOrderLmtSell(qty: string, lmt: string): Order {
  const o = new Order()
  o.action = 'SELL'
  o.orderType = 'LMT'
  o.tif = 'GTC'
  o.totalQuantity = new Decimal(qty)
  o.lmtPrice = new Decimal(lmt)
  return o
}

function makeOrderStpLmt(qty: string, stp: string, lmt: string): Order {
  const o = new Order()
  o.action = 'BUY'
  o.orderType = 'STP_LMT'
  o.tif = 'GTC'
  o.totalQuantity = new Decimal(qty)
  o.auxPrice = new Decimal(stp)
  o.lmtPrice = new Decimal(lmt)
  return o
}

function makeOrderTrail(qty: string, percent: string): Order {
  const o = new Order()
  o.action = 'SELL'
  o.orderType = 'TRAIL'
  o.tif = 'GTC'
  o.totalQuantity = new Decimal(qty)
  o.trailingPercent = new Decimal(percent)
  return o
}

function makeOrderMinimal(): Order {
  // Every Decimal field defaults to UNSET_DECIMAL. Captures the all-unset corner.
  return new Order()
}

function makeExecution(shares: string, price: number): Execution {
  const e = new Execution()
  e.execId = 'exec-12345'
  e.orderId = 1
  e.clientId = 0
  e.permId = 999
  e.side = 'BOT'
  e.shares = new Decimal(shares)
  e.cumQty = new Decimal(shares)
  e.price = price
  return e
}

function makeOrderStateBasic(): OrderState {
  const s = new OrderState()
  s.status = 'PreSubmitted'
  s.commissionAndFees = 1.25
  s.minCommissionAndFees = 1.0
  s.maxCommissionAndFees = 1.5
  s.suggestedSize = new Decimal('100')
  return s
}

function makeOrderAllocation(): OrderAllocation {
  const a = new OrderAllocation()
  a.account = 'paper-account-1'
  a.position = new Decimal('100')
  a.positionDesired = new Decimal('110')
  a.positionAfter = new Decimal('110')
  a.desiredAllocQty = new Decimal('10')
  a.allowedAllocQty = new Decimal('10')
  return a
}

function makeOrderStateAllUnset(): OrderState {
  // Default constructor — every sentinel-bearing field stays at sentinel.
  return new OrderState()
}

function makeOrderStateAllSet(): OrderState {
  const s = new OrderState()
  s.status = 'Filled'
  s.commissionAndFees = 2.0
  s.minCommissionAndFees = 1.95
  s.maxCommissionAndFees = 2.05
  s.initMarginBeforeOutsideRTH = 1000
  s.maintMarginBeforeOutsideRTH = 800
  s.equityWithLoanBeforeOutsideRTH = 5000
  s.initMarginChangeOutsideRTH = 50
  s.maintMarginChangeOutsideRTH = 40
  s.equityWithLoanChangeOutsideRTH = -45
  s.initMarginAfterOutsideRTH = 1050
  s.maintMarginAfterOutsideRTH = 840
  s.equityWithLoanAfterOutsideRTH = 4955
  s.suggestedSize = new Decimal('100')
  s.orderAllocations = [makeOrderAllocation()]
  return s
}

// ==================== Fixture catalog ====================

interface Spec {
  name: string
  filename: string
  carrier: Carrier
  build: () => unknown
}

const SPECS: Spec[] = [
  // Contracts
  { name: 'Contract STK AAPL minimal',          filename: 'contract-stk-aapl-minimal.json',     carrier: 'Contract', build: () => makeStockContract('AAPL') },
  { name: 'Contract STK TSLA minimal',          filename: 'contract-stk-tsla-minimal.json',     carrier: 'Contract', build: () => makeStockContract('TSLA') },
  { name: 'Contract OPT AAPL 250C 2026-06-20',  filename: 'contract-opt-aapl-call.json',        carrier: 'Contract', build: makeOptionContract },
  { name: 'Contract CRYPTO BTC/USDT bybit',     filename: 'contract-crypto-btc.json',           carrier: 'Contract', build: makeCryptoContract },
  { name: 'Contract default (strike=UNSET_DOUBLE)', filename: 'contract-default.json',          carrier: 'Contract', build: () => new Contract() },
  // ContractDetails (Phase-0 finding: minSize/sizeIncrement/etc. live here, not on Contract)
  { name: 'ContractDetails CRYPTO with precision', filename: 'contract-details-crypto.json',    carrier: 'ContractDetails', build: makeCryptoContractDetails },
  { name: 'ContractDetails default (UNSET_DECIMAL precision fields)', filename: 'contract-details-default.json', carrier: 'ContractDetails', build: () => new ContractDetails() },

  // Orders — order-type coverage
  { name: 'Order BUY MKT DAY 100 shares',       filename: 'order-mkt-buy-100.json',             carrier: 'Order',    build: () => makeOrderMktBuy('100') },
  { name: 'Order BUY MKT DAY 0.00012345 BTC',   filename: 'order-mkt-buy-btc-sub-satoshi.json', carrier: 'Order',    build: () => makeOrderMktBuy('0.00012345') },
  { name: 'Order BUY MKT DAY 1e30 large',       filename: 'order-mkt-buy-large.json',           carrier: 'Order',    build: () => makeOrderMktBuy('1e30') },
  { name: 'Order BUY MKT DAY 1e-30 small',      filename: 'order-mkt-buy-small.json',           carrier: 'Order',    build: () => makeOrderMktBuy('1e-30') },
  { name: 'Order SELL LMT GTC 50 @ 195.5',      filename: 'order-lmt-sell-50.json',             carrier: 'Order',    build: () => makeOrderLmtSell('50', '195.5') },
  { name: 'Order SELL LMT GTC 18dp price',      filename: 'order-lmt-sell-18dp-price.json',     carrier: 'Order',    build: () => makeOrderLmtSell('1', '0.000000000000000001') },
  { name: 'Order BUY STP_LMT GTC 100',          filename: 'order-stp-lmt-buy.json',             carrier: 'Order',    build: () => makeOrderStpLmt('100', '95.0', '94.5') },
  { name: 'Order SELL TRAIL GTC trailing 1.5%', filename: 'order-trail-sell-1pct.json',         carrier: 'Order',    build: () => makeOrderTrail('100', '1.5') },
  { name: 'Order default (every Decimal = UNSET_DECIMAL)', filename: 'order-default.json',      carrier: 'Order',    build: makeOrderMinimal },

  // Orders — TIF coverage on LMT
  { name: 'Order BUY LMT IOC',                  filename: 'order-lmt-buy-ioc.json',             carrier: 'Order',    build: () => { const o = makeOrderLmtSell('5', '50'); o.action = 'BUY'; o.tif = 'IOC'; return o } },
  { name: 'Order BUY LMT GTD',                  filename: 'order-lmt-buy-gtd.json',             carrier: 'Order',    build: () => { const o = makeOrderLmtSell('5', '50'); o.action = 'BUY'; o.tif = 'GTD'; o.goodTillDate = '20261231 23:59:59 UTC'; return o } },
  { name: 'Order BUY LMT FOK',                  filename: 'order-lmt-buy-fok.json',             carrier: 'Order',    build: () => { const o = makeOrderLmtSell('5', '50'); o.action = 'BUY'; o.tif = 'FOK'; return o } },
  { name: 'Order BUY LMT OPG',                  filename: 'order-lmt-buy-opg.json',             carrier: 'Order',    build: () => { const o = makeOrderLmtSell('5', '50'); o.action = 'BUY'; o.tif = 'OPG'; return o } },

  // Orders — sentinel coverage on a single carrier
  { name: 'Order with cashQty set, totalQuantity unset', filename: 'order-cashqty.json',        carrier: 'Order',    build: () => { const o = new Order(); o.action = 'BUY'; o.orderType = 'MKT'; o.tif = 'DAY'; o.cashQty = new Decimal('1000'); return o } },
  { name: 'Order with filledQuantity captured',          filename: 'order-filled.json',         carrier: 'Order',    build: () => { const o = makeOrderMktBuy('100'); o.filledQuantity = new Decimal('100'); return o } },
  { name: 'Order MOC DAY (market on close)',             filename: 'order-moc.json',            carrier: 'Order',    build: () => { const o = new Order(); o.action = 'BUY'; o.orderType = 'MOC'; o.tif = 'DAY'; o.totalQuantity = new Decimal('200'); return o } },

  // Executions
  { name: 'Execution 100 shares @ 150.25',      filename: 'execution-100-shares.json',          carrier: 'Execution', build: () => makeExecution('100', 150.25) },
  { name: 'Execution sub-satoshi 0.00012345',   filename: 'execution-sub-satoshi.json',         carrier: 'Execution', build: () => makeExecution('0.00012345', 67234.5) },
  { name: 'Execution default (UNSET_DECIMAL fields)', filename: 'execution-default.json',       carrier: 'Execution', build: () => new Execution() },
  // ExecutionFilter (Phase-0 finding: lastNDays lives here, not on Execution)
  { name: 'ExecutionFilter with lastNDays=30',  filename: 'executionfilter-lastndays.json',     carrier: 'ExecutionFilter', build: () => { const f = new ExecutionFilter(); f.lastNDays = 30; return f } },
  { name: 'ExecutionFilter default (UNSET_INTEGER lastNDays)', filename: 'executionfilter-default.json', carrier: 'ExecutionFilter', build: () => new ExecutionFilter() },

  // OrderStates
  { name: 'OrderState basic PreSubmitted',      filename: 'orderstate-presubmitted.json',       carrier: 'OrderState', build: makeOrderStateBasic },
  { name: 'OrderState all-unset (default)',     filename: 'orderstate-all-unset.json',          carrier: 'OrderState', build: makeOrderStateAllUnset },
  { name: 'OrderState all-set Filled (with allocations)', filename: 'orderstate-all-set.json',  carrier: 'OrderState', build: makeOrderStateAllSet },
  { name: 'OrderState Cancelled',               filename: 'orderstate-cancelled.json',          carrier: 'OrderState', build: () => { const s = new OrderState(); s.status = 'Cancelled'; s.suggestedSize = new Decimal('0'); return s } },
  // OrderAllocation (Phase-0 finding: position/positionDesired/etc. live here, not on OrderState)
  { name: 'OrderAllocation populated',          filename: 'orderallocation-set.json',           carrier: 'OrderAllocation', build: makeOrderAllocation },
  { name: 'OrderAllocation default (all UNSET_DECIMAL)', filename: 'orderallocation-default.json', carrier: 'OrderAllocation', build: () => new OrderAllocation() },

  // Round-trip-fragile case: UNSET_DECIMAL preserved verbatim
  { name: 'Order with explicit UNSET_DECIMAL',  filename: 'order-explicit-unset.json',          carrier: 'Order',    build: () => { const o = new Order(); o.action = 'BUY'; o.orderType = 'MKT'; o.tif = 'DAY'; o.totalQuantity = UNSET_DECIMAL; return o } },

  // OrderState with mixed signs on margin deltas
  { name: 'OrderState negative margin change',  filename: 'orderstate-neg-margin.json',         carrier: 'OrderState', build: () => { const s = makeOrderStateAllSet(); s.equityWithLoanChangeOutsideRTH = -1234.56; s.initMarginChangeOutsideRTH = -100; return s } },
]

// ==================== Stable JSON formatter ====================

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
  if (existsSync(FIXTURE_ROOT)) {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
  mkdirSync(FIXTURE_ROOT, { recursive: true })

  for (const spec of SPECS) {
    const instance = spec.build()
    const stringified = JSON.stringify(instance)
    const raw = JSON.parse(stringified)
    const fixture: OnWireFixture = {
      name: spec.name,
      carrier: spec.carrier,
      raw,
      stringified,
    }
    writeFileSync(resolve(FIXTURE_ROOT, spec.filename), sortedStringify(fixture))
  }

  process.stdout.write(`emitted ${SPECS.length} on-wire fixtures\n`)
  process.stdout.write(`directory: ${FIXTURE_ROOT}\n`)
}

main()
