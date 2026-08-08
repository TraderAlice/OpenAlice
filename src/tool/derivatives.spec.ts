import { describe, expect, it, vi } from 'vitest'
import { createDerivativesTools } from './derivatives.js'

describe('equityOptionsHistory', () => {
  it('routes one bounded historical chain request to MarketData', async () => {
    const getOptionsChains = vi.fn(async () => [{ contract_symbol: 'MSTR260918P00095000' }])
    const tool = createDerivativesTools({ getOptionsChains } as never).equityOptionsHistory

    const result = await tool.execute!({
      symbol: 'MSTR', date: '2026-07-20', expiration: '2026-09-18',
      side: 'put', minStrike: 90, maxStrike: 100,
    }, { toolCallId: 'test', messages: [] })

    expect(result).toHaveLength(1)
    expect(getOptionsChains).toHaveBeenCalledWith({
      provider: 'marketdata', symbol: 'MSTR', date: '2026-07-20', expiration: '2026-09-18',
      side: 'put', strike_min: 90, strike_max: 100,
    })
  })
})
