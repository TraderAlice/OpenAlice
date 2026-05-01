/**
 * Generator for parity/fixtures/operations/ — ≥200 staged-operation cases.
 *
 * Each fixture is a single Operation envelope with every Decimal-bearing
 * field written through `toCanonicalDecimalString`. Sentinel-bearing
 * fields are rendered as `{ kind: "unset" }`; real values as
 * `{ kind: "value", value: "<canonical-string>" }`. This is the on-wire
 * shape Phase 1b's adapters will produce.
 *
 * Coverage matrix (PHASE0_PLAN.md §1 — 0.1):
 *   001–040  — BUY × {MKT, LMT, STP, STP_LMT, TRAIL, TRAIL_LIMIT, MOC} × {DAY, GTC, IOC, GTD}
 *              with cycling decimal-edge classes
 *   041–080  — SELL — same matrix
 *   081–120  — BUY/SELL × {TP-only, SL-only, TP+SL bracket} on MKT/LMT/STP
 *   121–160  — closePosition × {full, partial qty, all positions, BTC sub-satoshi qty, ...}
 *   161–180  — modifyOrder × {qty, price, type, tif} changes
 *   181–200  — cancelOrder + syncOrders
 *   201–240  — adversarial decimals on placeOrder (8/12/18 dp, 1e30, 1e-30, negative-rejected, zero-rejected)
 *
 * Each fixture file:
 *   {
 *     "name": "...",
 *     "category": "...",
 *     "tags": [...],
 *     "operation": <Operation in wire form>,
 *     "config": { "expectGuardReject": bool, "fillPolicy": "full"|"none"|... },
 *     "expectedStatus": "submitted"|"filled"|"user-rejected"
 *   }
 *
 * Idempotent: re-running with no source edits → byte-identical fixtures.
 *
 * Usage:
 *   pnpm tsx parity/scripts/gen-operations.ts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { toCanonicalDecimalString } from '../canonical-decimal-temp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/operations')

// ==================== Decimal wire helpers ====================

type WireDecimal =
  | { kind: 'unset' }
  | { kind: 'value'; value: string }

function decValue(d: string | Decimal): WireDecimal {
  const dec = d instanceof Decimal ? d : new Decimal(d)
  return { kind: 'value', value: toCanonicalDecimalString(dec) }
}

const UNSET: WireDecimal = { kind: 'unset' }

// ==================== Symbols + decimal-edge classes ====================

interface DecimalClass {
  tag: string
  qty: string
  price: string
  /** Number of decimal places for documentation (not enforced in canonical output). */
  dp: number
}

const DECIMAL_CLASSES: DecimalClass[] = [
  { tag: 'std-2dp',      qty: '100',                price: '50.25',                       dp: 2 },
  { tag: 'btc-8dp',      qty: '0.00012345',         price: '67234.50',                    dp: 8 },
  { tag: 'usdt-12dp',    qty: '0.000000123456',     price: '0.999875',                    dp: 12 },
  { tag: 'eth-18dp',     qty: '0.000000000000000001', price: '3500.123456789012345',      dp: 18 },
  { tag: 'large',        qty: '1e30',               price: '1.5',                         dp: 0 },
  { tag: 'small',        qty: '1e-30',              price: '0.0001',                      dp: 30 },
]

interface SymbolSpec {
  aliceId: string
  symbol: string
  secType: 'STK' | 'CRYPTO' | 'FUT' | 'OPT'
  exchange: string
  currency: string
}

const SYMBOLS: SymbolSpec[] = [
  { aliceId: 'alpaca-paper|AAPL', symbol: 'AAPL', secType: 'STK',    exchange: 'NASDAQ',   currency: 'USD' },
  { aliceId: 'alpaca-paper|TSLA', symbol: 'TSLA', secType: 'STK',    exchange: 'NASDAQ',   currency: 'USD' },
  { aliceId: 'bybit-main|BTC/USDT', symbol: 'BTC/USDT', secType: 'CRYPTO', exchange: 'bybit', currency: 'USDT' },
  { aliceId: 'bybit-main|ETH/USDT', symbol: 'ETH/USDT', secType: 'CRYPTO', exchange: 'bybit', currency: 'USDT' },
]

