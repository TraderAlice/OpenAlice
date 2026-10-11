import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FXMDCountryInterestRatesFetcher as F } from './country-interest-rates.js'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('FXMacroData CountryInterestRates', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json({
      name: 'Federal Funds Target Range Upper Bound',
      pagination: { has_more: false },
      data: [
        { date: '2026-09-16', val: 4.0, announcement_datetime: 1789581600 },
        { date: '2026-07-29', val: 3.75, announcement_datetime: 1785348000 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns policy-rate decisions as decimals, oldest first', async () => {
    const rows = await F.fetchData({ start_date: '2026-01-01' })
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/announcements/usd/policy_rate?start_date=2026-01-01')
    expect(rows).toEqual([
      expect.objectContaining({ date: '2026-07-29', value: 0.0375, country: 'United States' }),
      expect.objectContaining({
        date: '2026-09-16', value: 0.04, currency: 'USD',
        rate_name: 'Federal Funds Target Range Upper Bound',
        release_datetime: '2026-09-16T18:00:00.000Z',
      }),
    ])
  })
})
