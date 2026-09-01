import { describe, expect, it, vi } from 'vitest'
import { Contract, Order } from '@traderalice/ibkr'
import { SnapTradeBroker } from './SnapTradeBroker.js'
import { SnapTradeClient } from './snaptrade-client.js'

function brokerWith(fetchImpl: typeof fetch) {
  return new SnapTradeBroker({ clientId: 'client', consumerKey: 'secret', authorizationId: 'auth-1', accountId: 'account-1' }, new SnapTradeClient({ clientId: 'client', consumerKey: 'secret' }, fetchImpl, () => 1_700_000_000_000))
}

describe('SnapTradeBroker', () => {
  it('accepts only realtime read connections and reads fractional stock positions', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'auth-1', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: false, data_freshness_mode: 'realtime' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'auth-1', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: false, data_freshness_mode: 'realtime' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ currency: { code: 'USD' }, cash: 543.29, buying_power: 543.29 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ instrument: { id: 'i-1', kind: 'stock', symbol: 'AMZN', currency: 'USD' }, units: '2.026794', price: '246.97', cost_basis: '246.70' }] }), { status: 200 }))
    const broker = brokerWith(fetchImpl)
    await broker.init()
    const account = await broker.getAccount()
    expect(account.totalCashValue).toBe('543.29')
    expect(account.netLiquidation).toBe('1043.84731418')
    expect(fetchImpl.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual(['GET', 'GET', 'GET', 'GET'])
  })

  it('never sends a write request', async () => {
    const fetchImpl = vi.fn()
    const broker = brokerWith(fetchImpl)
    const contract = new Contract(); contract.symbol = 'AMZN'; contract.localSymbol = 'AMZN'; contract.secType = 'STK'; contract.exchange = 'SMART'; contract.currency = 'USD'
    await expect(broker.placeOrder(contract, new Order())).rejects.toMatchObject({ code: 'CONFIG', permanent: true })
    await expect(broker.cancelOrder('order-1')).rejects.toMatchObject({ code: 'CONFIG', permanent: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects delayed connections before account coverage starts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'auth-1', brokerage: { slug: 'ROBINHOOD' }, type: 'read', disabled: false, data_freshness_mode: 'delayed' }]), { status: 200 }))
    await expect(brokerWith(fetchImpl).init()).rejects.toMatchObject({ code: 'AUTH', permanent: true })
  })
})
