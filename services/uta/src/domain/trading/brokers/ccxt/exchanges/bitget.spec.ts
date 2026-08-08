import { describe, expect, it, vi } from 'vitest'
import type { Exchange, Order as CcxtOrder } from 'ccxt'
import { bitgetOverrides } from './bitget.js'

function fakeOrder(id: string, symbol: string): CcxtOrder {
  return { id, symbol } as CcxtOrder
}

function fakeExchange(): Exchange {
  return {
    fetchPositions: vi.fn().mockResolvedValue([]),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
  } as unknown as Exchange
}

describe('bitgetOverrides — Classic account reads', () => {
  it('declares separate spot and USDT-M wallets with strict read semantics', () => {
    expect(bitgetOverrides.subAccounts).toEqual([
      { id: 'spot', label: 'Spot', kind: 'spot', walletTypes: ['spot'] },
      { id: 'derivatives', label: 'USDT-M Futures', kind: 'derivatives', walletTypes: ['swap'] },
    ])
    expect(bitgetOverrides.strictPrivateReads).toBe(true)
    expect(bitgetOverrides.strictOpenOrderReads).toBe(true)
  })

  it('pins swap balances to the USDT-FUTURES product', async () => {
    const exchange = fakeExchange()
    const defaultImpl = vi.fn().mockResolvedValue({ USDT: { total: 100 } })

    await bitgetOverrides.fetchBalance!(exchange, { type: 'swap' }, defaultImpl)

    expect(defaultImpl).toHaveBeenCalledWith(exchange, {
      type: 'swap',
      productType: 'USDT-FUTURES',
    })
  })

  it('preserves the spot balance route', async () => {
    const exchange = fakeExchange()
    const defaultImpl = vi.fn().mockResolvedValue({ USDT: { total: 100 } })

    await bitgetOverrides.fetchBalance!(exchange, { type: 'spot' }, defaultImpl)

    expect(defaultImpl).toHaveBeenCalledWith(exchange, { type: 'spot' })
  })

  it('pins positions to USDT-FUTURES', async () => {
    const exchange = fakeExchange()

    await bitgetOverrides.fetchPositions!(exchange, async () => [])

    expect(exchange.fetchPositions).toHaveBeenCalledWith(undefined, {
      productType: 'USDT-FUTURES',
    })
  })

  it('sweeps every spot and USDT-M open-order namespace', async () => {
    const exchange = fakeExchange()
    const fetchOpenOrders = exchange.fetchOpenOrders as ReturnType<typeof vi.fn>
    fetchOpenOrders.mockImplementation(async (_symbol, _since, _limit, params: Record<string, unknown>) => [
      fakeOrder(JSON.stringify(params), params['type'] === 'spot' ? 'ETH/USDT' : 'BTC/USDT:USDT'),
    ])

    const result = await bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])

    expect(fetchOpenOrders.mock.calls.map(call => call[3])).toEqual([
      { type: 'spot' },
      { type: 'spot', trigger: true },
      { type: 'swap', productType: 'USDT-FUTURES' },
      { type: 'swap', productType: 'USDT-FUTURES', trigger: true, planType: 'normal_plan' },
      { type: 'swap', productType: 'USDT-FUTURES', trigger: true, planType: 'profit_loss' },
      { type: 'swap', productType: 'USDT-FUTURES', trailing: true, planType: 'track_plan' },
    ])
    expect(result).toHaveLength(6)
  })

  it('deduplicates an order repeated by overlapping namespaces', async () => {
    const exchange = fakeExchange()
    ;(exchange.fetchOpenOrders as ReturnType<typeof vi.fn>).mockResolvedValue([
      fakeOrder('same-id', 'BTC/USDT:USDT'),
    ])

    const result = await bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])

    expect(result.map(order => order.id)).toEqual(['same-id'])
  })

  it('does not collide equal ids from different symbols', async () => {
    const exchange = fakeExchange()
    const fetchOpenOrders = exchange.fetchOpenOrders as ReturnType<typeof vi.fn>
    let call = 0
    fetchOpenOrders.mockImplementation(async () => [
      fakeOrder('same-id', call++ === 0 ? 'ETH/USDT' : 'BTC/USDT:USDT'),
    ])

    const result = await bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])

    expect(result).toHaveLength(2)
  })

  it('throws when one namespace fails instead of returning a partial list', async () => {
    const exchange = fakeExchange()
    ;(exchange.fetchOpenOrders as ReturnType<typeof vi.fn>).mockImplementation(
      async (_symbol, _since, _limit, params: Record<string, unknown>) => {
        if (params['planType'] === 'profit_loss') throw new Error('bitget permission denied')
        return []
      },
    )

    await expect(bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])).rejects.toThrow('permission denied')
  })
})
