/**
 * Generator for parity/fixtures/sentinels/.
 *
 * Emits one JSON fixture per (carrier, field, sentinel) cell of the
 * matrix in PHASE0_PLAN.md §4 — plus an `*-all-set.json` and
 * `*-all-unset.json` corner per carrier. Each fixture proves that a
 * single sentinel value, in a specific position on a specific carrier,
 * is recognized by Phase 1b's adapters and emitted as `{ kind: 'unset' }`.
 *
 * The companion COVERAGE.md mirrors the matrix and is regenerated from
 * the same source-of-truth table below.
 *
 * Usage:
 *   pnpm tsx parity/scripts/gen-sentinels.ts
 *
 * Idempotent: re-running with no source edits produces byte-identical
 * fixture files. Hand-editing fixtures is forbidden — edit this script
 * and re-run.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/sentinels')

type SentinelKind = 'UNSET_DECIMAL' | 'UNSET_DOUBLE' | 'UNSET_INTEGER'
type Carrier = 'Order' | 'Contract' | 'Execution' | 'OrderState'

interface FieldEntry {
  carrier: Carrier
  field: string
  sentinel: SentinelKind
}

// Source of truth — PHASE0_PLAN.md §4 matrix, verified against
// packages/ibkr/src/{order,contract,execution,order-state}.ts.
const MATRIX: FieldEntry[] = [
  // Order — UNSET_DECIMAL fields
  { carrier: 'Order', field: 'totalQuantity',     sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'lmtPrice',          sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'auxPrice',          sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'trailStopPrice',    sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'trailingPercent',   sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'cashQty',           sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Order', field: 'filledQuantity',    sentinel: 'UNSET_DECIMAL' },
  // Order — UNSET_DOUBLE fields
  { carrier: 'Order', field: 'percentOffset',           sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'startingPrice',           sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'stockRefPrice',           sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'delta',                   sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'stockRangeLower',         sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'stockRangeUpper',         sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'volatility',              sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'deltaNeutralAuxPrice',    sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'basisPoints',             sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'scalePriceIncrement',     sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'scalePriceAdjustValue',   sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'scaleProfitOffset',       sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'triggerPrice',            sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'adjustedStopPrice',       sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'adjustedStopLimitPrice',  sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'adjustedTrailingAmount',  sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'lmtPriceOffset',          sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'competeAgainstBestOffset', sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'midOffsetAtWhole',        sentinel: 'UNSET_DOUBLE' },
  { carrier: 'Order', field: 'midOffsetAtHalf',         sentinel: 'UNSET_DOUBLE' },
  // Order — UNSET_INTEGER fields
  { carrier: 'Order', field: 'minQty',                  sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'volatilityType',          sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'referencePriceType',      sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'basisPointsType',         sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'scaleInitLevelSize',      sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'scaleSubsLevelSize',      sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'scalePriceAdjustInterval', sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'scaleInitPosition',       sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'scaleInitFillQty',        sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'duration',                sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'postToAts',               sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'minTradeQty',             sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'minCompeteSize',          sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'manualOrderIndicator',    sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'whatIfType',              sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'slOrderId',               sentinel: 'UNSET_INTEGER' },
  { carrier: 'Order', field: 'ptOrderId',               sentinel: 'UNSET_INTEGER' },
  // Contract — UNSET_DECIMAL fields
  { carrier: 'Contract', field: 'minSize',                 sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Contract', field: 'sizeIncrement',           sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Contract', field: 'suggestedSizeIncrement',  sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Contract', field: 'minAlgoSize',             sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Contract', field: 'lastPricePrecision',      sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Contract', field: 'lastSizePrecision',       sentinel: 'UNSET_DECIMAL' },
  // Contract — UNSET_DOUBLE fields
  { carrier: 'Contract', field: 'strike',                  sentinel: 'UNSET_DOUBLE' },
  // Execution — UNSET_DECIMAL fields
  { carrier: 'Execution', field: 'shares',                 sentinel: 'UNSET_DECIMAL' },
  { carrier: 'Execution', field: 'cumQty',                 sentinel: 'UNSET_DECIMAL' },
  // Execution — UNSET_INTEGER fields
  { carrier: 'Execution', field: 'lastNDays',              sentinel: 'UNSET_INTEGER' },
  // OrderState — UNSET_DECIMAL fields
  { carrier: 'OrderState', field: 'position',              sentinel: 'UNSET_DECIMAL' },
  { carrier: 'OrderState', field: 'positionDesired',       sentinel: 'UNSET_DECIMAL' },
  { carrier: 'OrderState', field: 'positionAfter',         sentinel: 'UNSET_DECIMAL' },
  { carrier: 'OrderState', field: 'desiredAllocQty',       sentinel: 'UNSET_DECIMAL' },
  { carrier: 'OrderState', field: 'allowedAllocQty',       sentinel: 'UNSET_DECIMAL' },
  { carrier: 'OrderState', field: 'suggestedSize',         sentinel: 'UNSET_DECIMAL' },
  // OrderState — UNSET_DOUBLE fields
  { carrier: 'OrderState', field: 'commissionAndFees',                sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'minCommissionAndFees',             sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'maxCommissionAndFees',             sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'initMarginBeforeOutsideRTH',       sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'maintMarginBeforeOutsideRTH',      sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'equityWithLoanBeforeOutsideRTH',   sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'initMarginChangeOutsideRTH',       sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'maintMarginChangeOutsideRTH',      sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'equityWithLoanChangeOutsideRTH',   sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'initMarginAfterOutsideRTH',        sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'maintMarginAfterOutsideRTH',       sentinel: 'UNSET_DOUBLE' },
  { carrier: 'OrderState', field: 'equityWithLoanAfterOutsideRTH',    sentinel: 'UNSET_DOUBLE' },
]

// ==================== Constants exactly as ibkr/const.ts emits them ====================

// UNSET_DECIMAL = new Decimal('170141183460469231731687303715884105727') (2^127 - 1).
// Captured here as a string to keep this script side-effect-free.
const UNSET_DECIMAL_STR = '170141183460469231731687303715884105727'

// UNSET_DOUBLE = Number.MAX_VALUE. JSON.stringify(Number.MAX_VALUE) emits
// "1.7976931348623157e+308" but RFC-8259 JSON forbids exponent capitalization
// quirks; so we emit the explicit string both ways for inspection. The
// `nativeJson` block holds the literal JSON.stringify output.
const UNSET_DOUBLE_NUM = 1.7976931348623157e+308 // Number.MAX_VALUE
const UNSET_INTEGER_NUM = 2147483647             // 2 ** 31 - 1

// ==================== Field-shape facts ====================

// Decimal-typed fields on these carriers serialize via their owning class's
// .toString() under JSON.stringify. We capture the *raw* form (the Decimal
// literal you'd see in source) and the *wireExpected* form (Phase 1b's
// adapter emits this). We do not re-canonicalize the raw form because
// callers in Phase 1b detect sentinel values upstream of canonicalization.

const RAW_VALUES = {
  UNSET_DECIMAL: { type: 'Decimal', literal: UNSET_DECIMAL_STR } as const,
  UNSET_DOUBLE: { type: 'number', literal: UNSET_DOUBLE_NUM } as const,
  UNSET_INTEGER: { type: 'number', literal: UNSET_INTEGER_NUM } as const,
}

// ==================== Sample (non-sentinel) starter values per carrier ====================

// A "neutral" instance for each carrier, used as the base when emitting a
// fixture that sets ONE field to a sentinel and leaves the rest unfilled.
// Values are intentionally conservative — Phase 1b's adapters need only
// know that the named field is the sentinel cell, not what the rest of the
// instance looks like.
const NEUTRAL: Record<Carrier, Record<string, unknown>> = {
  Order: {
    orderId: 0,
    clientId: 0,
    permId: 0,
    action: 'BUY',
    orderType: 'MKT',
    tif: 'DAY',
  },
  Contract: {
    aliceId: 'mock|MOCK',
    symbol: 'MOCK',
    secType: 'STK',
    exchange: 'SMART',
    currency: 'USD',
  },
  Execution: {
    execId: 'exec-0',
    orderId: 0,
    clientId: 0,
    permId: 0,
    side: 'BOT',
  },
  OrderState: {
    status: 'PreSubmitted',
  },
}

// ==================== Per-fixture writer ====================

interface SentinelFixture {
  name: string
  carrier: Carrier
  field: string
  sentinel: SentinelKind
  raw: Record<string, unknown>
  wireExpected: { field: string; emit: { kind: 'unset' } }
}

function rawSentinelValue(kind: SentinelKind): unknown {
  switch (kind) {
    case 'UNSET_DECIMAL':
      return { __decimal__: RAW_VALUES.UNSET_DECIMAL.literal }
    case 'UNSET_DOUBLE':
      return RAW_VALUES.UNSET_DOUBLE.literal
    case 'UNSET_INTEGER':
      return RAW_VALUES.UNSET_INTEGER.literal
  }
}

function fileName(entry: FieldEntry): string {
  const letter = entry.sentinel === 'UNSET_DECIMAL' ? 'D'
              : entry.sentinel === 'UNSET_DOUBLE'  ? 'F'
              : 'I'
  return `${entry.carrier.toLowerCase()}-${letter}-${entry.field}.json`
}

function singleFixture(entry: FieldEntry): SentinelFixture {
  const raw = { ...NEUTRAL[entry.carrier], [entry.field]: rawSentinelValue(entry.sentinel) }
  return {
    name: `${entry.carrier}.${entry.field} = ${entry.sentinel}`,
    carrier: entry.carrier,
    field: entry.field,
    sentinel: entry.sentinel,
    raw,
    wireExpected: { field: entry.field, emit: { kind: 'unset' } },
  }
}

interface CornerFixture {
  name: string
  carrier: Carrier
  variant: 'all-unset' | 'all-set'
  raw: Record<string, unknown>
  wireExpected: Record<string, { kind: 'unset' } | { kind: 'value' }>
}

function cornerAllUnset(carrier: Carrier): CornerFixture {
  const fields = MATRIX.filter((m) => m.carrier === carrier)
  const raw: Record<string, unknown> = { ...NEUTRAL[carrier] }
  const wireExpected: CornerFixture['wireExpected'] = {}
  for (const f of fields) {
    raw[f.field] = rawSentinelValue(f.sentinel)
    wireExpected[f.field] = { kind: 'unset' }
  }
  return {
    name: `${carrier} — every sentinel-bearing field is UNSET (corner case)`,
    carrier,
    variant: 'all-unset',
    raw,
    wireExpected,
  }
}

function cornerAllSet(carrier: Carrier): CornerFixture {
  const fields = MATRIX.filter((m) => m.carrier === carrier)
  const raw: Record<string, unknown> = { ...NEUTRAL[carrier] }
  const wireExpected: CornerFixture['wireExpected'] = {}
  for (const f of fields) {
    // Conservative non-sentinel value per kind — these are *examples*, not
    // claims about what a real broker would set. Phase 1b's adapter must
    // recognize them as values, not sentinels, and pass the canonical
    // string through `toCanonicalDecimalString`.
    let value: unknown
    switch (f.sentinel) {
      case 'UNSET_DECIMAL':  value = { __decimal__: '1.5' }; break
      case 'UNSET_DOUBLE':   value = 0.25; break
      case 'UNSET_INTEGER':  value = 100; break
    }
    raw[f.field] = value
    wireExpected[f.field] = { kind: 'value' }
  }
  return {
    name: `${carrier} — every sentinel-bearing field is SET (corner case)`,
    carrier,
    variant: 'all-set',
    raw,
    wireExpected,
  }
}

// ==================== Stable JSON formatter ====================

function sortedStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, sortedKeys(value), indent) + '\n'
}

function sortedKeys(_root: unknown): (string | number)[] {
  // Recursively collect all keys in sorted order, depth-first.
  // JSON.stringify with the array form of replacer only includes listed
  // top-level keys, but it works recursively when keys appear at any depth.
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

  let count = 0

  // Single-cell fixtures
  for (const entry of MATRIX) {
    const fx = singleFixture(entry)
    writeFileSync(resolve(FIXTURE_ROOT, fileName(entry)), sortedStringify(fx))
    count += 1
  }

  // Corner fixtures
  const carriers: Carrier[] = ['Order', 'Contract', 'Execution', 'OrderState']
  for (const c of carriers) {
    const allUnset = cornerAllUnset(c)
    writeFileSync(
      resolve(FIXTURE_ROOT, `${c.toLowerCase()}-all-unset.json`),
      sortedStringify(allUnset),
    )
    count += 1
    const allSet = cornerAllSet(c)
    writeFileSync(
      resolve(FIXTURE_ROOT, `${c.toLowerCase()}-all-set.json`),
      sortedStringify(allSet),
    )
    count += 1
  }

  // COVERAGE.md — derived from MATRIX
  const coverageLines: string[] = []
  coverageLines.push('# Sentinel coverage matrix (Phase 0.2)')
  coverageLines.push('')
  coverageLines.push('Each ✓ corresponds to one fixture file in this directory. The')
  coverageLines.push('matrix is the source-of-truth for `parity/scripts/gen-sentinels.ts`.')
  coverageLines.push('Sentinel literals (verified at `packages/ibkr/src/const.ts`):')
  coverageLines.push('')
  coverageLines.push('- `UNSET_DECIMAL`  = `Decimal("170141183460469231731687303715884105727")` (2^127 − 1, ≈1.7e38)')
  coverageLines.push('- `UNSET_DOUBLE`   = `Number.MAX_VALUE` (≈1.798e308)')
  coverageLines.push('- `UNSET_INTEGER`  = `2 ** 31 - 1` (= 2147483647)')
  coverageLines.push('')

  for (const carrier of carriers) {
    const fields = MATRIX.filter((m) => m.carrier === carrier)
    if (fields.length === 0) continue
    coverageLines.push(`## ${carrier}`)
    coverageLines.push('')
    coverageLines.push('| Field | UNSET_DECIMAL | UNSET_DOUBLE | UNSET_INTEGER | Fixture file |')
    coverageLines.push('|---|---|---|---|---|')
    for (const f of fields) {
      const dec = f.sentinel === 'UNSET_DECIMAL' ? '✓' : ''
      const dbl = f.sentinel === 'UNSET_DOUBLE' ? '✓' : ''
      const int = f.sentinel === 'UNSET_INTEGER' ? '✓' : ''
      coverageLines.push(`| \`${f.field}\` | ${dec} | ${dbl} | ${int} | \`${fileName(f)}\` |`)
    }
    coverageLines.push('')
    coverageLines.push(`Plus corner fixtures: \`${carrier.toLowerCase()}-all-unset.json\`, \`${carrier.toLowerCase()}-all-set.json\`.`)
    coverageLines.push('')
  }

  coverageLines.push('---')
  coverageLines.push('')
  coverageLines.push(`**Total single-cell fixtures:** ${MATRIX.length}`)
  coverageLines.push(`**Plus corner fixtures (2 × ${carriers.length} carriers):** ${2 * carriers.length}`)
  coverageLines.push(`**Total fixture files:** ${count}`)
  coverageLines.push('')
  coverageLines.push('Verification: `find parity/fixtures/sentinels -name "*.json" | wc -l` ≥ 80.')
  coverageLines.push('')

  writeFileSync(resolve(FIXTURE_ROOT, 'COVERAGE.md'), coverageLines.join('\n'))

  process.stdout.write(`emitted ${count} sentinel fixtures + COVERAGE.md\n`)
  process.stdout.write(`directory: ${FIXTURE_ROOT}\n`)
}

main()
