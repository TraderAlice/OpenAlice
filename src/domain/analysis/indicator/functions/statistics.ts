/**
 * Statistics functions — 纯数学计算
 *
 * SMA, EMA, STDEV, MAX, MIN, SUM, AVERAGE
 * 接受 number[] 或 TrackedValues（自动提取 values）
 */

import { toValues, type TrackedValues } from '../types'
// OPE-19 finite-`number[]` reductions slice. Under
// `OPENALICE_RUST_ANALYSIS=1` the four reductions below
// (`MIN`, `MAX`, `SUM`, `AVERAGE`) route through the Rust
// `analysis_core` kernel after `toValues(...)` has produced a plain
// `number[]`. With the flag unset/`0`/invalid, the legacy TypeScript
// reductions remain authoritative per ADR-002. Non-finite arrays
// (`NaN` / `+/-Infinity`) come back as `{ kind: 'unsupported' }`
// and we silently fall back to the legacy TypeScript reduction so
// existing call sites behave identically.
//
// `SMA`, `EMA`, `STDEV`, and the technical indicators stay on the
// TypeScript path for OPE-19; this slice intentionally only covers the
// four bare reductions per the issue scope.
import {
  reduceNumbersSync as reduceNumbersSyncRust,
  type ReductionKind,
} from '../../../../../packages/node-bindings/analysis-core/index.js'

type NumericInput = number[] | TrackedValues

/**
 * Strict OPENALICE_RUST_ANALYSIS flag parser per ADR-002.
 *
 * Only the literal string `"1"` (after trimming whitespace) enables the
 * Rust route; every other state — unset, empty string, `"0"`, `"true"`,
 * `"yes"`, or any other value — keeps the legacy TypeScript path. This
 * mirrors the helper in `indicator/calculator.ts` so both ends of the
 * analysis_core surface read the flag identically.
 */
function shouldUseRustReductions(): boolean {
  const raw = process.env.OPENALICE_RUST_ANALYSIS
  if (typeof raw !== 'string') return false
  return raw.trim() === '1'
}

/**
 * Helper: under the flag, hand `values` (already `number[]`) to the
 * Rust kernel. On the `unsupported` envelope (non-finite elements) or
 * any other unexpected shape, returns `null` so the caller stays on
 * the legacy TypeScript reduction. We deliberately do not catch
 * `BindingReduceError` here — its `.message` is parity-locked with
 * the legacy `Error(...)`, so propagating it preserves the exact
 * existing error semantics for empty-array `MIN`/`MAX`/`AVERAGE`.
 */
function reduceViaRust(kind: ReductionKind, values: number[]): number | null {
  const outcome = reduceNumbersSyncRust(kind, values)
  if (outcome.kind === 'value') return outcome.value
  return null
}

/** Simple Moving Average */
export function SMA(data: NumericInput, period: number): number {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`SMA requires at least ${period} data points, got ${v.length}`)
  }
  const slice = v.slice(-period)
  const sum = slice.reduce((acc, val) => acc + val, 0)
  return sum / period
}

/** Exponential Moving Average */
export function EMA(data: NumericInput, period: number): number {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`EMA requires at least ${period} data points, got ${v.length}`)
  }
  const multiplier = 2 / (period + 1)
  let ema = v.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < v.length; i++) {
    ema = (v[i] - ema) * multiplier + ema
  }
  return ema
}

/** Standard Deviation */
export function STDEV(data: NumericInput): number {
  const v = toValues(data)
  if (v.length === 0) {
    throw new Error('STDEV requires at least 1 data point')
  }
  const mean = v.reduce((acc, val) => acc + val, 0) / v.length
  const variance = v.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / v.length
  return Math.sqrt(variance)
}

/** Maximum value */
export function MAX(data: NumericInput): number {
  const v = toValues(data)
  if (shouldUseRustReductions()) {
    const rust = reduceViaRust('MAX', v)
    if (rust !== null) return rust
  }
  if (v.length === 0) {
    throw new Error('MAX requires at least 1 data point')
  }
  return Math.max(...v)
}

/** Minimum value */
export function MIN(data: NumericInput): number {
  const v = toValues(data)
  if (shouldUseRustReductions()) {
    const rust = reduceViaRust('MIN', v)
    if (rust !== null) return rust
  }
  if (v.length === 0) {
    throw new Error('MIN requires at least 1 data point')
  }
  return Math.min(...v)
}

/** Sum */
export function SUM(data: NumericInput): number {
  const v = toValues(data)
  if (shouldUseRustReductions()) {
    const rust = reduceViaRust('SUM', v)
    if (rust !== null) return rust
  }
  return v.reduce((acc, val) => acc + val, 0)
}

/** Average */
export function AVERAGE(data: NumericInput): number {
  const v = toValues(data)
  if (shouldUseRustReductions()) {
    const rust = reduceViaRust('AVERAGE', v)
    if (rust !== null) return rust
  }
  if (v.length === 0) {
    throw new Error('AVERAGE requires at least 1 data point')
  }
  return v.reduce((acc, val) => acc + val, 0) / v.length
}