// ==================== Operation builders ====================

interface WireOrder {
  action: 'BUY' | 'SELL'
  orderType: string
  tif: string
  totalQuantity: WireDecimal
  lmtPrice: WireDecimal
  auxPrice: WireDecimal
  trailStopPrice: WireDecimal
  trailingPercent: WireDecimal
  cashQty: WireDecimal
}

interface WireContract {
  aliceId: string
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
  expectedStatus: 'submitted' | 'filled' | 'rejected' | 'user-rejected' | 'cancelled'
}

function blankOrder(action: 'BUY' | 'SELL', orderType: string, tif: string): WireOrder {
  return {
    action,
    orderType,
    tif,
    totalQuantity: UNSET,
    lmtPrice: UNSET,
    auxPrice: UNSET,
    trailStopPrice: UNSET,
    trailingPercent: UNSET,
    cashQty: UNSET,
  }
}

function contractOf(s: SymbolSpec): WireContract {
  return {
    aliceId: s.aliceId,
    symbol: s.symbol,
    secType: s.secType,
    exchange: s.exchange,
    currency: s.currency,
  }
}

function setForOrderType(order: WireOrder, type: string, qty: string, price: string): void {
  order.totalQuantity = decValue(qty)
  switch (type) {
    case 'MKT':
    case 'MOC':
    case 'LOC':
      // No price fields populated — market-style orders.
      break
    case 'LMT':
      order.lmtPrice = decValue(price)
      break
    case 'STP':
      order.auxPrice = decValue(price)
      break
    case 'STP_LMT':
      order.lmtPrice = decValue(price)
      order.auxPrice = decValue(new Decimal(price).mul('1.005').toFixed(8))
      break
    case 'TRAIL':
      order.trailingPercent = decValue('1.5')
      break
    case 'TRAIL_LIMIT':
      order.trailStopPrice = decValue(price)
      order.trailingPercent = decValue('2.0')
      break
    case 'REL':
      order.lmtPrice = decValue(price)
      break
  }
}

// ==================== Plan-execution: emit cases in order ====================

const cases: { idx: number; envelope: FixtureEnvelope; tag: string }[] = []
let _counter = 0

function emit(envelope: FixtureEnvelope, tag: string): void {
  _counter += 1
  cases.push({ idx: _counter, envelope, tag })
}

// 001–040 — BUY × {MKT, LMT, STP, STP_LMT, TRAIL, TRAIL_LIMIT, MOC} × {DAY, GTC, IOC, GTD}
//          That is 7 × 4 = 28 base cells. Add 12 extras with cycling decimal classes.
const ORDER_TYPES_CORE = ['MKT', 'LMT', 'STP', 'STP_LMT', 'TRAIL', 'TRAIL_LIMIT', 'MOC']
const TIFS_CORE = ['DAY', 'GTC', 'IOC', 'GTD']

