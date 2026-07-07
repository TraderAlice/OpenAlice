import { describe, expect, it, vi } from 'vitest'
import { buildPriceActionVolumeConfirmations } from './volume-confirmation'
import type { BarService } from '@/domain/market-data/bars/index.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'

describe('buildPriceActionVolumeConfirmations', () => {
  it('returns unavailable before fetching intrabars when vendor barId lacks assetClass', async () => {
    const getBars = vi.fn()
    const barService = { getBars } as unknown as BarService

    const result = await buildPriceActionVolumeConfirmations({
      barService,
      ref: { barId: 'tradingview|AAPL' },
      barId: 'tradingview|AAPL',
      interval: '15m',
      bars: makeBars(3),
      enabled: true,
    })

    expect(result.meta).toEqual({
      volumeConfirmation: 'unavailable',
      volumeConfirmationReason: 'Vendor barId "tradingview|AAPL" needs an assetClass to route intrabar volume confirmation. Pass { barId, assetClass } or disable volume confirmation.',
    })
    expect(getBars).not.toHaveBeenCalled()
  })

  it('keys confirmations by full-bars absolute index after intrabar window truncation', async () => {
    const bars = makeBars(122)
    const intrabars = [
      { date: '2024-01-01 00:45:00', open: 103, high: 104, low: 102, close: 104, volume: 100 },
      { date: '2024-01-01 01:00:00', open: 104, high: 105, low: 103, close: 103, volume: 100 },
      { date: '2024-01-01 01:15:00', open: 105, high: 106, low: 104, close: 106, volume: 100 },
    ]
    const barService = {
      getBars: vi.fn(async () => ({
        bars: intrabars,
        meta: {},
      })),
    } as unknown as BarService

    const result = await buildPriceActionVolumeConfirmations({
      barService,
      ref: { symbol: 'AAPL', assetClass: 'equity' },
      barId: 'yfinance|AAPL',
      interval: '1000h',
      bars,
      enabled: true,
    })

    expect(result.confirmations?.has(0)).toBe(false)
    expect(result.confirmations?.has(1)).toBe(false)
    expect(result.confirmations?.has(2)).toBe(false)
    expect([...result.confirmations?.keys() ?? []]).toHaveLength(119)
    expect([...result.confirmations?.keys() ?? []].slice(0, 3)).toEqual([3, 4, 5])
    expect([...result.confirmations?.keys() ?? []].at(-1)).toBe(121)
  })
})

function makeBars(count: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, 1, index, 0, 0)).toISOString().slice(0, 19).replace('T', ' '),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 100,
  }))
}
