import { describe, it, expect } from 'vitest'
import { fetchMacroBoard } from './macro.js'
import type { EconomyClientLike } from '../client/types.js'

/** 26 monthly rows: DFF flat-ish, CPIAUCSL compounding ~3%/yr. */
function mkRows() {
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 26; i++) {
    const date = `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`
    rows.push({
      date,
      DFF: 5 + i * 0.01,
      CPIAUCSL: 100 * Math.pow(1.03, i / 12),
    })
  }
  return rows
}

function mkEconomyClient(rows = mkRows()): EconomyClientLike {
  return {
    fredSeries: async () => rows,
  } as unknown as EconomyClientLike
}

describe('macro board', () => {
  it('builds cards with latest/change and drops missing series gracefully', async () => {
    const board = await fetchMacroBoard(mkEconomyClient())
    const dff = board.cards.find((c) => c.id === 'DFF')!
    expect(dff.latest).toBeCloseTo(5.25, 5)
    expect(dff.change).toBeCloseTo(0.01, 5)
    // Series absent from the response → empty card, not a crash.
    const wti = board.cards.find((c) => c.id === 'DCOILWTICO')!
    expect(wti.points).toEqual([])
    expect(wti.latest).toBeNull()
    expect(board.meta.provider).toBe('federal_reserve')
  })

  it('derives CPI YoY from the index (≈3% on a 3%-compounding series)', async () => {
    const board = await fetchMacroBoard(mkEconomyClient())
    const cpi = board.cards.find((c) => c.id === 'CPI_YOY')!
    expect(cpi.points.length).toBe(26 - 12)
    expect(cpi.latest).toBeCloseTo(3, 1)
    expect(cpi.unit).toBe('percent')
  })

  it('derives CPI YoY by matching the same date one year earlier, not by row offset', async () => {
    const rows = mkRows().filter((r) => r.date !== '2025-10-01')
    const board = await fetchMacroBoard(mkEconomyClient(rows))
    const cpi = board.cards.find((c) => c.id === 'CPI_YOY')!
    const nov = cpi.points.find((p) => p.date === '2025-11-01')

    expect(nov?.value).toBeCloseTo(3, 5)
  })

  it('skips CPI YoY points when the matching prior-year date is absent', async () => {
    const rows = mkRows().filter((r) => r.date !== '2024-11-01')
    const board = await fetchMacroBoard(mkEconomyClient(rows))
    const cpi = board.cards.find((c) => c.id === 'CPI_YOY')!

    expect(cpi.points.some((p) => p.date === '2025-11-01')).toBe(false)
  })

  it('propagates the upstream failure (missing FRED key) loudly', async () => {
    const client = { fredSeries: async () => { throw new Error('FRED api_key required') } } as unknown as EconomyClientLike
    await expect(fetchMacroBoard(client)).rejects.toThrow(/FRED/)
  })
})
