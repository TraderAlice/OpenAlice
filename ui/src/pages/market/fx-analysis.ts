import Decimal from 'decimal.js'

import type { HistoricalBar } from '../../api/market'
import type { GlobalMacroBoard, GlobalMacroRow, MacroBoard } from '../../api/reference'

export interface FxPair {
  symbol: string
  base: string
  quote: string
  pipSize: number
}

export interface FxCountry {
  currency: string
  country: string
  label: string
  proxy?: string
}

export interface FxPriceStats {
  spot: number
  asOf: string
  oneWeekReturn: number | null
  oneMonthReturn: number | null
  threeMonthReturn: number | null
  realizedVol20: number | null
  rangeLow: number
  rangeHigh: number
  rangePosition: number | null
}

export interface FxForwardPoint {
  months: number
  outright: number
  points: number
}

export interface FxScenario {
  shockedSpot: number
  movePercent: number
  quotePnl: number
  basePnlApprox: number
}

const COUNTRY_BY_CURRENCY: Record<string, FxCountry> = {
  USD: { currency: 'USD', country: 'united_states', label: 'United States' },
  EUR: { currency: 'EUR', country: 'germany', label: 'Euro area', proxy: 'Germany proxy' },
  GBP: { currency: 'GBP', country: 'united_kingdom', label: 'United Kingdom' },
  JPY: { currency: 'JPY', country: 'japan', label: 'Japan' },
  CNY: { currency: 'CNY', country: 'china', label: 'China' },
  CNH: { currency: 'CNH', country: 'china', label: 'China', proxy: 'onshore macro proxy' },
  CAD: { currency: 'CAD', country: 'canada', label: 'Canada' },
  AUD: { currency: 'AUD', country: 'australia', label: 'Australia' },
  CHF: { currency: 'CHF', country: 'switzerland', label: 'Switzerland' },
  NZD: { currency: 'NZD', country: 'new_zealand', label: 'New Zealand' },
}

/** Parse common vendor spellings: EURUSD, EUR/USD, USD.CHF and EURUSD=X. */
export function parseFxPair(raw: string): FxPair | null {
  const symbol = raw.toUpperCase().replace(/=X$/, '').replace(/[^A-Z]/g, '')
  if (symbol.length !== 6) return null
  const base = symbol.slice(0, 3)
  const quote = symbol.slice(3)
  if (base === quote) return null
  return { symbol, base, quote, pipSize: quote === 'JPY' ? 0.01 : 0.0001 }
}

export function resolveFxCountry(currency: string): FxCountry | null {
  return COUNTRY_BY_CURRENCY[currency.toUpperCase()] ?? null
}

export function macroRowForCurrency(
  currency: string,
  board: GlobalMacroBoard | null,
): GlobalMacroRow | null {
  const country = resolveFxCountry(currency)
  if (!country || !board) return null
  return board.rows.find((row) => row.country === country.country) ?? null
}

function sortedBars(input: HistoricalBar[]): HistoricalBar[] {
  return input
    .filter((bar) => Number.isFinite(bar.close) && Number.isFinite(bar.high) && Number.isFinite(bar.low))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function returnOverDays(bars: HistoricalBar[], days: number): number | null {
  const latest = bars[bars.length - 1]
  if (!latest) return null
  const latestTime = new Date(latest.date).getTime()
  if (!Number.isFinite(latestTime)) return null
  const target = latestTime - days * 86_400_000
  let baseline: HistoricalBar | null = null
  for (const bar of bars) {
    const time = new Date(bar.date).getTime()
    if (Number.isFinite(time) && time <= target) baseline = bar
    if (time > target) break
  }
  if (!baseline || baseline.close === 0) return null
  return new Decimal(latest.close).div(baseline.close).minus(1).mul(100).toNumber()
}

function realizedVol20(bars: HistoricalBar[]): number | null {
  const closes = bars.slice(-21).map((bar) => bar.close).filter((value) => value > 0)
  if (closes.length < 6) return null
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i] / closes[i - 1]))
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) * 100
}

export function computeFxPriceStats(input: HistoricalBar[]): FxPriceStats | null {
  const bars = sortedBars(input)
  const latest = bars[bars.length - 1]
  if (!latest) return null
  const range = bars.slice(-252)
  const rangeLow = Math.min(...range.map((bar) => bar.low))
  const rangeHigh = Math.max(...range.map((bar) => bar.high))
  const rangeWidth = rangeHigh - rangeLow
  return {
    spot: latest.close,
    asOf: latest.date,
    oneWeekReturn: returnOverDays(bars, 7),
    oneMonthReturn: returnOverDays(bars, 30),
    threeMonthReturn: returnOverDays(bars, 90),
    realizedVol20: realizedVol20(bars),
    rangeLow,
    rangeHigh,
    rangePosition: rangeWidth > 0 ? ((latest.close - rangeLow) / rangeWidth) * 100 : null,
  }
}

/**
 * Covered-interest-parity indication using the board's short-rate proxies.
 * This is a research estimate, not an executable forward quote.
 */
export function buildIndicativeForwardCurve(
  spot: number,
  baseRatePct: number,
  quoteRatePct: number,
  pipSize: number,
  tenors = [1, 3, 6, 12],
): FxForwardPoint[] {
  const spotDec = new Decimal(spot)
  const baseRate = new Decimal(baseRatePct).div(100)
  const quoteRate = new Decimal(quoteRatePct).div(100)
  const pip = new Decimal(pipSize)
  return tenors.map((months) => {
    const years = new Decimal(months).div(12)
    const outright = spotDec
      .mul(new Decimal(1).plus(quoteRate.mul(years)))
      .div(new Decimal(1).plus(baseRate.mul(years)))
    return {
      months,
      outright: outright.toNumber(),
      points: outright.minus(spotDec).div(pip).toNumber(),
    }
  })
}

export function calculateFxScenario(input: {
  pair: FxPair
  spot: number
  notionalBase: number
  movePips: number
  side: 'long' | 'short'
}): FxScenario | null {
  if (![input.spot, input.notionalBase, input.movePips].every(Number.isFinite) || input.spot <= 0 || input.notionalBase < 0) return null
  const direction = input.side === 'long' ? 1 : -1
  const move = new Decimal(input.movePips).mul(input.pair.pipSize)
  const shocked = new Decimal(input.spot).plus(move)
  if (shocked.lte(0)) return null
  const quotePnl = new Decimal(input.notionalBase).mul(move).mul(direction)
  return {
    shockedSpot: shocked.toNumber(),
    movePercent: move.div(input.spot).mul(100).toNumber(),
    quotePnl: quotePnl.toNumber(),
    basePnlApprox: quotePnl.div(input.spot).toNumber(),
  }
}

export function broadDollarChange(macro: MacroBoard | null, observations = 20): {
  latest: number
  date: string | null
  changePct: number | null
} | null {
  const card = macro?.cards.find((entry) => entry.id === 'DTWEXBGS')
  if (!card || card.latest == null) return null
  const points = card.points.filter((point) => Number.isFinite(point.value))
  const baseline = points[Math.max(0, points.length - 1 - observations)]
  return {
    latest: card.latest,
    date: card.latestDate,
    changePct: baseline && baseline.value !== 0
      ? new Decimal(card.latest).div(baseline.value).minus(1).mul(100).toNumber()
      : null,
  }
}
