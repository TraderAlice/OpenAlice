/**
 * simulate — the "if I'd entered here, with this exit, what happened" backtest.
 *
 * A path-dependent walk over dated bars from an entry date to `asOf` (no
 * lookahead past it), applying ONE built-in exit rule. Answers the recurring
 * retro question — "buy XLE on the war headline, does a trailing stop / MA break
 * save you?" — that was otherwise hand-rolled in Python every time.
 *
 * Built-in exit rules (v1):
 *   trailing_stop(pct)  exit when close falls `pct`% from the running peak close
 *   ma_break(period)    exit on the first close below its `period`-bar SMA
 *   stop(pct)           exit when close falls `pct`% below entry
 *   target(pct)         exit when close rises `pct`% above entry
 *   hold                never exit — measure entry → asOf
 *
 * Reports entry/exit (date·price·reason), return, MFE/MAE (max favorable/adverse
 * excursion), peak/trough, and a sampled path to narrate. Lives in
 * domain/analysis (analysis → market-data dependency direction).
 */

import type { BarService, BarSourceRef, BarSourceKind } from '@/domain/market-data/bars/index'

export type ExitRule =
  | { type: 'trailing_stop'; pct: number }
  | { type: 'ma_break'; period: number }
  | { type: 'stop'; pct: number }
  | { type: 'target'; pct: number }
  | { type: 'hold' }

export interface SimulateOpts {
  /** Enter at the close of the first bar on/after this date (YYYY-MM-DD). */
  entryDate: string
  exit: ExitRule
  interval?: string
  /** Evaluate only up to here (YYYY-MM-DD, no lookahead past it). Default: now. */
  asOf?: string
}

export interface SimulateResult {
  symbol: string
  barId?: string
  source?: BarSourceKind
  interval: string
  asOf: string
  rule: ExitRule
  entry: { date: string; price: number }
  exit: { date: string; price: number; reason: string } | null
  /** True when no exit triggered by asOf — position still open. */
  open: boolean
  barsHeld: number
  /** Entry → exit (or entry → last bar if still open), %. */
  returnPct: number
  /** Max favorable / adverse excursion over the hold, % (intrabar high/low vs entry). */
  mfePct: number
  maePct: number
  peak: { date: string; price: number }
  trough: { date: string; price: number }
  /** ≤20 sampled (date, close) points across the hold, for narration. */
  path: Array<{ date: string; close: number }>
  note?: string
}

function pct(a: number, b: number): number {
  return Number((((a - b) / b) * 100).toFixed(2))
}
function px(v: number): number {
  return Number(v.toFixed(4))
}

export async function simulate(
  barService: BarService,
  ref: BarSourceRef,
  opts: SimulateOpts,
): Promise<SimulateResult | { error: string }> {
  const interval = opts.interval ?? '1d'
  const rule = opts.exit
  // Pad the fetch window BEFORE the entry so an MA rule has history to define the
  // moving average at the entry bar. Non-MA rules don't need it (harmless).
  const lookback = rule.type === 'ma_break' ? rule.period : 0
  const bufferDays = Math.ceil((lookback + 10) * 1.6)
  const start = new Date(`${opts.entryDate}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - bufferDays)
  const startStr = start.toISOString().slice(0, 10)

  const { bars, meta } = await barService.getBars(ref, {
    interval,
    start: startStr,
    ...(opts.asOf ? { end: opts.asOf } : {}),
  })
  const asOf = meta.asOf ?? opts.asOf ?? new Date().toISOString().slice(0, 10)

  // First bar on/after the requested entry date.
  const entryIdx = bars.findIndex((b) => b.date.slice(0, 10) >= opts.entryDate)
  if (entryIdx === -1 || bars.length === 0) {
    return { error: `No bars on/after ${opts.entryDate} for ${meta.barId ?? meta.symbol} (window ${meta.from}…${meta.to}). Check the date and source.` }
  }
  const entryBar = bars[entryIdx]
  const entryPrice = entryBar.close
  const closes = bars.map((b) => b.close)

  const rollingSma = (i: number, period: number): number | null => {
    if (i - period + 1 < 0) return null
    let s = 0
    for (let k = i - period + 1; k <= i; k++) s += closes[k]
    return s / period
  }

  let peakClose = entryPrice
  let peak = { date: entryBar.date, price: entryPrice }
  let trough = { date: entryBar.date, price: entryPrice }
  let mfe = 0
  let mae = 0
  let exit: SimulateResult['exit'] = null

  for (let i = entryIdx; i < bars.length; i++) {
    const b = bars[i]
    // excursions use intrabar extremes vs entry
    mfe = Math.max(mfe, pct(b.high, entryPrice))
    mae = Math.min(mae, pct(b.low, entryPrice))
    if (b.high > peak.price) peak = { date: b.date, price: px(b.high) }
    if (b.low < trough.price) trough = { date: b.date, price: px(b.low) }
    if (b.close > peakClose) peakClose = b.close

    // exit checks evaluate from the bar AFTER entry (you can't exit the bar you enter on the close of)
    if (i === entryIdx) continue
    let reason: string | null = null
    switch (rule.type) {
      case 'trailing_stop':
        if (b.close <= peakClose * (1 - rule.pct / 100)) reason = `close ${px(b.close)} fell ${rule.pct}% from peak ${px(peakClose)}`
        break
      case 'ma_break': {
        const ma = rollingSma(i, rule.period)
        if (ma != null && b.close < ma) reason = `close ${px(b.close)} broke below SMA${rule.period} ${px(ma)}`
        break
      }
      case 'stop':
        if (b.close <= entryPrice * (1 - rule.pct / 100)) reason = `close ${px(b.close)} hit −${rule.pct}% stop`
        break
      case 'target':
        if (b.close >= entryPrice * (1 + rule.pct / 100)) reason = `close ${px(b.close)} hit +${rule.pct}% target`
        break
      case 'hold':
        break
    }
    if (reason) {
      exit = { date: b.date, price: px(b.close), reason }
      break
    }
  }

  const lastHeldIdx = exit ? bars.findIndex((b) => b.date === exit!.date) : bars.length - 1
  const exitPrice = exit ? exit.price : bars[bars.length - 1].close
  const barsHeld = lastHeldIdx - entryIdx
  const held = bars.slice(entryIdx, lastHeldIdx + 1)
  const step = Math.max(1, Math.ceil(held.length / 20))
  const path = held.filter((_, i) => i % step === 0 || i === held.length - 1).map((b) => ({ date: b.date, close: px(b.close) }))

  // The requested entry date may have been a weekend/holiday — we entered the
  // next session. Say so, rather than silently using a different date.
  const slipped = entryBar.date.slice(0, 10) !== opts.entryDate.slice(0, 10)
  const notes = [
    ...(slipped ? [`Requested entryDate ${opts.entryDate} was not a trading day; entered the next session ${entryBar.date.slice(0, 10)}.`] : []),
    ...(exit === null ? [`Still open at asOf ${asOf} — return is mark-to-market, not realized.`] : []),
  ]

  return {
    symbol: meta.symbol,
    barId: meta.barId,
    source: meta.source,
    interval,
    asOf,
    rule,
    entry: { date: entryBar.date, price: px(entryPrice) },
    exit,
    open: exit === null,
    barsHeld,
    returnPct: pct(exitPrice, entryPrice),
    mfePct: mfe,
    maePct: mae,
    peak,
    trough,
    path,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}
