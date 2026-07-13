/**
 * Quant Calculator v2 — evaluator.
 *
 * Walks the AST over a bound environment. `bars(...)` resolves through the
 * federated bar service (barId-keyed); indicator math is reused verbatim from
 * `../indicator/functions`. Total + side-effect-free: bindings are let* (each
 * may reference earlier ones); there is no mutation, control flow, or I/O.
 */

import type { Program, Expr } from './ast.js'
import { CalcError, didYouMean } from './errors.js'
import type { DataSourceMeta } from '../indicator/types.js'
import type { BarService, BarsResult, GetBarsOpts } from '../../market-data/bars/index.js'
import type { AssetClass } from '../../market-data/aggregate-search.js'
import * as Stat from '../indicator/functions/statistics.js'
import * as Tech from '../indicator/functions/technical.js'

export interface CalcDeps {
  barService: BarService
}

/** A returnable value: a scalar, a string label, a named record (e.g. bbands),
 *  a positional panel (list), or a labeled panel (dict). Recursive so panels can
 *  nest. */
export type CalcValue = number | string | CalcValue[] | { [k: string]: CalcValue }

export interface CalcOutput {
  value: CalcValue
  /** Sources actually fetched, keyed by barId. */
  dataRange: Record<string, DataSourceMeta>
  /** Per-source date axis (ascending), keyed by barId — only when withDates. Lets
   *  the caller map a dumped series back to dates without a second snapshot call. */
  dates?: Record<string, string[]>
}

export interface EvalOpts {
  /** Attach each source's date axis to the output (opt-in; off by default). */
  withDates?: boolean
}

// ---- runtime values ----

type Col = { values: number[]; source: DataSourceMeta }
type V =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'col'; col: Col }
  | { k: 'series'; barId: string; r: BarsResult }
  | { k: 'rec'; v: Record<string, number> }
  | { k: 'list'; items: CalcValue[] }
  | { k: 'dict'; map: Record<string, CalcValue> }

const SERIES_COLUMNS = ['open', 'high', 'low', 'close', 'volume'] as const
/** A panel (list/dict result) batches many computations in one call — but each
 *  entry is still a single value, so the output stays small. Cap the count.
 *  Raised from 50: dumping a multi-bar axis (one entry per bar) shouldn't have to
 *  split into two calls for a few months of dailies. */
const MAX_PANEL = 200

