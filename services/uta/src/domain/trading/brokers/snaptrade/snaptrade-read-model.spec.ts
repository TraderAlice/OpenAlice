import { describe, expect, it } from 'vitest'
import { assessSnapTradeConnection, mapSnapTradeEquityPosition } from './snaptrade-read-model.js'

describe('SnapTrade read model', () => {
  it('only admits enabled realtime read-only connections to intraday monitoring', () => {
    expect(assessSnapTradeConnection({ id: 'rh', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: false, data_freshness_mode: 'realtime' }))
      .toEqual({ eligible: true, freshness: 'realtime' })
    expect(assessSnapTradeConnection({ id: 'stale', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: false, data_freshness_mode: 'delayed' }))
      .toEqual({ eligible: false, reason: 'delayed' })
    expect(assessSnapTradeConnection({ id: 'disabled', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: true, data_freshness_mode: 'realtime' }))
      .toEqual({ eligible: false, reason: 'disabled' })
  })

  it('maps fractional equity positions without silently treating options as stock', () => {
    const position = mapSnapTradeEquityPosition({
      instrument: { id: 'instrument', kind: 'stock', symbol: 'MU', raw_symbol: 'MU', currency: 'USD', exchange: 'XNAS' },
      units: '0.323875', price: '964.47', cost_basis: '926.28', currency: 'USD',
    })
    expect(position.contract.secType).toBe('STK')
    expect(position.quantity.toString()).toBe('0.323875')
    expect(position.unrealizedPnL).toBe('12.36878625')

    expect(() => mapSnapTradeEquityPosition({
      instrument: { id: 'option', kind: 'option', symbol: 'MU 2027 C', currency: 'USD' },
      units: '1', price: '3', cost_basis: '2', currency: 'USD',
    })).toThrow(/unsupported kind/)
  })
})
