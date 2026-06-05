/**
 * Sector rotation — cross-sectional comparison of the GICS sector ETFs on
 * multi-period momentum and the two volume axes, to read where capital is
 * rotating (ANG-80).
 *
 * The launcher enumerates ONLY the broad sector ETFs (stable, ~MECE coordinate
 * system). Specific themes are reached by the agent via the ETF tools (etfSearch
 * / etfGetInfo), not enumerated here.
 *
 * This module is pure: `computeSectorRotation` takes already-fetched OHLCV
 * histories and returns the ranked table. Fetching lives in the tool layer.
 */

import type { OhlcvData } from './indicator/types.js'
import type { EquityClientLike } from '../market-data/client/types.js'

export interface SectorEtf {
  symbol: string
  sector: string
}

/** The 11 SPDR Select Sector ETFs (GICS). The enumerated rotation universe. */
export const GICS_SECTOR_ETFS: SectorEtf[] = [
  { symbol: 'XLK', sector: 'Technology' },
  { symbol: 'XLC', sector: 'Communication Services' },
  { symbol: 'XLY', sector: 'Consumer Discretionary' },
  { symbol: 'XLP', sector: 'Consumer Staples' },
  { symbol: 'XLE', sector: 'Energy' },
  { symbol: 'XLF', sector: 'Financials' },
  { symbol: 'XLV', sector: 'Health Care' },
  { symbol: 'XLI', sector: 'Industrials' },
  { symbol: 'XLB', sector: 'Materials' },
  { symbol: 'XLRE', sector: 'Real Estate' },
  { symbol: 'XLU', sector: 'Utilities' },
]

/** Broad-market anchor for relative strength (beat/lag the tape). */
export const BENCHMARK_SYMBOL = 'SPY'

/** Trading-day lookbacks per period label. */
export const PERIOD_DAYS = { '1D': 1, '1W': 5, '1M': 21, '3M': 63, '6M': 126 } as const
export type RotationPeriod = keyof typeof PERIOD_DAYS

/** Trailing window for average dollar-volume / RVOL baselines. */
const VOLUME_BASELINE_DAYS = 20

export interface SectorRotationRow {
  symbol: string
  sector: string
  /** Cumulative % return over each lookback (fraction, e.g. 0.034 = +3.4%). */
  returns: Record<RotationPeriod, number | null>
  /** Return minus the benchmark's over the same lookback. */
  rel_strength: Record<RotationPeriod, number | null>
  /** Per-trading-day pace of the 1W window minus the 3M window. >0 = accelerating. */
  momentum_acceleration: number | null
  /** Latest traded notional (close × volume). */
  dollar_volume: number | null
  /** This sector's share of the 11-set's total dollar volume today. */
  dv_share: number | null
  /** dv_share minus the sector's share computed off 20-day-average dollar volume.
   *  >0 = taking a bigger slice of sector volume than its recent norm = rotating in. */
  dv_share_change: number | null
  /** Today's volume / 20-day average volume. */
  rvol: number | null
  /** Blended cross-sectional rank: mean of z(momentum_acceleration) and
   *  z(dv_share_change) across the 11 sectors. Higher = rotating in. Null if
   *  neither input is available. */
  rotation_score: number | null
  bars: number
}

export interface SectorRotationResult {
  asOf: string
  benchmark: { symbol: string; returns: Record<RotationPeriod, number | null> }
  /** Sorted by rotation_score desc; rows with a null score sink to the bottom. */
  sectors: SectorRotationRow[]
  methodology: string
}

// ──────────────────────────── helpers ────────────────────────────

function sortAsc(data: OhlcvData[]): OhlcvData[] {
  return [...data].sort((a, b) => a.date.localeCompare(b.date))
}