export async function evaluate(program: Program, deps: CalcDeps, opts: EvalOpts = {}): Promise<CalcOutput> {
  const env = new Map<string, V>()
  const dataRange: Record<string, DataSourceMeta> = {}
  const dates: Record<string, string[]> = {}

  const fetchBars = async (barId: string, fetchOpts: GetBarsOpts, assetClass: AssetClass | undefined): Promise<BarsResult> => {
    const ref = assetClass ? { barId, assetClass } : { barId }
    const r = await deps.barService.getBars(ref, fetchOpts)
    if (r.meta.barId) {
      dataRange[r.meta.barId] = r.meta
      if (opts.withDates) dates[r.meta.barId] = r.bars.map((b) => b.date)
    }
    return r
  }

  const evalExpr = async (e: Expr): Promise<V> => {
    switch (e.type) {
      case 'num': return { k: 'num', v: e.value }
      case 'str': return { k: 'str', v: e.value }
      case 'name': {
        const v = env.get(e.id)
        if (!v) {
          const s = didYouMean(e.id, [...env.keys()])
          throw new CalcError({ kind: 'undeclared-name', message: `"${e.id}" is not defined. Declared: [${[...env.keys()].join(', ') || 'none'}]`, line: e.pos.line, col: e.pos.col, suggestion: s ? `did you mean "${s}"?` : undefined })
        }
        return v
      }
      case 'unary': {
        const o = await evalExpr(e.operand)
        return { k: 'num', v: -asNum(o, '-', e.pos.line) }
      }
      case 'binary': {
        const l = asNum(await evalExpr(e.left), e.op, e.pos.line)
        const r = asNum(await evalExpr(e.right), e.op, e.pos.line)
        if (e.op === '/' && r === 0) throw new CalcError({ kind: 'type', message: 'Division by zero', line: e.pos.line })
        return { k: 'num', v: e.op === '+' ? l + r : e.op === '-' ? l - r : e.op === '*' ? l * r : l / r }
      }
      case 'attr': {
        const obj = await evalExpr(e.obj)
        if (obj.k !== 'series') {
          throw new CalcError({ kind: 'type', message: `".${e.name}" is only valid on a bars(...) series`, line: e.pos.line, col: e.pos.col, suggestion: e.name === 'iloc' ? 'use [-1] for the latest value' : undefined })
        }
        if (!(SERIES_COLUMNS as readonly string[]).includes(e.name)) {
          throw new CalcError({ kind: 'reflex', message: `Unknown series column ".${e.name}"`, line: e.pos.line, col: e.pos.col, suggestion: `columns are: ${SERIES_COLUMNS.join(', ')}` })
        }
        const values = obj.r.bars.map((b) => Number(b[e.name as keyof typeof b] ?? 0))
        return { k: 'col', col: { values, source: obj.r.meta } }
      }
      case 'index': {
        const obj = await evalExpr(e.obj)
        const idxV = await evalExpr(e.index)
        const idx = asNum(idxV, '[]', e.pos.line)
        if (!Number.isInteger(idx)) throw new CalcError({ kind: 'type', message: 'Index must be an integer', line: e.pos.line })
        const arr = obj.k === 'col' ? obj.col.values : null
        if (!arr) {
          if (obj.k === 'num') {
            throw new CalcError({ kind: 'reflex', message: 'Cannot index a scalar', line: e.pos.line, col: e.pos.col, suggestion: 'Indicators (sma/ema/rsi/…) already return the latest value — drop the [-1]. Only raw columns like s.close are series.' })
          }
          throw new CalcError({ kind: 'type', message: 'Indexing is only valid on a series column (e.g. s.close[-1])', line: e.pos.line, col: e.pos.col })
        }
        const at = idx < 0 ? arr.length + idx : idx
        if (at < 0 || at >= arr.length) throw new CalcError({ kind: 'insufficient-bars', message: `Index ${idx} out of range — the series has ${arr.length} bars`, line: e.pos.line })
        return { k: 'num', v: arr[at] }
      }
      case 'call': {
        if (e.callee === 'bars') return evalBars(e)
        return evalFunction(e)
      }
      case 'list': {
        if (e.elements.length > MAX_PANEL) throw new CalcError({ kind: 'type', message: `A panel takes at most ${MAX_PANEL} entries, got ${e.elements.length}`, line: e.pos.line })
        const items: CalcValue[] = []
        for (const el of e.elements) items.push(asLeaf(await evalExpr(el), el.pos.line))
        return { k: 'list', items }
      }
      case 'dict': {
        if (e.entries.length > MAX_PANEL) throw new CalcError({ kind: 'type', message: `A panel takes at most ${MAX_PANEL} entries, got ${e.entries.length}`, line: e.pos.line })
        const map: Record<string, CalcValue> = {}
        for (const ent of e.entries) map[ent.key] = asLeaf(await evalExpr(ent.value), ent.value.pos.line)
        return { k: 'dict', map }
      }
    }
  }

  const evalBars = async (e: Extract<Expr, { type: 'call' }>): Promise<V> => {
    const pos = e.args.filter((a) => !a.name).map((a) => a.value)
    const kw = new Map(e.args.filter((a) => a.name).map((a) => [a.name!, a.value]))
    if (pos.length < 2) throw new CalcError({ kind: 'arity', message: 'bars(barId, interval, ...) needs a barId and an interval', line: e.pos.line, col: e.pos.col, suggestion: 'e.g. bars("alpaca-paper|AAPL", "1d", count=250)' })
    const barId = asStr(await evalExpr(pos[0]), 'bars', 1, e.pos.line)
    const interval = asStr(await evalExpr(pos[1]), 'bars', 2, e.pos.line)
    const opts: GetBarsOpts = { interval }
    const count = kw.get('count'); if (count) opts.count = asNum(await evalExpr(count), 'count', e.pos.line)
    const asOf = kw.get('asOf'); if (asOf) opts.asOf = asStr(await evalExpr(asOf), 'asOf', 1, e.pos.line)
    const start = kw.get('start'); if (start) opts.start = asStr(await evalExpr(start), 'start', 1, e.pos.line)
    const end = kw.get('end'); if (end) opts.end = asStr(await evalExpr(end), 'end', 1, e.pos.line)
    const assetKw = kw.get('asset')
    const assetClass = assetKw ? (asStr(await evalExpr(assetKw), 'asset', 1, e.pos.line) as AssetClass) : undefined
    let r: BarsResult
    try {
      r = await fetchBars(barId, opts, assetClass)
    } catch (err) {
      // A bars(...) fetch failure is NOT a script bug — the expression is fine,
      // the data pipe failed (vendor rate-limit / network / bad barId). Tag it
      // 'data-source' (not 'type') and attach an operational next step so the
      // agent retries / switches source instead of rewriting a correct script.
      const detail = err instanceof Error ? err.message : String(err)
      throw new CalcError({ kind: 'data-source', message: `bars("${barId}") failed: ${detail}`, line: e.pos.line, col: e.pos.col, suggestion: barFetchSuggestion(detail) })
    }
    if (r.bars.length === 0) throw new CalcError({ kind: 'insufficient-bars', message: `bars("${barId}", "${interval}") returned no data`, line: e.pos.line, col: e.pos.col })
    return { k: 'series', barId, r }
  }

  const evalFunction = async (e: Extract<Expr, { type: 'call' }>): Promise<V> => {
    const spec = FUNCTIONS[e.callee]
    if (!spec) {
      const s = didYouMean(e.callee, [...Object.keys(FUNCTIONS), 'bars'])
      throw new CalcError({ kind: 'unknown-function', message: `Unknown function "${e.callee}"`, line: e.pos.line, col: e.pos.col, suggestion: s ? `did you mean "${s}"?` : undefined })
    }
    if (e.args.some((a) => a.name)) throw new CalcError({ kind: 'type', message: `${e.callee}(...) takes positional arguments only`, line: e.pos.line, col: e.pos.col })
    const args = await Promise.all(e.args.map((a) => evalExpr(a.value)))
    return spec(e.callee, args, e.pos.line)
  }

  for (const b of program.bindings) {
    env.set(b.name, await evalExpr(b.value))
  }
  const out = await evalExpr(program.result)
  const tail = opts.withDates ? { dataRange, dates } : { dataRange }
  switch (out.k) {
    case 'num': return { value: out.v, ...tail }
    case 'str': return { value: out.v, ...tail }
    case 'rec': return { value: out.v, ...tail }
    case 'list': return { value: out.items, ...tail }
    case 'dict': return { value: out.map, ...tail }
    default: {
      const what = out.k === 'series' ? 'a series' : 'a series column'
      throw new CalcError({ kind: 'type', message: `The result is ${what}, not a value — reduce it with [-1] or an indicator (e.g. sma(s.close, 50)), or return a panel like { "1h": rsi(s.close, 14) }`, line: program.result.pos.line })
    }
  }
}