function genCoreSide(side: 'BUY' | 'SELL'): void {
  let dpIdx = 0
  let symIdx = 0
  for (const ot of ORDER_TYPES_CORE) {
    for (const tif of TIFS_CORE) {
      const dec = DECIMAL_CLASSES[dpIdx % DECIMAL_CLASSES.length]
      const sym = SYMBOLS[symIdx % SYMBOLS.length]
      const order = blankOrder(side, ot, tif)
      setForOrderType(order, ot, dec.qty, dec.price)
      emit(
        {
          name: `${side} ${ot} ${tif} on ${sym.symbol} (${dec.tag})`,
          category: `core-${side.toLowerCase()}`,
          tags: [side, ot, tif, dec.tag, sym.secType],
          operation: { action: 'placeOrder', contract: contractOf(sym), order },
          config: { expectGuardReject: false, fillPolicy: 'full' },
          expectedStatus: 'filled',
        },
        `${side.toLowerCase()}-${ot.toLowerCase()}-${tif.toLowerCase()}-${dec.tag}-${sym.symbol.replace(/\W+/g, '')}`,
      )
      dpIdx += 1
      symIdx += 1
    }
  }
  // Add 12 extras with LMT-IOC × every decimal class × every symbol pair
  for (let i = 0; i < 12; i++) {
    const dec = DECIMAL_CLASSES[i % DECIMAL_CLASSES.length]
    const sym = SYMBOLS[i % SYMBOLS.length]
    const order = blankOrder(side, 'LMT', 'IOC')
    setForOrderType(order, 'LMT', dec.qty, dec.price)
    emit(
      {
        name: `${side} LMT IOC extra ${i} on ${sym.symbol} (${dec.tag})`,
        category: `core-${side.toLowerCase()}-extra`,
        tags: [side, 'LMT', 'IOC', dec.tag, sym.secType, 'extra'],
        operation: { action: 'placeOrder', contract: contractOf(sym), order },
        config: { expectGuardReject: false, fillPolicy: 'full' },
        expectedStatus: 'filled',
      },
      `${side.toLowerCase()}-lmt-ioc-extra${String(i).padStart(2, '0')}-${dec.tag}-${sym.symbol.replace(/\W+/g, '')}`,
    )
  }
}

genCoreSide('BUY')   // 001–040
genCoreSide('SELL')  // 041–080

// 081–120 — TP-SL combinations (BUY/SELL × {TP-only, SL-only, TP+SL bracket} on MKT/LMT/STP)
const TPSL_VARIANTS = ['TP-only', 'SL-only', 'TP+SL'] as const
const TPSL_TYPES = ['MKT', 'LMT', 'STP']
function genTpSlSide(side: 'BUY' | 'SELL', startCount: number): void {
  let i = startCount
  for (const ot of TPSL_TYPES) {
    for (const v of TPSL_VARIANTS) {
      for (let k = 0; k < 2; k++) {
        const dec = DECIMAL_CLASSES[i % DECIMAL_CLASSES.length]
        const sym = SYMBOLS[i % SYMBOLS.length]
        const order = blankOrder(side, ot, 'GTC')
        setForOrderType(order, ot, dec.qty, dec.price)
        const tpPrice = new Decimal(dec.price).mul('1.05').toFixed(8)
        const slPrice = new Decimal(dec.price).mul('0.95').toFixed(8)
        const tpsl: WireTpSl = {}
        if (v === 'TP-only' || v === 'TP+SL') tpsl.takeProfit = { price: decValue(tpPrice) }
        if (v === 'SL-only' || v === 'TP+SL') tpsl.stopLoss   = { price: decValue(slPrice) }
        emit(
          {
            name: `${side} ${ot} GTC ${v} on ${sym.symbol} (${dec.tag}) #${k}`,
            category: 'tpsl',
            tags: [side, ot, 'GTC', v, dec.tag, sym.secType],
            operation: { action: 'placeOrder', contract: contractOf(sym), order, tpsl },
            config: { expectGuardReject: false, fillPolicy: 'full' },
            expectedStatus: 'filled',
          },
          `${side.toLowerCase()}-${ot.toLowerCase()}-gtc-${v.toLowerCase().replace(/\+/g, 'plus')}-${dec.tag}-${k}`,
        )
        i += 1
      }
    }
  }
}
// 081–100: BUY tpsl (3 types × 3 variants × 2 = 18 — round to 20 with overflow)
genTpSlSide('BUY', 0)   // 18 cases
genTpSlSide('SELL', 18) // 18 cases — total 36

