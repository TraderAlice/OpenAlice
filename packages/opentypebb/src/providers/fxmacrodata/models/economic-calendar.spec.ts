import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FXMDEconomicCalendarFetcher as F } from './economic-calendar.js'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('FXMacroData EconomicCalendar', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json({
      currency: 'USD',
      data: [{
        announcement_datetime_utc: '2026-10-06T12:30:00+00:00',
        release: 'trade_balance',
        name: 'Trade Balance',
        source: 'Bureau of Economic Analysis release dates JSON',
        event_importance: 'medium',
        release_date_confirmed: true,
        date: '2026-08-31',
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps scheduled releases and leaves forecast fields empty', async () => {
    const [row] = await F.fetchData({ start_date: '2026-10-01', end_date: '2026-10-31' }) as Record<string, unknown>[]
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.fxmacrodata.com/v1/calendar/usd?start_date=2026-10-01&end_date=2026-10-31')
    expect(row).toMatchObject({
      date: '2026-10-06T12:30:00+00:00', country: 'United States', currency: 'USD',
      event: 'Trade Balance', importance: 'medium', indicator: 'trade_balance',
      reference_date: '2026-08-31', date_confirmed: true,
      consensus: null, previous: null, actual: null,
    })
    expect(row).not.toHaveProperty('_currency')
  })
})
