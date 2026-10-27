import { describe, expect, it } from 'vitest'
import { FMPEconomicCalendarFetcher } from './economic-calendar.js'

describe('FMP economic calendar values', () => {
  it('preserves real zero releases, estimates and previous values while treating empty text as missing', () => {
    const [event] = FMPEconomicCalendarFetcher.transformData({ start_date: null, end_date: null }, [{ date: '2026-10-25T12:00:00Z', event: 'Example release', actual: 0, estimate: 0, previous: 0, change: 0, changePercentage: 0, country: '' }])
    expect(event).toMatchObject({ actual: 0, consensus: 0, previous: 0, change: 0, change_percent: 0, country: null })
  })
})
