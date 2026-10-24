import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FXMDEconomicIndicatorsFetcher as F, parseSeriesSymbols } from './economic-indicators.js'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const inflation = {
  currency: 'USD',
  indicator: 'inflation',
  value_metadata: { source_unit: '%YoY' },
  pagination: { has_more: false },
  data: [
    { date: '2026-08-31', val: 3.4, announcement_datetime: 1789129800 },
    { date: '2026-07-31', val: 3.4, announcement_datetime: 1786537800 },
  ],
}

describe('FXMacroData EconomicIndicators', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('parses bare and currency-qualified symbols', () => {
    expect(parseSeriesSymbols('inflation, EUR.policy_rate', 'japan')).toEqual([
      { currency: 'JPY', indicator: 'inflation' },
      { currency: 'EUR', indicator: 'policy_rate' },
    ])
  })

  it('maps announcements to indicator rows, oldest first, values unchanged', async () => {
    fetchMock.mockResolvedValueOnce(json(inflation))
    const rows = await F.fetchData({ symbol: 'inflation' })
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/announcements/usd/inflation?')
    expect(rows).toEqual([
      expect.objectContaining({
        date: '2026-07-31', symbol_root: 'inflation', symbol: 'USD.inflation',
        country: 'United States', value: 3.4, unit: '%YoY', currency: 'USD',
        release_datetime: '2026-08-12T12:30:00.000Z',
      }),
      expect.objectContaining({ date: '2026-08-31', release_datetime: '2026-09-11T12:30:00.000Z' }),
    ])
  })

  it('skips rows without a numeric value', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...inflation, data: [{ date: '2026-08-31', val: null }, inflation.data[0]] }))
    const rows = await F.fetchData({ symbol: 'inflation' }) as unknown[]
    expect(rows).toHaveLength(1)
  })

  it('reports an empty window as EmptyDataError', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...inflation, data: [] }))
    await expect(F.fetchData({ symbol: 'gdp' })).rejects.toThrow('No FXMacroData indicator data found')
  })
})
