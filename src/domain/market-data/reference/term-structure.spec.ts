import { describe, it, expect } from 'vitest'
import { fetchTermStructure } from './term-structure.js'
import type { DerivativesClientLike } from '../client/types.js'

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

function mkClient(impl: (params: Record<string, unknown>) => Promise<Record<string, unknown>[]>): DerivativesClientLike {
  return { getFuturesCurve: impl } as unknown as DerivativesClientLike
}

describe('term structure board', () => {
  it('anchors on the perpetual and annualizes the basis', async () => {
    const expiry = isoDaysFromNow(365)
    const client = mkClient(async ({ symbol }) => [
      { date: '2026-06-10', expiration: 'PERPETUAL', price: 100000 },
      { date: '2026-06-10', expiration: expiry, price: 105000 },
    ].map((r) => (symbol === 'ETH' ? { ...r, price: (r.price as number) / 20 } : r)))
    const board = await fetchTermStructure(client)
    const btc = board.curves.find((c) => c.symbol === 'BTC')!
    expect(btc.spot).toBe(100000)
    expect(btc.points).toHaveLength(1)
    // 5% over ~365 days ≈ 5% annualized (within rounding of the date math).
    expect(btc.points[0].annualizedBasis).toBeGreaterThan(4.5)
    expect(btc.points[0].annualizedBasis).toBeLessThan(5.5)
    expect(board.curves.map((c) => c.symbol)).toEqual(['BTC', 'ETH'])
  })

  it('skips basis below the 7-day floor (annualization explodes)', async () => {
    const client = mkClient(async () => [
      { date: '2026-06-10', expiration: 'PERPETUAL', price: 100000 },
      { date: '2026-06-10', expiration: isoDaysFromNow(5), price: 100100 },
    ])
    const board = await fetchTermStructure(client)
    expect(board.curves[0].points[0].annualizedBasis).toBeNull()
  })

  it('one symbol failing is annotated, both failing throws', async () => {
    const partial = mkClient(async ({ symbol }) => {
      if (symbol === 'ETH') throw new Error('deribit down')
      return [{ date: '2026-06-10', expiration: 'PERPETUAL', price: 100000 }]
    })
    const board = await fetchTermStructure(partial)
    expect(board.curves).toHaveLength(1)
    expect(board.errors?.ETH).toMatch(/deribit/)

    const dead = mkClient(async () => { throw new Error('deribit down') })
    await expect(fetchTermStructure(dead)).rejects.toThrow(/deribit/)
  })
})
