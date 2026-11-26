import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FXMDCurrencyHistoricalFetcher as F, parsePair } from './currency-historical.js'
import { QueryExecutor } from '../../../core/provider/query-executor.js'
import { Registry } from '../../../core/provider/registry.js'
import { fxmacrodataProvider } from '../index.js'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('FXMacroData CurrencyHistorical', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json({
      base: 'EUR',
      quote: 'USD',
      pagination: { has_more: false },
      data: [
        { date: '2026-10-02', val: 1.1712 },
        { date: '2026-10-01', val: 1.1698 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('parses common pair spellings', () => {
    expect(parsePair('EURUSD')).toEqual(['EUR', 'USD'])
    expect(parsePair('usd/jpy')).toEqual(['USD', 'JPY'])
    expect(() => parsePair('EURARS')).toThrow('does not cover')
  })

  it('maps reference rates to close without inventing OHLC', async () => {
    const rows = await F.fetchData({ symbol: 'EUR-USD' }, { fxmacrodata_api_key: 'k' })
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/forex/eur/usd?')
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('k')
    expect(rows).toEqual([
      expect.objectContaining({ date: '2026-10-01', close: 1.1698, open: null, high: null, low: null, symbol: 'EURUSD' }),
      expect.objectContaining({ date: '2026-10-02', close: 1.1712 }),
    ])
  })

  it('requires a key when run through the executor', async () => {
    const registry = new Registry()
    registry.includeProvider(fxmacrodataProvider)
    const executor = new QueryExecutor(registry)
    await expect(executor.execute('fxmacrodata', 'CurrencyHistorical', { symbol: 'EURUSD' }, {}))
      .rejects.toThrow("Missing credential 'fxmacrodata_api_key'")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
