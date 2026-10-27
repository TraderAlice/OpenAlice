import { afterEach, describe, it, expect, vi } from 'vitest'
import { createReferenceData } from './service.js'
import type { EconomyClientLike, EquityClientLike } from '../client/types.js'

const ECONOMY_STUB = { fredSeries: async () => [] } as unknown as EconomyClientLike

const ROW = {
  symbol: 'NVDA', name: 'NVIDIA', price: 1000, change: 50, percent_change: 0.052, volume: 1e8,
  avg_volume: 5e7, relative_volume: 2, turnover: 0.04, dollar_volume: 1e11,
}
const EARNING = { report_date: '2026-06-12', symbol: 'AAPL', name: 'Apple', eps_previous: 1.2, eps_consensus: 1.4 }

function mkEquityClient(overrides: Partial<EquityClientLike>): EquityClientLike {
  return {
    getGainers: async () => [ROW],
    getLosers: async () => [ROW],
    getActive: async () => [ROW],
    getUndervaluedGrowth: async () => [ROW],
    getGrowthTech: async () => [ROW],
    getAggressiveSmallCaps: async () => [ROW],
    getUndervaluedLargeCaps: async () => [ROW],
    getCalendarEarnings: async () => [EARNING],
    getCalendarIpo: async () => [],
    getCalendarDividend: async () => [],
    ...overrides,
  } as unknown as EquityClientLike
}

const DERIVATIVES_STUB = {} as never
const INDEX_STUB = {} as never

afterEach(() => vi.unstubAllGlobals())

function macroService(hub: unknown, failLocal = false) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(hub))))
  const get = vi.fn(async () => {
    if (failLocal) throw new Error('OECD unavailable')
    return [{ country: 'United States', date: '2026-04-01', value: 2 }, { country: 'United States', date: '2026-03-01', value: 1 }]
  })
  return { get, ref: createReferenceData({
    economyClient: { getCPI: get, getInterestRates: get, getCompositeLeadingIndicator: get, getHousePriceIndex: get, getSharePriceIndex: get } as unknown as EconomyClientLike,
    derivativesClient: DERIVATIVES_STUB, indexClient: INDEX_STUB,
    equityClient: mkEquityClient({}), equityProvider: 'yfinance',
    hub: { enabled: true, baseUrl: 'https://hub.test' },
  }) }
}

const hubCell = { value: 9, date: '2026-04-01' }
const hubRow = { country: 'united_states', label: 'United States', cpiYoy: hubCell, shortRate: hubCell, cli: hubCell, housePrice: hubCell, sharePrice: hubCell }
const hubMacro = { rows: [hubRow], meta: { provider: 'fred', asOf: '2026-10-25T00:00:00Z' } }