/** Coerce a value used as a panel entry: must be a single value (not a raw
 *  series), so the panel stays small. */
function asLeaf(v: V, line: number): CalcValue {
  switch (v.k) {
    case 'num': return v.v
    case 'str': return v.v
    case 'rec': return v.v
    case 'list': return v.items
    case 'dict': return v.map
    default:
      throw new CalcError({ kind: 'type', message: 'A panel entry must be a single value — reduce a series with [-1] or an indicator (e.g. sma(s.close, 50))', line })
  }
}

// ---- coercions ----

function asNum(v: V, ctx: string, line: number): number {
  if (v.k === 'num') return v.v
  const got = v.k === 'col' ? 'series column' : v.k === 'series' ? 'series' : v.k === 'str' ? 'string' : 'record'
  throw new CalcError({ kind: 'type', message: `Expected a number for ${ctx}, got a ${got}`, line })
}
function asStr(v: V, fn: string, argIdx: number, line: number): string {
  if (v.k === 'str') return v.v
  throw new CalcError({ kind: 'type', message: `${fn} arg ${argIdx} must be a string`, line })
}

/**
 * Map a bars(...) fetch failure to an operational next step for the agent.
 * Matches the typed prefixes the data layer emits (RATE_LIMITED: /
 * NETWORK_UNREACHABLE:) — no coupling to the provider's error classes — so the
 * suggestion stays accurate whichever vendor/broker the barId resolved to.
 */
function barFetchSuggestion(detail: string): string {
  if (/^RATE_LIMITED:|rate.?limit|too many requests|\b429\b/i.test(detail)) {
    return 'Not a script error — the data source throttled/blocked this client. Wait a few minutes and retry, or switch source (an "fmp|<symbol>" barId if an FMP key is set, or a connected broker barId).'
  }
  if (/^NETWORK_UNREACHABLE:|cannot reach|unreachable|\bDNS\b|proxy/i.test(detail)) {
    return 'Not a script error — the data source was unreachable from this network. Do not retry blindly; try a different source, or surface the network/VPN issue to the user.'
  }
  return 'Not a script error in the math — check the barId is one returned by searchBars/searchContracts (vendor barIds also need asset=). If the source genuinely has no data for this symbol/interval, try another source.'
}

// ---- function registry (reuses indicator math) ----

type Fn = (name: string, args: V[], line: number) => V
const FUNCTIONS: Record<string, Fn> = buildFunctions()