/** Cumulative return over the last `nDays` bars, or null if not enough data. */
function periodReturn(closes: number[], nDays: number): number | null {
  if (closes.length < nDays + 1) return null
  const last = closes[closes.length - 1]
  const prior = closes[closes.length - 1 - nDays]
  if (prior === 0) return null
  return last / prior - 1
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Population standard deviation. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/** Z-score a value against a population; 0 if the population can't discriminate. */
function zscore(value: number, population: number[]): number {
  const sd = stdev(population)
  if (sd === 0) return 0
  return (value - mean(population)) / sd
}

function round(n: number | null, places: number): number | null {
  if (n === null || !Number.isFinite(n)) return null
  return parseFloat(n.toFixed(places))
}

// ─────────────────────── per-ETF raw metrics ───────────────────────

interface RawMetrics {
  symbol: string
  sector: string
  closes: number[]
  returns: Record<RotationPeriod, number | null>
  momentumAccel: number | null
  dvToday: number | null
  dvBase: number | null
  rvol: number | null
  bars: number
}

function rawMetrics(symbol: string, sector: string, history: OhlcvData[]): RawMetrics {
  const sorted = sortAsc(history)
  const closes = sorted.map((d) => d.close)
  const vols = sorted.map((d) => d.volume ?? 0)

  const returns = {} as Record<RotationPeriod, number | null>
  for (const [label, n] of Object.entries(PERIOD_DAYS)) {
    returns[label as RotationPeriod] = periodReturn(closes, n)
  }

  // Momentum acceleration: per-trading-day pace of the short window vs the long.
  const r1w = returns['1W']
  const r3m = returns['3M']
  const momentumAccel =
    r1w !== null && r3m !== null ? r1w / PERIOD_DAYS['1W'] - r3m / PERIOD_DAYS['3M'] : null

  // Dollar volume: latest, and the trailing baseline average.
  const n = sorted.length
  const dvToday = n > 0 ? closes[n - 1] * vols[n - 1] : null
  let dvBase: number | null = null
  let rvol: number | null = null
  if (n >= VOLUME_BASELINE_DAYS + 1) {
    const dvSeries: number[] = []
    let volSum = 0
    for (let i = n - VOLUME_BASELINE_DAYS; i < n; i++) dvSeries.push(closes[i] * vols[i])
    for (let i = n - VOLUME_BASELINE_DAYS - 1; i < n - 1; i++) volSum += vols[i]
    dvBase = mean(dvSeries)
    const avgVol = volSum / VOLUME_BASELINE_DAYS
    rvol = avgVol > 0 ? vols[n - 1] / avgVol : null
  }

  return { symbol, sector, closes, returns, momentumAccel, dvToday, dvBase, rvol, bars: n }
}

// ──────────────────────────── compute ────────────────────────────

const METHODOLOGY =
  'rotation_score = mean of cross-sectional z-scores of momentum_acceleration ' +
  '(1W per-day pace minus 3M per-day pace) and dv_share_change (today\'s share of ' +
  'the 11-sector dollar volume minus its share off the 20-day average). Ranked desc = ' +
  'rotating in. CAVEAT: ETF dollar volume approximates sector capital but misses ' +
  'single-name concentration, and is distorted by creation/redemption & hedging flows — ' +
  'a proxy for fund flow, not a clean read.'

/**
 * Compute the sector rotation table from pre-fetched daily OHLCV histories.
 * `histories` is keyed by symbol and must include the GICS sector ETFs; the
 * benchmark (SPY) is optional but enables rel_strength.
 */
export function computeSectorRotation(
  histories: Record<string, OhlcvData[]>,
): SectorRotationResult {
  const benchRaw = histories[BENCHMARK_SYMBOL]
    ? rawMetrics(BENCHMARK_SYMBOL, 'Benchmark', histories[BENCHMARK_SYMBOL])
    : null

  const raws = GICS_SECTOR_ETFS.map((e) =>
    rawMetrics(e.symbol, e.sector, histories[e.symbol] ?? []),
  )

  // Dollar-volume shares (sector universe only; exclude the benchmark).
  const totalToday = raws.reduce((s, r) => s + (r.dvToday ?? 0), 0)
  const totalBase = raws.reduce((s, r) => s + (r.dvBase ?? 0), 0)

  const shareChanges = new Map<string, number | null>()
  for (const r of raws) {
    if (r.dvToday !== null && r.dvBase !== null && totalToday > 0 && totalBase > 0) {
      shareChanges.set(r.symbol, r.dvToday / totalToday - r.dvBase / totalBase)
    } else {
      shareChanges.set(r.symbol, null)
    }
  }

  // Cross-sectional populations for z-scoring.
  const accelPop = raws.map((r) => r.momentumAccel).filter((x): x is number => x !== null)
  const sharePop = [...shareChanges.values()].filter((x): x is number => x !== null)

  const rows: SectorRotationRow[] = raws.map((r) => {
    const relStrength = {} as Record<RotationPeriod, number | null>
    for (const label of Object.keys(PERIOD_DAYS) as RotationPeriod[]) {
      const sr = r.returns[label]
      const br = benchRaw?.returns[label] ?? null
      relStrength[label] = sr !== null && br !== null ? round(sr - br, 4) : null
    }

    const shareChange = shareChanges.get(r.symbol) ?? null
    const zAccel = r.momentumAccel !== null ? zscore(r.momentumAccel, accelPop) : null
    const zShare = shareChange !== null ? zscore(shareChange, sharePop) : null
    const zParts = [zAccel, zShare].filter((x): x is number => x !== null)
    const rotationScore = zParts.length > 0 ? mean(zParts) : null

    const roundedReturns = {} as Record<RotationPeriod, number | null>
    for (const label of Object.keys(PERIOD_DAYS) as RotationPeriod[]) {
      roundedReturns[label] = round(r.returns[label], 4)
    }

    return {
      symbol: r.symbol,
      sector: r.sector,
      returns: roundedReturns,
      rel_strength: relStrength,
      momentum_acceleration: round(r.momentumAccel, 6),
      dollar_volume: round(r.dvToday, 0),
      dv_share: r.dvToday !== null && totalToday > 0 ? round(r.dvToday / totalToday, 4) : null,
      dv_share_change: round(shareChange, 4),
      rvol: round(r.rvol, 2),
      rotation_score: round(rotationScore, 3),
      bars: r.bars,
    }
  })

  rows.sort((a, b) => (b.rotation_score ?? -Infinity) - (a.rotation_score ?? -Infinity))

  const benchReturns = {} as Record<RotationPeriod, number | null>
  for (const label of Object.keys(PERIOD_DAYS) as RotationPeriod[]) {
    benchReturns[label] = round(benchRaw?.returns[label] ?? null, 4)
  }

  // asOf = latest bar date across the inputs (no clock dependency).
  const allDates = Object.values(histories)
    .flatMap((h) => h.map((d) => d.date))
    .sort()
  const asOf = allDates.length > 0 ? allDates[allDates.length - 1] : ''

  return {
    asOf,
    benchmark: { symbol: BENCHMARK_SYMBOL, returns: benchReturns },
    sectors: rows,
    methodology: METHODOLOGY,
  }
}

/** Calendar days of daily history to pull — enough for the 6M (126-bar)
 *  lookback plus the 20-day volume baseline, with weekend/holiday headroom. */
const LOOKBACK_CALENDAR_DAYS = 300

/**
 * Fetch the daily histories for the GICS sector ETFs (+ SPY) and compute the
 * rotation table. Shared by the `sectorRotation` AI tool and the
 * `/api/market/sector-rotation` HTTP route so both read identically.
 */
export async function fetchSectorRotation(
  equityClient: EquityClientLike,
): Promise<SectorRotationResult> {
  const start = new Date()
  start.setDate(start.getDate() - LOOKBACK_CALENDAR_DAYS)
  const start_date = start.toISOString().slice(0, 10)

  const symbols = [...GICS_SECTOR_ETFS.map((e) => e.symbol), BENCHMARK_SYMBOL]

  const fetched = await Promise.all(
    symbols.map(async (symbol) => {
      const raw = await equityClient
        .getHistorical({ symbol, start_date, interval: '1d' })
        .catch(() => [] as Array<Record<string, unknown>>)
      const data = (raw as Array<Record<string, unknown>>).filter(
        (d): d is Record<string, unknown> & OhlcvData =>
          d.close != null && typeof d.date === 'string',
      ) as OhlcvData[]
      return [symbol, data] as const
    }),
  )

  return computeSectorRotation(Object.fromEntries(fetched))
}
