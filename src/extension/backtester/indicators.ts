/**
 * Backtester — Indicator series computation
 *
 * Wraps analysis-kit single-value functions to produce full arrays
 * over a candle series. For each candle i, computes the indicator
 * using closes[0..i] (or highs/lows for ATR).
 */

import { RSI, BBANDS, MACD, ATR } from '../../domain/analysis/indicator/functions/technical.js'
import { SMA, EMA } from '../../domain/analysis/indicator/functions/statistics.js'
import { parseIndicatorName, extractIndicatorNames } from './dsl.js'
import type { Candle } from './types.js'

export type IndicatorSeries = Record<string, number[]>

/**
 * Compute all indicator series needed for the given expressions.
 * Returns a map of indicator name → number[] (one value per candle, NaN for warm-up).
 */
export function computeIndicatorSeries(candles: Candle[], expressions: string[]): IndicatorSeries {
  const names = extractIndicatorNames(expressions)
  const series: IndicatorSeries = {}

  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const n = candles.length

  for (const name of names) {
    const spec = parseIndicatorName(name)
    if (!spec) continue

    const values = new Array<number>(n).fill(NaN)

    switch (spec.type) {
      case 'RSI': {
        const period = spec.period ?? 14
        const minLen = period + 1
        for (let i = minLen - 1; i < n; i++) {
          try { values[i] = RSI(closes.slice(0, i + 1), period) } catch { /* warm-up */ }
        }
        break
      }

      case 'SMA': {
        const period = spec.period ?? 20
        for (let i = period - 1; i < n; i++) {
          try { values[i] = SMA(closes.slice(0, i + 1), period) } catch { /* warm-up */ }
        }
        break
      }

      case 'EMA': {
        const period = spec.period ?? 20
        for (let i = period - 1; i < n; i++) {
          try { values[i] = EMA(closes.slice(0, i + 1), period) } catch { /* warm-up */ }
        }
        break
      }

      case 'BBANDS': {
        const period = 20
        const comp = spec.component ?? 'middle'
        for (let i = period - 1; i < n; i++) {
          try {
            const bb = BBANDS(closes.slice(0, i + 1), period, 2)
            values[i] = bb[comp as keyof typeof bb]
          } catch { /* warm-up */ }
        }
        break
      }

      case 'MACD': {
        const comp = spec.component ?? 'value'
        const minLen = 26 + 9
        for (let i = minLen - 1; i < n; i++) {
          try {
            const m = MACD(closes.slice(0, i + 1), 12, 26, 9)
            const key = comp === 'value' ? 'macd' : comp
            values[i] = m[key as keyof typeof m]
          } catch { /* warm-up */ }
        }
        break
      }

      case 'ATR': {
        const period = spec.period ?? 14
        const minLen = period + 1
        for (let i = minLen - 1; i < n; i++) {
          try {
            values[i] = ATR(
              highs.slice(0, i + 1),
              lows.slice(0, i + 1),
              closes.slice(0, i + 1),
              period,
            )
          } catch { /* warm-up */ }
        }
        break
      }
    }

    series[name] = values
  }

  return series
}