describe('reference service', () => {
  it('rejects malformed hub economic data and sanitizes provider failures for native callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: 'invalid', meta: { provider: 'hub', asOf: '2026-10-25T00:00:00Z' } }))))
    const getCalendar = vi.fn(async () => { throw new Error('private provider request detail') })
    const ref = createReferenceData({ economyClient: { ...ECONOMY_STUB, getCalendar } as unknown as EconomyClientLike, equityClient: mkEquityClient({}), equityProvider: 'yfinance', derivativesClient: DERIVATIVES_STUB, indexClient: INDEX_STUB, hub: { enabled: true, baseUrl: 'https://hub.test' } })
    await expect(ref.economicCalendar()).rejects.toThrow('Economic calendar unavailable. Check the configured market data source.')
    expect(getCalendar).toHaveBeenCalledTimes(1)
  })

  it('serves and caches the existing economic calendar without substituting corporate earnings', async () => {
    const getCalendar = vi.fn(async () => [{ date: '2026-10-25T12:00:00Z', event: 'Example release', actual: 0, consensus: 0, previous: 0 }])
    const ref = createReferenceData({ economyClient: { ...ECONOMY_STUB, getCalendar } as unknown as EconomyClientLike, equityClient: mkEquityClient({}), equityProvider: 'yfinance', derivativesClient: DERIVATIVES_STUB, indexClient: INDEX_STUB })
    expect(await ref.economicCalendar()).toMatchObject({ events: [{ event: 'Example release', actual: 0, consensus: 0, previous: 0 }], meta: { provider: 'fmp', origin: 'local' } })
    await ref.economicCalendar()
    expect(getCalendar).toHaveBeenCalledTimes(1)
    expect(getCalendar).toHaveBeenCalledWith({ provider: 'fmp', start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('builds and caches real local history when the hub only offers a snapshot', async () => {
    const { ref, get } = macroService(hubMacro)
    const board = await ref.globalMacro()
    expect(board.meta).toMatchObject({ provider: 'oecd', origin: 'local' })
    expect(board.rows[0].cpiYoy.history).toHaveLength(2)
    expect(board.rows[0].cpiYoy.value).toBe(2)
    await ref.globalMacro()
    expect(get).toHaveBeenCalledTimes(5)
  })

  it('keeps a history-capable hub and never mixes its values with local history', async () => {
    const { ref, get } = macroService({ ...hubMacro, rows: [{ ...hubRow, cpiYoy: { ...hubCell, history: [{ date: '2026-04-01', value: 9 }] } }] })
    expect((await ref.globalMacro()).meta.origin).toBe('hub')
    expect(get).not.toHaveBeenCalled()
  })

  it('preserves a usable snapshot with a visible history error if local history fails', async () => {
    const { ref } = macroService(hubMacro, true)
    const board = await ref.globalMacro()
    expect(board.rows[0].cpiYoy.value).toBe(9)
    expect(board.meta.origin).toBe('hub')
    expect(board.historyError).toContain('OECD unavailable')
  })

  it('still fails loudly when neither the hub nor local data is available', async () => {
    const { ref } = macroService({}, true)
    await expect(ref.globalMacro()).rejects.toThrow('OECD unavailable')
  })

  it('movers: one list failing does not kill the board', async () => {
    const ref = createReferenceData({
      economyClient: ECONOMY_STUB,
      derivativesClient: DERIVATIVES_STUB,
      indexClient: INDEX_STUB,
      equityClient: mkEquityClient({ getLosers: async () => { throw new Error('boom') } }),
      equityProvider: 'yfinance',
    })
    const board = await ref.movers()
    expect(board.gainers).toHaveLength(1)
    expect(board.losers).toEqual([])
    expect(board.meta.provider).toBe('yfinance')
  })

  it('calendar: partial upstream failure is annotated per list, not silent', async () => {
    const ref = createReferenceData({
      economyClient: ECONOMY_STUB,
      derivativesClient: DERIVATIVES_STUB,
      indexClient: INDEX_STUB,
      equityClient: mkEquityClient({
        getCalendarIpo: async () => { throw new Error('Unauthorized FMP request -> 403') },
      }),
      equityProvider: 'yfinance',
    })
    const board = await ref.calendar()
    expect(board.earnings).toHaveLength(1)
    expect(board.ipos).toEqual([])
    expect(board.errors?.ipos).toMatch(/403/)
    expect(board.errors?.earnings).toBeUndefined()
  })

  it('calendar: all three failing throws loud (missing/invalid key)', async () => {
    const dead = async () => { throw new Error('FMP API key required') }
    const ref = createReferenceData({
      economyClient: ECONOMY_STUB,
      derivativesClient: DERIVATIVES_STUB,
      indexClient: INDEX_STUB,
      equityClient: mkEquityClient({
        getCalendarEarnings: dead, getCalendarIpo: dead, getCalendarDividend: dead,
      }),
      equityProvider: 'yfinance',
    })
    await expect(ref.calendar()).rejects.toThrow(/FMP API key/)
  })

  it('calendar: window defaults to 14 days from today', async () => {
    const ref = createReferenceData({ economyClient: ECONOMY_STUB,
      derivativesClient: DERIVATIVES_STUB, indexClient: INDEX_STUB,
      equityClient: mkEquityClient({}), equityProvider: 'yfinance' })
    const board = await ref.calendar()
    const start = new Date(board.window.start + 'T00:00:00Z').getTime()
    const end = new Date(board.window.end + 'T00:00:00Z').getTime()
    expect(Math.round((end - start) / 86400000)).toBe(14)
  })
})