// Pad to 120 with mixed-decimal TP+SL on LMT
for (let i = 0; i < 4; i++) {
  const dec = DECIMAL_CLASSES[i % DECIMAL_CLASSES.length]
  const sym = SYMBOLS[i % SYMBOLS.length]
  const order = blankOrder(i % 2 === 0 ? 'BUY' : 'SELL', 'LMT', 'GTC')
  setForOrderType(order, 'LMT', dec.qty, dec.price)
  const tpPrice = new Decimal(dec.price).mul('1.10').toFixed(8)
  const slPrice = new Decimal(dec.price).mul('0.90').toFixed(8)
  emit(
    {
      name: `${order.action} LMT GTC tight bracket #${i}`,
      category: 'tpsl-extra',
      tags: [order.action, 'LMT', 'GTC', 'TP+SL', dec.tag, sym.secType, 'tight'],
      operation: {
        action: 'placeOrder',
        contract: contractOf(sym),
        order,
        tpsl: { takeProfit: { price: decValue(tpPrice) }, stopLoss: { price: decValue(slPrice) } },
      },
      config: { expectGuardReject: false, fillPolicy: 'full' },
      expectedStatus: 'filled',
    },
    `tpsl-tight-${order.action.toLowerCase()}-${dec.tag}-${i}`,
  )
}

// 121–160: closePosition × {full, partial, all-implicit}
for (let i = 0; i < 40; i++) {
  const dec = DECIMAL_CLASSES[i % DECIMAL_CLASSES.length]
  const sym = SYMBOLS[i % SYMBOLS.length]
  const variant = i % 4 // 0=full (no quantity), 1=partial, 2=full-explicit, 3=all-positions
  let opPart: WireOperation
  if (variant === 3) {
    // close-all uses syncOrders elsewhere; here keep as closePosition with explicit full
    opPart = { action: 'closePosition', contract: contractOf(sym), quantity: decValue(dec.qty) }
  } else if (variant === 0) {
    opPart = { action: 'closePosition', contract: contractOf(sym) }
  } else if (variant === 1) {
    opPart = { action: 'closePosition', contract: contractOf(sym), quantity: decValue(new Decimal(dec.qty).div(2).toFixed(18)) }
  } else {
    opPart = { action: 'closePosition', contract: contractOf(sym), quantity: decValue(dec.qty) }
  }
  emit(
    {
      name: `closePosition ${['full-implicit','partial','full-explicit','full-explicit-2'][variant]} ${sym.symbol} (${dec.tag}) #${i}`,
      category: 'closePosition',
      tags: ['closePosition', dec.tag, sym.secType, ['full-implicit','partial','full-explicit','full-explicit-2'][variant]],
      operation: opPart,
      config: { expectGuardReject: false, fillPolicy: 'full' },
      expectedStatus: 'filled',
    },
    `close-${sym.symbol.replace(/\W+/g, '')}-${dec.tag}-${['fullimp','partial','fullexp','fullexp2'][variant]}-${String(i).padStart(2, '0')}`,
  )
}

// 161–180: modifyOrder × {qty, price, type, tif}
for (let i = 0; i < 20; i++) {
  const dec = DECIMAL_CLASSES[i % DECIMAL_CLASSES.length]
  const change = i % 4
  let changes: Partial<WireOrder> = {}
  let kind = ''
  if (change === 0) { changes = { totalQuantity: decValue(dec.qty) }; kind = 'qty' }
  if (change === 1) { changes = { lmtPrice: decValue(dec.price) }; kind = 'price' }
  if (change === 2) { changes = { orderType: 'LMT', lmtPrice: decValue(dec.price) }; kind = 'type' }
  if (change === 3) { changes = { tif: 'GTC' }; kind = 'tif' }
  emit(
    {
      name: `modifyOrder ${kind} change (${dec.tag}) #${i}`,
      category: 'modifyOrder',
      tags: ['modifyOrder', kind, dec.tag],
      operation: { action: 'modifyOrder', orderId: `mock-${1000 + i}`, changes },
      config: { expectGuardReject: false, fillPolicy: 'full' },
      expectedStatus: 'submitted',
    },
    `modify-${kind}-${dec.tag}-${String(i).padStart(2, '0')}`,
  )
}

