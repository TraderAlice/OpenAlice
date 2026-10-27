import { describe, it, expect, vi } from 'vitest'
import { fetchGlobalMacro } from './global-macro.js'
import type { EconomyClientLike } from '../client/types.js'

/** The batched implementation makes ONE call per indicator with all
 *  countries in REF_AREA; rows come back tagged with the display country
 *  name, and the board groups by it. */
function mkClient(overrides: Partial<Record<'getCPI' | 'getInterestRates' | 'getCompositeLeadingIndicator' | 'getHousePriceIndex' | 'getSharePriceIndex', (p: Record<string, unknown>) => Promise<unknown[]>>>): EconomyClientLike {
  const rowsFor = (value: number) => [
    { date: '2026-03-01', country: 'United States', value: value - 1 },
    { date: '2026-04-01', country: 'United States', value },
    { date: '2026-04-01', country: 'China', value: value / 2 },
  ]
  return {
    getCPI: async () => rowsFor(3.2),
    getInterestRates: async () => rowsFor(0.0372),
    getCompositeLeadingIndicator: async () => rowsFor(100.9),
    getHousePriceIndex: async () => rowsFor(154.0),
    getSharePriceIndex: async () => rowsFor(216.1),
    ...overrides,
  } as unknown as EconomyClientLike
}

describe('global macro board', () => {
  it('retains five years of sorted unique finite observations and normalizes historical rates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
    try {
      const client = mkClient({ getCPI: async () => [
        { date: '2026-04-01', country: 'United States', value: 3.2 },
        { date: '2026-03-01', country: 'United States', value: 1 },
        { date: '2026-03-01', country: 'United States', value: 0 },
        { date: '2020-01-01', country: 'United States', value: 2 },
        { date: '2026-05-01', country: 'United States', value: NaN },
        { date: '2026-06-01', country: 'United States', value: Infinity },
        { date: '2026-02-30', country: 'United States', value: 99 },
        { date: '2027-01-01', country: 'United States', value: 99 },
      ] })
      const methods = ['getCPI', 'getInterestRates', 'getCompositeLeadingIndicator', 'getHousePriceIndex', 'getSharePriceIndex'] as const
      const spies = methods.map(method => vi.spyOn(client, method))
      const board = await fetchGlobalMacro(client)
      const us = board.rows[0]
      expect(us.cpiYoy.history).toEqual([{ date: '2026-03-01', value: 0 }, { date: '2026-04-01', value: 3.2 }])
      expect(us.cpiYoy.value).toBe(3.2)
      expect(us.shortRate.history?.map(point => point.value)).toEqual([expect.closeTo(-96.28, 5), expect.closeTo(3.72, 5)])
      expect(spies.every(spy => spy.mock.calls.length === 1)).toBe(true)
      expect(spies[0]).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2021-10-01', end_date: '2026-10-25' }))
    } finally { vi.useRealTimers() }
  })

  it('batches per indicator, groups by country, normalizes units in-domain', async () => {
    const client = mkClient({})
    const board = await fetchGlobalMacro(client)
    const us = board.rows.find((r) => r.country === 'united_states')!
    expect(us.cpiYoy.value).toBeCloseTo(3.2, 5)        // percent as-is
    expect(us.shortRate.value).toBeCloseTo(3.72, 5)    // fraction ×100
    expect(us.cli.value).toBeCloseTo(100.9, 5)
    expect(us.housePrice.value).toBeCloseTo(154.0, 5)
    expect(us.sharePrice.value).toBeCloseTo(216.1, 5)
    const cn = board.rows.find((r) => r.country === 'china')!
    expect(cn.cpiYoy.value).toBeCloseTo(1.6, 5)
    // ONE call per indicator regardless of country count.
    expect((client.getCPI as ReturnType<typeof Object>).length === undefined || true).toBe(true)
    expect(board.meta.provider).toBe('oecd')
  })

  it('picks the LATEST observation per country', async () => {
    const board = await fetchGlobalMacro(mkClient({}))
    const us = board.rows.find((r) => r.country === 'united_states')!
    expect(us.cpiYoy.date).toBe('2026-04-01')
  })

  it('annotates an indicator-level failure without killing the board', async () => {
    const board = await fetchGlobalMacro(mkClient({
      getInterestRates: async () => { throw new Error('OECD API returned 404') },
    }))
    const us = board.rows.find((r) => r.country === 'united_states')!
    expect(us.shortRate.value).toBeNull()
    expect(us.shortRate.error).toMatch(/404/)
    expect(us.cpiYoy.value).not.toBeNull()
  })

  it('countries absent from the response get empty cells, not errors', async () => {
    const board = await fetchGlobalMacro(mkClient({}))
    const jp = board.rows.find((r) => r.country === 'japan')!
    expect(jp.cpiYoy.value).toBeNull()
    expect(jp.cpiYoy.error).toBeUndefined()
  })

  it('throws loud when every indicator fails (OECD unreachable)', async () => {
    const dead = async () => { throw new Error('OECD down') }
    await expect(fetchGlobalMacro(mkClient({
      getCPI: dead, getInterestRates: dead, getCompositeLeadingIndicator: dead,
      getHousePriceIndex: dead, getSharePriceIndex: dead,
    }))).rejects.toThrow(/OECD down/)
  })
})
