import { describe, it, expect } from 'vitest'
import { createReferenceData } from './service.js'
import type { EconomyClientLike, EquityClientLike } from '../client/types.js'

const ECONOMIC_EVENT = {
  date: '2026-06-12 12:30:00', country: 'US', category: 'Employment', event: 'Nonfarm Payrolls',
  importance: 'High', source: 'BLS', currency: 'USD', unit: 'K', consensus: 150,
  previous: 139, revised: null, actual: null,
}

function mkEconomyClient(overrides: Partial<EconomyClientLike> = {}): EconomyClientLike {
  return {
    getCalendar: async () => [ECONOMIC_EVENT],
    fredSeries: async () => [],
    ...overrides,
  } as unknown as EconomyClientLike
}

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

describe('reference service', () => {
  it('movers: one list failing does not kill the board', async () => {
    const ref = createReferenceData({
      economyClient: mkEconomyClient(),
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
      economyClient: mkEconomyClient(),
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
    expect(board.economicEvents).toEqual([ECONOMIC_EVENT])
  })

  it('calendar: macro events can fail independently without hiding company events', async () => {
    const ref = createReferenceData({
      economyClient: mkEconomyClient({
        getCalendar: async () => { throw new Error('Economic calendar unavailable') },
      }),
      derivativesClient: DERIVATIVES_STUB,
      indexClient: INDEX_STUB,
      equityClient: mkEquityClient({}),
      equityProvider: 'yfinance',
    })
    const board = await ref.calendar()
    expect(board.economicEvents).toEqual([])
    expect(board.earnings).toHaveLength(1)
    expect(board.errors?.economicEvents).toMatch(/unavailable/)
  })

  it('calendar: all four lists failing throws loud (missing/invalid key)', async () => {
    const dead = async () => { throw new Error('FMP API key required') }
    const ref = createReferenceData({
      economyClient: mkEconomyClient({ getCalendar: dead }),
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
    const ref = createReferenceData({ economyClient: mkEconomyClient(),
      derivativesClient: DERIVATIVES_STUB, indexClient: INDEX_STUB,
      equityClient: mkEquityClient({}), equityProvider: 'yfinance' })
    const board = await ref.calendar()
    const start = new Date(board.window.start + 'T00:00:00Z').getTime()
    const end = new Date(board.window.end + 'T00:00:00Z').getTime()
    expect(Math.round((end - start) / 86400000)).toBe(14)
  })
})
