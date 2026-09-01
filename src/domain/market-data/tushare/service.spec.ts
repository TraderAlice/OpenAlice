import { describe, expect, it, vi } from 'vitest'
import type { TushareClient } from './client.js'
import { TushareService } from './service.js'

function serviceWith(query: (api: string, params: Record<string, unknown>) => Promise<Record<string, string | number | null>[]>) {
  return new TushareService({ query: vi.fn(query) } as unknown as TushareClient, () => new Date('2026-09-01T00:00:00Z'))
}

describe('TushareService daily bars', () => {
  it('anchors qfq at asOf, excludes future factors, and normalizes units', async () => {
    const service = serviceWith(async (api) => {
      if (api === 'daily') return [
        { trade_date: '20260831', open: 20, high: 22, low: 19, close: 21, vol: 12, amount: 34 },
        { trade_date: '20260828', open: 10, high: 11, low: 9, close: 10.5, vol: 8, amount: 9 },
      ]
      return [
        { trade_date: '20260902', adj_factor: 4 },
        { trade_date: '20260831', adj_factor: 2 },
        { trade_date: '20260828', adj_factor: 1 },
      ]
    })

    const result = await service.getBars('600519.SH', {
      interval: '1d', start: '2026-08-01', asOf: '2026-08-31',
    })

    expect(result.bars).toEqual([
      { date: '2026-08-28', open: 5, high: 5.5, low: 4.5, close: 5.25, volume: 800, amount: 9000 },
      { date: '2026-08-31', open: 20, high: 22, low: 19, close: 21, volume: 1200, amount: 34000 },
    ])
    expect(result.meta).toMatchObject({
      adjustment: 'qfq', adjustmentAnchor: '2026-08-31', volumeUnit: 'shares', amountUnit: 'CNY',
    })
  })
})

describe('TushareService point-in-time fundamentals', () => {
  it('keeps the latest revision announced by asOf and excludes later revisions', async () => {
    const service = serviceWith(async () => [
      { end_date: '20251231', ann_date: '20260430', revenue: 120, update_flag: '1' },
      { end_date: '20251231', ann_date: '20260315', revenue: 100, update_flag: '0' },
      { end_date: '20241231', ann_date: '20250320', revenue: 80, update_flag: '0' },
    ])

    const beforeRevision = await service.getFinancials('600519.SH', 'income', {
      asOf: '2026-04-01', period: 'annual', limit: 2,
    })
    expect(beforeRevision.data.map((row) => row.revenue)).toEqual([100, 80])

    const afterRevision = await service.getFinancials('600519.SH', 'income', {
      asOf: '2026-05-01', period: 'annual', limit: 1,
    })
    expect(afterRevision.data[0]?.revenue).toBe(120)
  })
})

describe('TushareService search', () => {
  it('preserves Beijing exchange ts_code identities', async () => {
    const service = serviceWith(async (_api, params) => params.list_status === 'L'
      ? [{ ts_code: '920001.BJ', symbol: '920001', name: '示例股份', cnspell: 'slgf' }]
      : [])
    const rows = await service.searchStocks('920001', 5)
    expect(rows[0]).toMatchObject({ symbol: '920001.BJ', sourceId: 'tushare', assetClass: 'equity' })
  })

  it('includes current ST securities in the same Tushare namespace', async () => {
    const service = serviceWith(async (api) => api === 'stock_st'
      ? [{ ts_code: '600000.SH', name: 'ST示例', type: 'ST' }]
      : [])
    const rows = await service.searchStocks('ST示例', 5)
    expect(rows[0]).toMatchObject({ symbol: '600000.SH', name: 'ST示例', type: 'ST', sourceId: 'tushare' })
  })
})
