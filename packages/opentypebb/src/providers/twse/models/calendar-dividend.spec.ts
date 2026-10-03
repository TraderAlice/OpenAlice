import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExecutor, loadAllRouters } from '../../../index.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { TWSECalendarDividendFetcher as Fetcher } from './calendar-dividend.js'

vi.mock('../../../core/provider/utils/helpers.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../core/provider/utils/helpers.js')>(),
  amakeRequest: vi.fn(),
}))
const request = vi.mocked(amakeRequest)
const rows = [
  { Date: '1151008', Code: '2330', Name: '台積電　', Exdividend: '息', CashDividend: '6.00' },
  { Date: '1151015', Code: '00400A', Name: 'ETF', Exdividend: '權息', CashDividend: '' },
  { Date: '1151009', Code: '1234', Name: 'Rights only', Exdividend: '權', CashDividend: '999' },
]
beforeEach(() => request.mockReset())

describe('TWSE dividend calendar', () => {
  it('normalizes the official snapshot and excludes rights-only events', () => {
    expect(Fetcher.transformData(Fetcher.transformQuery({}), rows)).toEqual([
      expect.objectContaining({ symbol: '2330.TW', name: '台積電', ex_dividend_date: '2026-10-08', amount: 6, payment_date: null }),
      expect.objectContaining({ symbol: '00400A.TW', ex_dividend_date: '2026-10-15', amount: null }),
    ])
  })
  it('applies inclusive date bounds without inventing missing history', () => {
    expect(Fetcher.transformData(Fetcher.transformQuery({ start_date: '2026-10-08', end_date: '2026-10-08' }), rows)).toHaveLength(1)
    expect(Fetcher.transformData(Fetcher.transformQuery({ end_date: '2025-12-31' }), rows)).toEqual([])
  })
  it('rejects malformed windows and drops unusable upstream dates and symbols', () => {
    expect(() => Fetcher.transformQuery({ start_date: '2026-02-30' })).toThrow()
    expect(() => Fetcher.transformQuery({ start_date: '2026-11-01', end_date: '2026-10-01' })).toThrow()
    expect(Fetcher.transformData(Fetcher.transformQuery({}), [
      { ...rows[0], Date: '1150230' }, { ...rows[0], Code: 'not-a-symbol' }, { ...rows[0], Exdividend: 'unknown' },
    ])).toEqual([])
  })
  it('preserves zero amounts and leaves undisclosed amounts null', () => {
    const result = Fetcher.transformData(Fetcher.transformQuery({}), [
      { ...rows[0], CashDividend: '0' }, { ...rows[1], CashDividend: '--' },
    ])
    expect(result.map((row) => row.amount)).toEqual([0, null])
  })
  it('is reachable through the existing calendar router with no key', async () => {
    request.mockResolvedValueOnce(rows)
    const route = loadAllRouters().getCommandMap().get('/equity/calendar/dividend')!
    const result = await route.handler(createExecutor(), 'twse', { start_date: '2026-10-08', end_date: '2026-10-08' }, {})
    expect(result).toEqual([expect.objectContaining({ symbol: '2330.TW' })])
    expect(request).toHaveBeenCalledWith('https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL', { headers: { 'User-Agent': 'Mozilla/5.0' } })
  })
  it('propagates provider outages instead of claiming an empty calendar', async () => {
    request.mockRejectedValueOnce(new Error('TWSE unavailable'))
    await expect(Fetcher.fetchData({})).rejects.toThrow('TWSE unavailable')
  })
})
