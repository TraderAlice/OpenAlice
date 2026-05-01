/**
 * parity/run-ts.ts — Phase 0 harness
 *
 * Drives a real TradingGit through `add → commit → push → log → exportState`
 * for a single operation fixture and emits a deterministic JSON envelope.
 *
 * Usage:
 *   pnpm tsx parity/run-ts.ts <fixture.json> [--out <path>]
 *
 * Exit codes:
 *   0 — success (operation submitted/filled OR cleanly rejected by guard)
 *   1 — runtime error (couldn't load/parse fixture, harness threw)
 *   2 — bad CLI args
 *
 * Determinism:
 *   - The harness does NOT call `vi.useFakeTimers()` because vitest is
 *     blocked on this machine (see TODO.md [migration][env-blocker]).
 *     Instead, it monkey-patches `Date.now` and `Date.prototype` to
 *     return a fixed instant `2026-05-02T00:00:00.000Z`. The output JSON
 *     carries `"hashFromFakeClock": true` so reviewers do not panic
 *     about hash mismatches between Phase 0 and a fresh live run.
 *   - All Decimal-bearing output flows through `toCanonicalDecimalString`.
 *   - Output keys are sorted recursively.
 *
 * Phase 1c will replace `parity/canonical-decimal-temp.ts` with the
 * production module and update the import below.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { Order, Contract, OrderCancel } from '@traderalice/ibkr'
import { TradingGit } from '../src/domain/trading/git/TradingGit.js'
import type {
  Operation,
  GitState,
} from '../src/domain/trading/git/types.js'
import { toCanonicalDecimalString } from './canonical-decimal-temp.js'

// ==================== Fake clock ====================

const FAKE_INSTANT = '2026-05-02T00:00:00.000Z'
const FAKE_MS = Date.parse(FAKE_INSTANT)

function installFakeClock(): void {
  // Replace Date constructor and Date.now so every callsite sees the
  // same instant. Doing this *before* importing TradingGit isn't
  // necessary because TradingGit only constructs `new Date()` inside
  // commit()/push(), so patching at module top-level is enough.
  const RealDate = Date
  const fakeDate = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) {
      return new RealDate(FAKE_MS)
    }
    // Pass-through for explicit construction.
    // @ts-expect-error — variadic Date construction
    return new RealDate(...args)
  } as unknown as DateConstructor
  fakeDate.now = () => FAKE_MS
  fakeDate.parse = RealDate.parse.bind(RealDate)
  fakeDate.UTC = RealDate.UTC.bind(RealDate)
  fakeDate.prototype = RealDate.prototype
  globalThis.Date = fakeDate
}

// ==================== Fixture types ====================

type WireDecimal = { kind: 'unset' } | { kind: 'value'; value: string }

interface WireOrder {
  action: 'BUY' | 'SELL'
  orderType: string
  tif: string
  totalQuantity?: WireDecimal
  lmtPrice?: WireDecimal
  auxPrice?: WireDecimal
  trailStopPrice?: WireDecimal
  trailingPercent?: WireDecimal
  cashQty?: WireDecimal
}

interface WireContract {
  aliceId?: string
  symbol: string
  secType: string
  exchange: string
  currency: string
}

interface WireTpSl {
  takeProfit?: { price: WireDecimal }
  stopLoss?: { price: WireDecimal }
}

type WireOperation =
  | { action: 'placeOrder'; contract: WireContract; order: WireOrder; tpsl?: WireTpSl }
  | { action: 'modifyOrder'; orderId: string; changes: Partial<WireOrder> }
  | { action: 'closePosition'; contract: WireContract; quantity?: WireDecimal }
  | { action: 'cancelOrder'; orderId: string }
  | { action: 'syncOrders' }

interface FixtureEnvelope {
  name: string
  category: string
  tags: string[]
  operation: WireOperation
  config: { expectGuardReject: boolean; fillPolicy: 'full' | 'partial' | 'none' }
  expectedStatus: string
}

// ==================== Wire → real conversion ====================

function decFromWire(w: WireDecimal | undefined, fallback: Decimal): Decimal {
  if (!w || w.kind === 'unset') return fallback
  return new Decimal(w.value)
}

function buildContract(w: WireContract): Contract {
  const c = new Contract()
  c.symbol = w.symbol
  c.secType = w.secType
  c.exchange = w.exchange
  c.currency = w.currency
  // contract-ext.ts adds aliceId — but we are not loading the side-effect
  // import. Cast to attach it directly so downstream code that reads
  // .aliceId still sees the value.
  ;(c as Contract & { aliceId?: string }).aliceId = w.aliceId
  return c
}

function buildOrder(w: WireOrder): Order {
  const o = new Order()
  o.action = w.action
  o.orderType = w.orderType
  o.tif = w.tif
  if (w.totalQuantity)   o.totalQuantity   = decFromWire(w.totalQuantity, o.totalQuantity)
  if (w.lmtPrice)        o.lmtPrice        = decFromWire(w.lmtPrice, o.lmtPrice)
  if (w.auxPrice)        o.auxPrice        = decFromWire(w.auxPrice, o.auxPrice)
  if (w.trailStopPrice)  o.trailStopPrice  = decFromWire(w.trailStopPrice, o.trailStopPrice)
  if (w.trailingPercent) o.trailingPercent = decFromWire(w.trailingPercent, o.trailingPercent)
  if (w.cashQty)         o.cashQty         = decFromWire(w.cashQty, o.cashQty)
  return o
}

function buildOperation(w: WireOperation): Operation {
  switch (w.action) {
    case 'placeOrder':
      return {
        action: 'placeOrder',
        contract: buildContract(w.contract),
        order: buildOrder(w.order),
        // TpSlParams is not strict here; the mock dispatcher ignores it.
        ...(w.tpsl
          ? {
              tpsl: {
                takeProfit: w.tpsl.takeProfit
                  ? { price: decFromWire(w.tpsl.takeProfit.price, new Decimal(0)) }
                  : undefined,
                stopLoss: w.tpsl.stopLoss
                  ? { price: decFromWire(w.tpsl.stopLoss.price, new Decimal(0)) }
                  : undefined,
              } as Operation extends { action: 'placeOrder'; tpsl?: infer T } ? T : never,
            }
          : {}),
      }
    case 'modifyOrder': {
      const changes: Partial<Order> = {}
      const c = w.changes
      if (c.action) changes.action = c.action
      if (c.orderType) changes.orderType = c.orderType
      if (c.tif) changes.tif = c.tif
      if (c.totalQuantity)   changes.totalQuantity   = decFromWire(c.totalQuantity, new Decimal(0))
      if (c.lmtPrice)        changes.lmtPrice        = decFromWire(c.lmtPrice, new Decimal(0))
      if (c.auxPrice)        changes.auxPrice        = decFromWire(c.auxPrice, new Decimal(0))
      if (c.trailStopPrice)  changes.trailStopPrice  = decFromWire(c.trailStopPrice, new Decimal(0))
      if (c.trailingPercent) changes.trailingPercent = decFromWire(c.trailingPercent, new Decimal(0))
      if (c.cashQty)         changes.cashQty         = decFromWire(c.cashQty, new Decimal(0))
      return { action: 'modifyOrder', orderId: w.orderId, changes }
    }
    case 'closePosition':
      return {
        action: 'closePosition',
        contract: buildContract(w.contract),
        quantity: w.quantity ? decFromWire(w.quantity, new Decimal(0)) : undefined,
      }
    case 'cancelOrder':
      return { action: 'cancelOrder', orderId: w.orderId, orderCancel: new OrderCancel() }
    case 'syncOrders':
      return { action: 'syncOrders' }
  }
}

// ==================== Mock dispatcher + state ====================

let _mockOrderIdCounter = 0

function nextMockOrderId(): string {
  _mockOrderIdCounter += 1
  return String(_mockOrderIdCounter)
}

function makeMockDispatcher(envelope: FixtureEnvelope): (op: Operation) => Promise<unknown> {
  return async (op: Operation): Promise<unknown> => {
    if (envelope.config.expectGuardReject) {
      // Simulate guard rejection — the harness emits a deterministic
      // payload that TradingGit will surface as a failure.
      return {
        success: false,
        error: 'guard rejected: ' + envelope.expectedStatus,
        status: envelope.expectedStatus,
      }
    }
    const orderId = op.action === 'placeOrder' || op.action === 'closePosition'
      ? nextMockOrderId()
      : ('modifyOrder' === op.action || 'cancelOrder' === op.action)
        ? op.orderId
        : 'sync'
    return {
      success: true,
      orderId,
      status: envelope.expectedStatus === 'filled' ? 'filled'
            : envelope.expectedStatus === 'cancelled' ? 'cancelled'
            : 'submitted',
      filledQty: envelope.config.fillPolicy === 'full' && op.action === 'placeOrder'
        ? toCanonicalDecimalString(decFromWire((op.order as unknown as { totalQuantity: Decimal }).totalQuantity as unknown as WireDecimal, new Decimal(0)))
        : undefined,
      filledPrice: envelope.config.fillPolicy === 'full' && op.action === 'placeOrder' && (op.order as Order).lmtPrice
        ? toCanonicalDecimalString((op.order as Order).lmtPrice)
        : undefined,
    }
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

// ==================== Output canonicalization ====================

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isDecimal(x: unknown): x is Decimal {
  return x instanceof Decimal
}

function canonicalize(value: unknown): unknown {
  if (isDecimal(value)) {
    // Replace any Decimal that survived to the output stage with a
    // canonical wire form. Sentinel-bearing values pass through verbatim
    // — but the upstream wire-typing of Phase 1b will have already
    // replaced them; here we only see "live" Decimals.
    return { kind: 'value', value: toCanonicalDecimalString(value) }
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k])
    }
    return out
  }
  return value
}

function suppressTime(value: unknown): unknown {
  // Replace top-level commit timestamps with a stable marker so fixture
  // diffs don't flip on re-runs even if our fake clock leaks.
  if (Array.isArray(value)) return value.map(suppressTime)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
      if (k === 'timestamp') {
        out[k] = '<time-suppressed>'
      } else {
        out[k] = suppressTime(value[k])
      }
    }
    return out
  }
  return value
}

// ==================== CLI ====================

function parseArgs(argv: string[]): { fixturePath: string; outPath: string | null } {
  const args = argv.slice(2)
  if (args.length === 0) {
    process.stderr.write('usage: pnpm tsx parity/run-ts.ts <fixture.json> [--out <path>]\n')
    process.exit(2)
  }
  let fixturePath = ''
  let outPath: string | null = null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--out') {
      outPath = args[++i] ?? null
      if (!outPath) {
        process.stderr.write('--out requires a path argument\n')
        process.exit(2)
      }
    } else if (a.startsWith('-')) {
      process.stderr.write(`unknown flag: ${a}\n`)
      process.exit(2)
    } else if (!fixturePath) {
      fixturePath = a
    } else {
      process.stderr.write(`unexpected positional: ${a}\n`)
      process.exit(2)
    }
  }
  if (!fixturePath) {
    process.stderr.write('fixture path is required\n')
    process.exit(2)
  }
  return { fixturePath, outPath }
}

async function main(): Promise<void> {
  installFakeClock()

  const { fixturePath, outPath } = parseArgs(process.argv)

  const absFixture = resolve(fixturePath)
  const text = readFileSync(absFixture, 'utf-8')
  const envelope = JSON.parse(text) as FixtureEnvelope

  const operation = buildOperation(envelope.operation)

  const git = new TradingGit({
    executeOperation: makeMockDispatcher(envelope),
    getGitState: fakeGetGitState,
  })

  const addResult = git.add(operation)
  const commitPrepareResult = git.commit(envelope.name)
  const pushResult = await git.push()
  const log = git.log({ limit: 10 })
  const exportState = git.exportState()

  const output = {
    fixture: absFixture.split('/').pop()?.replace(/\.json$/, '') ?? absFixture,
    hashFromFakeClock: true,
    fakeClockInstant: FAKE_INSTANT,
    addResult: canonicalize({
      index: addResult.index,
      staged: addResult.staged,
      // Operation contains live Order/Contract; their decimal fields
      // surface here as Decimal — canonicalize() converts them.
      operation: addResult.operation,
    }),
    commitPrepareResult: canonicalize(commitPrepareResult),
    pushResult: suppressTime(canonicalize(pushResult)),
    log: suppressTime(canonicalize(log)),
    exportState: suppressTime(canonicalize(exportState)),
  }

  const json = JSON.stringify(output, null, 2) + '\n'
  if (outPath) {
    writeFileSync(resolve(outPath), json)
  } else {
    process.stdout.write(json)
  }
}

main().catch((err) => {
  process.stderr.write(`run-ts.ts error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
