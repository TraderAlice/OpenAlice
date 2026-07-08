/**
 * Macro dashboard — curated FRED regime inputs.
 *
 * One multi-series FRED call covers the whole board (the fetcher merges
 * series by date into `{date, DFF, DGS10, …}` rows). CPI YoY is derived
 * in-domain from the CPIAUCSL index — FRED transforms (units=pc1) are not
 * exposed by the fetcher, and the math is one line.
 */

import type { EconomyClientLike } from '../client/types.js'
import type { MacroBoard, MacroPoint, MacroSeriesCard, MacroUnit } from './types.js'

interface CuratedSeries {
  id: string
  label: string
  unit: MacroUnit
  /** Multiply raw observations into display units (e.g. FRED reports M2 in
   *  billions and payrolls in thousands — scale to absolute for fmtCompact). */
  scale?: number
}

/** The regime inputs a trader actually checks weekly — rates, curve, labor,
 *  inflation, oil, dollar. Deliberately one screen, not a FRED browser
 *  (fredSearch/fredSeries tools exist for everything else). */
const CURATED: CuratedSeries[] = [
  { id: 'DFF', label: 'Fed Funds Rate', unit: 'percent' },
  { id: 'DGS2', label: '2Y Treasury', unit: 'percent' },
  { id: 'DGS10', label: '10Y Treasury', unit: 'percent' },
  { id: 'T10Y2Y', label: '10Y–2Y Spread', unit: 'percent' },
  { id: 'UNRATE', label: 'Unemployment Rate', unit: 'percent' },
  { id: 'ICSA', label: 'Initial Jobless Claims', unit: 'count' },
  { id: 'DCOILWTICO', label: 'WTI Crude', unit: 'usd' },
  { id: 'DTWEXBGS', label: 'Dollar Index (Broad)', unit: 'index' },
  // Fished from the no-consumer FRED pool — plain series ids, so they ride
  // the same multi-series call at zero extra wiring.
  { id: 'PAYEMS', label: 'Nonfarm Payrolls', unit: 'count', scale: 1e3 },
  { id: 'M2SL', label: 'M2 Money Supply', unit: 'count', scale: 1e9 },
  { id: 'UMCSENT', label: 'Consumer Sentiment (UMich)', unit: 'index' },
  { id: 'T10YIE', label: '10Y Breakeven Inflation', unit: 'percent' },
  // SLOOS: net % of banks tightening C&I lending standards (quarterly) —
  // the credit-cycle read. Positive = tightening.
  { id: 'DRTSCILM', label: 'Banks Tightening C&I (SLOOS)', unit: 'percent' },
]

/** CPI index series — fetched alongside CURATED, surfaced as derived YoY. */
const CPI_INDEX = 'CPIAUCSL'

const MAX_POINTS = 90

function sameDatePreviousYear(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  return `${Number(m[1]) - 1}-${m[2]}-${m[3]}`
}

function deriveCpiYoy(cpi: MacroPoint[]): MacroPoint[] {
  const byDate = new Map(cpi.map((p) => [p.date, p.value]))
  const out: MacroPoint[] = []
  for (const p of cpi) {
    const baseDate = sameDatePreviousYear(p.date)
    if (!baseDate) continue
    const base = byDate.get(baseDate)
    if (typeof base !== 'number' || !Number.isFinite(base) || base === 0) continue
    out.push({ date: p.date, value: ((p.value / base) - 1) * 100 })
  }
  return out
}

export async function fetchMacroBoard(economyClient: EconomyClientLike): Promise<MacroBoard> {
  // 2 years of history: enough for a 12-month YoY base plus a sparkline.
  const start = new Date()
  start.setFullYear(start.getFullYear() - 2)
  const rows = await economyClient.fredSeries({
    provider: 'federal_reserve',
    symbol: [...CURATED.map((s) => s.id), CPI_INDEX].join(','),
    start_date: start.toISOString().slice(0, 10),
  })

  const pointsOf = (id: string): MacroPoint[] =>
    rows
      .map((r) => ({ date: r.date, value: (r as Record<string, unknown>)[id] }))
      .filter((p): p is MacroPoint => typeof p.value === 'number' && Number.isFinite(p.value))

  const card = (s: CuratedSeries, points: MacroPoint[]): MacroSeriesCard => {
    const scaled = s.scale ? points.map((p) => ({ date: p.date, value: p.value * s.scale! })) : points
    const recent = scaled.slice(-MAX_POINTS)
    const latest = recent[recent.length - 1] ?? null
    const prev = recent[recent.length - 2] ?? null
    return {
      id: s.id,
      label: s.label,
      unit: s.unit,
      points: recent,
      latest: latest?.value ?? null,
      latestDate: latest?.date ?? null,
      change: latest && prev ? latest.value - prev.value : null,
    }
  }

  const cards = CURATED.map((s) => card(s, pointsOf(s.id)))

  // CPI YoY — monthly index; match the same calendar observation one year
  // earlier instead of assuming FRED returned a gap-free monthly sequence.
  const cpi = pointsOf(CPI_INDEX)
  const yoy = deriveCpiYoy(cpi)
  cards.splice(5, 0, card({ id: 'CPI_YOY', label: 'CPI YoY', unit: 'percent' }, yoy))

  return {
    cards,
    meta: { provider: 'federal_reserve', asOf: new Date().toISOString() },
  }
}
