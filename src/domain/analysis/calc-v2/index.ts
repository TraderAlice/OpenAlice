/**
 * Quant Calculator v2 — public entry.
 *
 * A bounded Python/pandas-subset expression language for technical analysis,
 * keyed by barId so the model can target a specific source (or mix sources in
 * one script). v1 (`calculateIndicator`) stays untouched. On failure, returns a
 * structured diagnostic (kind + position + suggestion) instead of throwing.
 */

import { parse } from './parser.js'
import { evaluate, type CalcDeps, type CalcValue } from './evaluator.js'
import { CalcError, type CalcDiagnostic } from './errors.js'
import type { DataSourceMeta } from '../indicator/types.js'

export interface RunResult {
  value?: CalcValue
  /** Sources actually fetched, keyed by barId (source/provider/capability). */
  dataRange?: Record<string, DataSourceMeta>
  /** Per-source date axis (ascending) — present only when `dates` was requested. */
  dates?: Record<string, string[]>
  /** Present iff the script failed — actionable for self-correction. */
  error?: CalcDiagnostic
}

export async function runScript(
  script: string,
  deps: CalcDeps,
  precision = 4,
  opts: { withDates?: boolean } = {},
): Promise<RunResult> {
  try {
    const program = parse(script)
    const out = await evaluate(program, deps, opts)
    return {
      value: round(out.value, precision),
      dataRange: out.dataRange,
      ...(out.dates ? { dates: out.dates } : {}),
    }
  } catch (e) {
    if (e instanceof CalcError) return { error: e.diagnostic }
    throw e
  }
}

function round(v: CalcValue, precision: number): CalcValue {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toFixed(precision)) : v
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => round(x, precision))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x, precision)]))
}

export type { CalcDeps, CalcValue } from './evaluator.js'
export type { CalcDiagnostic, CalcErrorKind } from './errors.js'
export { CalcError } from './errors.js'