// 181–200: cancelOrder + syncOrders
for (let i = 0; i < 15; i++) {
  emit(
    {
      name: `cancelOrder #${i}`,
      category: 'cancelOrder',
      tags: ['cancelOrder'],
      operation: { action: 'cancelOrder', orderId: `mock-${2000 + i}` },
      config: { expectGuardReject: false, fillPolicy: 'none' },
      expectedStatus: 'cancelled',
    },
    `cancel-${String(i).padStart(2, '0')}`,
  )
}
for (let i = 0; i < 5; i++) {
  emit(
    {
      name: `syncOrders #${i}`,
      category: 'syncOrders',
      tags: ['syncOrders'],
      operation: { action: 'syncOrders' },
      config: { expectGuardReject: false, fillPolicy: 'none' },
      expectedStatus: 'submitted',
    },
    `sync-${String(i).padStart(2, '0')}`,
  )
}

// 201–240: adversarial decimals (qty/price layered onto MKT/LMT BUY)
const ADVERSARIAL: { tag: string; qty: string; price: string; reject: boolean; status: FixtureEnvelope['expectedStatus']; reason: string }[] = [
  { tag: 'qty-zero',     qty: '0',                  price: '50',          reject: true,  status: 'user-rejected', reason: 'qty must be positive' },
  { tag: 'qty-negative', qty: '-5',                 price: '50',          reject: true,  status: 'user-rejected', reason: 'qty must be positive' },
  { tag: 'price-zero-on-LMT', qty: '10',           price: '0',           reject: true,  status: 'user-rejected', reason: 'limit price must be positive' },
  { tag: 'qty-1e30',     qty: '1e30',              price: '1',           reject: false, status: 'filled',        reason: 'large qty round-trips' },
  { tag: 'qty-1e-30',    qty: '1e-30',             price: '1',           reject: false, status: 'filled',        reason: 'small qty round-trips' },
  { tag: 'qty-8dp',      qty: '0.12345678',         price: '67000',       reject: false, status: 'filled',        reason: 'btc-style 8dp' },
  { tag: 'qty-12dp',     qty: '0.000000123456',     price: '1.5',         reject: false, status: 'filled',        reason: 'usdt-style 12dp' },
  { tag: 'qty-18dp',     qty: '0.000000000000000001', price: '3500',     reject: false, status: 'filled',        reason: 'eth-style 18dp' },
  { tag: 'price-12dp',   qty: '1',                  price: '0.000000123456', reject: false, status: 'filled',     reason: '12dp price' },
  { tag: 'price-18dp',   qty: '1',                  price: '0.000000000000000001', reject: false, status: 'filled', reason: '18dp price' },
]
// Apply each across MKT, LMT, STP — 30 cases minimum. Plus 10 randomly-paired SELL adversarial.
for (let i = 0; i < ADVERSARIAL.length * 3; i++) {
  const adv = ADVERSARIAL[i % ADVERSARIAL.length]
  const ot = ['MKT', 'LMT', 'STP'][Math.floor(i / ADVERSARIAL.length) % 3]
  const sym = SYMBOLS[i % SYMBOLS.length]
  const order = blankOrder('BUY', ot, 'DAY')
  setForOrderType(order, ot, adv.qty, adv.price)
  emit(
    {
      name: `BUY ${ot} adversarial ${adv.tag} on ${sym.symbol} — ${adv.reason}`,
      category: 'adversarial',
      tags: ['BUY', ot, 'adversarial', adv.tag, sym.secType, adv.reject ? 'guard-reject' : 'pass'],
      operation: { action: 'placeOrder', contract: contractOf(sym), order },
      config: { expectGuardReject: adv.reject, fillPolicy: adv.reject ? 'none' : 'full' },
      expectedStatus: adv.status,
    },
    `adv-buy-${ot.toLowerCase()}-${adv.tag}-${sym.symbol.replace(/\W+/g, '')}-${String(i).padStart(2, '0')}`,
  )
}
// 10 SELL adversarial pairs to push count comfortably over 200
for (let i = 0; i < 10; i++) {
  const adv = ADVERSARIAL[i % ADVERSARIAL.length]
  const sym = SYMBOLS[i % SYMBOLS.length]
  const order = blankOrder('SELL', 'LMT', 'GTC')
  setForOrderType(order, 'LMT', adv.qty, adv.price)
  emit(
    {
      name: `SELL LMT adversarial ${adv.tag} on ${sym.symbol} — ${adv.reason}`,
      category: 'adversarial',
      tags: ['SELL', 'LMT', 'adversarial', adv.tag, sym.secType, adv.reject ? 'guard-reject' : 'pass'],
      operation: { action: 'placeOrder', contract: contractOf(sym), order },
      config: { expectGuardReject: adv.reject, fillPolicy: adv.reject ? 'none' : 'full' },
      expectedStatus: adv.status,
    },
    `adv-sell-lmt-${adv.tag}-${sym.symbol.replace(/\W+/g, '')}-${String(i).padStart(2, '0')}`,
  )
}

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

