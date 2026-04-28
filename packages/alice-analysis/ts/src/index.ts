// Public surface for `@traderalice/alice-analysis`.
//
// Two layers:
//   1. Raw kernels  — direct calls into Rust math, sync, hot path.
//   2. evaluateFormula — full parser + evaluator, async, drives a JS callback.
//
// Plus `safeCalculate` and the `AnalysisError` class.
//
// The wire-decimal codec (`encodeDecimal`, `decodeDecimal`, `validateWireDecimal`,
// `addWireDecimals`) moved to `@traderalice/alice-decimal` as part of stage-2's
// Q-EXTRACT (task #11). We re-export the same names here for back-compat —
// existing consumers of `@traderalice/alice-analysis` continue to import them
// without code changes.

export { AnalysisError, type AnalysisErrorCode } from './errors.js'
export {
  encodeDecimal,
  decodeDecimal,
  validateWireDecimal,
  addWireDecimals,
  DecimalError,
  type DecimalErrorCode,
} from '@traderalice/alice-decimal'
export {
  version,
  smaRaw,
  emaRaw,
  stdevRaw,
  maxRaw,
  minRaw,
  sumRaw,
  averageRaw,
  rsiRaw,
  bbandsRaw,
  macdRaw,
  atrRaw,
} from './native.js'

import { rehydrateRustError } from './errors.js'
import {
  evaluateFormulaNative,
  safeCalculate as nativeSafeCalculate,
} from './native.js'

/** Source metadata for one OHLCV column (mirrors the TS `DataSourceMeta`). */
export interface DataSourceMeta {
  symbol: string
  from: string
  to: string
  bars: number
}

/** Field name used by the fetcher callback. */
export type OhlcvField = 'close' | 'open' | 'high' | 'low' | 'volume'

/** Callback shape required by `evaluateFormula`. */
export type DataFetcher = (
  symbol: string,
  interval: string,
  field: OhlcvField,
) => Promise<{ values: Float64Array; source: DataSourceMeta }>

/** Tagged union mirroring the napi result. */
export type FormulaValue =
  | { kind: 'number'; n: number }
  | { kind: 'array'; a: number[]; arraySource: DataSourceMeta }
  | { kind: 'object'; o: Record<string, number> }

export interface FormulaResult {
  value: FormulaValue
  dataRange: Record<string, DataSourceMeta>
}

/**
 * Evaluate a formula. Wraps `evaluateFormulaNative` with idiomatic types and
 * peels Rust error envelopes into typed `AnalysisError` instances.
 */
export async function evaluateFormula(
  formula: string,
  fetcher: DataFetcher,
  precision = 4,
): Promise<FormulaResult> {
  let raw: Awaited<ReturnType<typeof evaluateFormulaNative>>
  try {
    raw = await evaluateFormulaNative(
      formula,
      // The Rust side passes the field as a string; widen it before handing to
      // user code, which expects the typed union.
      (symbol, interval, field) =>
        fetcher(symbol, interval, field as OhlcvField),
      precision,
    )
  } catch (e) {
    rehydrateRustError(e)
  }
  let value: FormulaValue
  switch (raw.kind) {
    case 'number':
      value = { kind: 'number', n: raw.n as number }
      break
    case 'array':
      value = {
        kind: 'array',
        a: (raw.a as number[]).slice(),
        arraySource: raw.arraySource as DataSourceMeta,
      }
      break
    case 'object':
      value = { kind: 'object', o: { ...(raw.o as Record<string, number>) } }
      break
  }
  return { value, dataRange: { ...raw.dataRange } }
}

/** Safe arithmetic evaluator — `+ - * / ( )`, decimals, whitespace. 4-decimal precision. */
export function safeCalculate(expression: string): number {
  try {
    return nativeSafeCalculate(expression)
  } catch (e) {
    rehydrateRustError(e)
  }
}
