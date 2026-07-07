import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { calculatePriceActionVolatility } from './indicators.js'

describe('calculatePriceActionVolatility', () => {
  it('uses short-window true-range fallback before ATR200 is available', () => {
    const bars = makeBars([
      [100, 104, 99, 103],
      [103, 106, 101, 105],
      [105, 108, 104, 107],
    ])

    const volatility = calculatePriceActionVolatility(bars)

    expect(volatility.period).toBe(200)
    expect(volatility.fallback).toEqual({
      used: true,
      reason: 'insufficient_bars',
      availableBars: 3,
    })
    expect(volatility.formationVolatilityByIndex).toHaveLength(3)
    expect(volatility.currentVolatility).toBeGreaterThan(0)
    expect(volatility.currentVolatility).toBe(volatility.formationVolatilityByIndex[2])
  })

  it('uses ATR200 once enough bars are available', () => {
    const bars = Array.from({ length: 205 }, (_, index) => ({
      date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000,
    }))

    const volatility = calculatePriceActionVolatility(bars)

    expect(volatility.fallback.used).toBe(false)
    expect(volatility.currentVolatility).toBeGreaterThan(0)
    expect(volatility.currentVolatility).toBe(volatility.formationVolatilityByIndex.at(-1))
  })
})

function makeBars(values: Array<[number, number, number, number]>): OhlcvBar[] {
  return values.map(([open, high, low, close], index) => ({
    date: `2024-01-01 09:${String(index).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }))
}