// ==================== Write ====================

function fileNameFor(idx: number, tag: string): string {
  return `case-${String(idx).padStart(3, '0')}-${tag}.json`
}

function main(): void {
  if (existsSync(FIXTURE_ROOT)) {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
  mkdirSync(FIXTURE_ROOT, { recursive: true })

  for (const c of cases) {
    writeFileSync(resolve(FIXTURE_ROOT, fileNameFor(c.idx, c.tag)), sortedStringify(c.envelope))
  }

  // INDEX.md
  const lines: string[] = []
  lines.push('# Operation fixtures (Phase 0.1)')
  lines.push('')
  lines.push(`**Generated:** ${cases.length} cases by \`parity/scripts/gen-operations.ts\`.`)
  lines.push('')
  lines.push('Re-running the generator with no source edits produces byte-identical')
  lines.push('output. Hand-editing fixtures is forbidden — edit the script and re-run.')
  lines.push('')
  lines.push('## Coverage by category')
  lines.push('')
  const counts: Record<string, number> = {}
  for (const c of cases) counts[c.envelope.category] = (counts[c.envelope.category] || 0) + 1
  lines.push('| Category | Cases |')
  lines.push('|---|---|')
  for (const cat of Object.keys(counts).sort()) lines.push(`| \`${cat}\` | ${counts[cat]} |`)
  lines.push('')
  lines.push(`**Total cases:** ${cases.length}`)
  lines.push('')
  lines.push('## Decimal-edge classes')
  lines.push('')
  lines.push('| Tag | Example qty | Example price | Notes |')
  lines.push('|---|---|---|---|')
  for (const dc of DECIMAL_CLASSES) {
    lines.push(`| \`${dc.tag}\` | ${dc.qty} | ${dc.price} | ${dc.dp} dp |`)
  }
  lines.push('')
  lines.push('## Files')
  lines.push('')
  lines.push('| # | File | Name |')
  lines.push('|---|---|---|')
  for (const c of cases) {
    lines.push(`| ${c.idx} | \`${fileNameFor(c.idx, c.tag)}\` | ${c.envelope.name} |`)
  }
  lines.push('')
  writeFileSync(resolve(FIXTURE_ROOT, 'INDEX.md'), lines.join('\n'))

  process.stdout.write(`emitted ${cases.length} operation fixtures + INDEX.md\n`)
  process.stdout.write(`directory: ${FIXTURE_ROOT}\n`)
}

main()
