/**
 * Regression tests for CryptoHistoricalDataSchema.
 * @see https://github.com/TraderAlice/OpenAlice/issues/66
 *
 * yfinance can return null for the close price (e.g. current day before market
 * close, data delays, or missing data points). The schema must accept null for
 * close, consistent with all other price fields.
 */

import { describe, it, expect } from 'vitest'
import { CryptoHistoricalDataSchema } from './crypto-historical.js'

describe('CryptoHistoricalDataSchema — issue #66: null close price', () => {
  it('accepts a complete record with numeric close', () => {
    const result = CryptoHistoricalDataSchema.safeParse({
      date: '2026-03-15',
      open: 71213.68,
      high: 73173.01,
      low: 70882.42,
      close: 72789.91,
      volume: 27991268669,
      vwap: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.close).toBe(72789.91)
  })

  it('accepts null close (yfinance intraday / missing data)', () => {
    const result = CryptoHistoricalDataSchema.safeParse({
      date: '2026-03-16',
      open: 72820.78,
      high: null,
      low: null,
      close: null,
      volume: 51164610560,
      vwap: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.close).toBeNull()
  })

  it('defaults close to null when omitted', () => {
    const result = CryptoHistoricalDataSchema.safeParse({
      date: '2026-03-16',
    })
    expect(result.success).toBe(true)
    expect(result.data?.close).toBeNull()
  })

  it('rejects non-numeric, non-null close', () => {
    const result = CryptoHistoricalDataSchema.safeParse({
      date: '2026-03-16',
      close: 'not-a-number',
    })
    expect(result.success).toBe(false)
  })
})