function buildFunctions(): Record<string, Fn> {
  const col = (a: V | undefined, fn: string, i: number, line: number): Col => {
    if (!a || a.k !== 'col') throw new CalcError({ kind: 'type', message: `${fn} arg ${i} must be a series column (e.g. s.close)`, line })
    return a.col
  }
  const num = (a: V | undefined, fn: string, i: number, line: number): number => {
    if (!a || a.k !== 'num') throw new CalcError({ kind: 'type', message: `${fn} arg ${i} must be a number`, line })
    return a.v
  }
  const arity = (args: V[], min: number, max: number, fn: string, line: number) => {
    if (args.length < min || args.length > max) throw new CalcError({ kind: 'arity', message: `${fn} expects ${min === max ? min : `${min}-${max}`} argument${max === 1 ? '' : 's'}, got ${args.length}`, line })
  }
  const needBars = (c: Col, period: number, fn: string, line: number) => {
    if (c.values.length < period) throw new CalcError({ kind: 'insufficient-bars', message: `${fn}(period=${period}) needs ≥${period} bars, but the series has ${c.values.length}. Raise count= on bars(...) or shorten the period.`, line })
  }
  const n = (x: number): V => ({ k: 'num', v: x })
  const rec = (x: Record<string, number>): V => ({ k: 'rec', v: x })

  return {
    sma: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p, f, l); return n(Stat.SMA(c, p)) },
    ema: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p, f, l); return n(Stat.EMA(c, p)) },
    stdev: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.STDEV(col(a[0], f, 1, l))) },
    max: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.MAX(col(a[0], f, 1, l))) },
    min: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.MIN(col(a[0], f, 1, l))) },
    sum: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.SUM(col(a[0], f, 1, l))) },
    average: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.AVERAGE(col(a[0], f, 1, l))) },
    rsi: (f, a, l) => { arity(a, 1, 2, f, l); const c = col(a[0], f, 1, l), p = a[1] ? num(a[1], f, 2, l) : 14; needBars(c, p + 1, f, l); return n(Tech.RSI(c, p)) },
    bbands: (f, a, l) => { arity(a, 2, 3, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l), s = a[2] ? num(a[2], f, 3, l) : 2; needBars(c, p, f, l); return rec(Tech.BBANDS(c, p, s) as unknown as Record<string, number>) },
    macd: (f, a, l) => { arity(a, 4, 4, f, l); const c = col(a[0], f, 1, l), fa = num(a[1], f, 2, l), sl = num(a[2], f, 3, l), si = num(a[3], f, 4, l); needBars(c, sl + si, f, l); return rec(Tech.MACD(c, fa, sl, si) as unknown as Record<string, number>) },
    atr: (f, a, l) => { arity(a, 4, 4, f, l); const h = col(a[0], f, 1, l), lo = col(a[1], f, 2, l), c = col(a[2], f, 3, l), p = num(a[3], f, 4, l); needBars(c, p, f, l); return n(Tech.ATR(h, lo, c, p)) },
    rvol: (f, a, l) => { arity(a, 1, 2, f, l); const v = col(a[0], f, 1, l), p = a[1] ? num(a[1], f, 2, l) : 20; needBars(v, p + 1, f, l); return n(Tech.RVOL(v, p)) },
    obv: (f, a, l) => { arity(a, 2, 2, f, l); return n(Tech.OBV(col(a[0], f, 1, l), col(a[1], f, 2, l))) },
    mfi: (f, a, l) => { arity(a, 4, 5, f, l); const h = col(a[0], f, 1, l), lo = col(a[1], f, 2, l), c = col(a[2], f, 3, l), v = col(a[3], f, 4, l), p = a[4] ? num(a[4], f, 5, l) : 14; needBars(c, p + 1, f, l); return n(Tech.MFI(h, lo, c, v, p)) },
    vwap: (f, a, l) => { arity(a, 4, 4, f, l); return n(Tech.VWAP(col(a[0], f, 1, l), col(a[1], f, 2, l), col(a[2], f, 3, l), col(a[3], f, 4, l))) },
    median: (f, a, l) => { arity(a, 1, 1, f, l); return n(Stat.MEDIAN(col(a[0], f, 1, l))) },
    roc: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p + 1, f, l); return n(Stat.ROC(c, p)) },
    zscore: (f, a, l) => { arity(a, 1, 2, f, l); const c = col(a[0], f, 1, l), p = a[1] ? num(a[1], f, 2, l) : undefined; if (p) needBars(c, p, f, l); return n(Stat.ZSCORE(c, p)) },
    slope: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p, f, l); return n(Stat.SLOPE(c, p)) },
    correlation: (f, a, l) => { arity(a, 2, 2, f, l); return n(Stat.CORRELATION(col(a[0], f, 1, l), col(a[1], f, 2, l))) },
    highest: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p, f, l); return n(Stat.HIGHEST(c, p)) },
    lowest: (f, a, l) => { arity(a, 2, 2, f, l); const c = col(a[0], f, 1, l), p = num(a[1], f, 2, l); needBars(c, p, f, l); return n(Stat.LOWEST(c, p)) },
  }
}
