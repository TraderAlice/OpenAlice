import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FXMDAvailableIndicatorsFetcher as F } from './available-indicators.js'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('FXMacroData AvailableIndicators', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/eur')
      ? { policy_rate: { name: 'Main Refinancing Rate', unit: '%', frequency: 'Irregular', source: 'ECB' } }
      : { inflation: { name: 'Inflation (CPI)', unit: '%YoY', frequency: 'Monthly', source: 'BLS' } })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps catalogue entries for each requested currency', async () => {
    const rows = await F.fetchData({ country: 'USD,euro_area' })
    expect(rows).toEqual([
      expect.objectContaining({
        symbol_root: 'inflation', symbol: 'USD.inflation', country: 'United States', iso: 'US',
        description: 'Inflation (CPI)', frequency: 'Monthly', unit: '%YoY', source: 'BLS',
      }),
      expect.objectContaining({ symbol: 'EUR.policy_rate', country: 'Euro Area', iso: null, unit: '%' }),
    ])
  })
})
