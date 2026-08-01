import { describe, expect, it, vi } from 'vitest'
import type { Exchange, Order as CcxtOrder } from 'ccxt'
import { bitgetOverrides } from './bitget.js'

function fakeOrder(id: string, symbol: string): CcxtOrder {
  return { id, symbol } as CcxtOrder
}

function fakeExchange(uta: boolean): Exchange {
  return {
    options: { uta },
    fetchPositions: vi.fn().mockResolvedValue([]),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
  } as unknown as Exchange
}

describe('bitgetOverrides', () => {
  it('models classic accounts as separate spot and USDT-M wallets', () => {
    const exchange = fakeExchange(false)

    expect(bitgetOverrides.resolveSubAccounts!(exchange)).toEqual([
      { id: 'spot', label: 'Spot', kind: 'spot', walletTypes: ['spot'] },
      { id: 'derivatives', label: 'USDT-M Futures', kind: 'derivatives', walletTypes: ['swap'] },
    ])
  })

  it('models UTA accounts as one unified wallet', () => {
    const exchange = fakeExchange(true)

    expect(bitgetOverrides.resolveSubAccounts!(exchange)).toEqual([
      { id: 'default', label: 'Unified Account', kind: 'unified', walletTypes: [] },
    ])
  })

  it('uses Bitget UTA equity rather than CCXT 4.5.38 balance for normalized totals', async () => {
    const exchange = fakeExchange(true)
    const defaultImpl = vi.fn().mockResolvedValue({
      info: [{ coin: 'USDT', balance: '100', equity: '112.5' }],
      USDT: { free: 80, used: 20, total: 100 },
    })

    const balance = await bitgetOverrides.fetchBalance!(exchange, undefined, defaultImpl)

    expect((balance['USDT'] as Record<string, unknown>)['total']).toBe('112.5')
  })

  it('does not rewrite Classic balance totals', async () => {
    const exchange = fakeExchange(false)
    const defaultImpl = vi.fn().mockResolvedValue({
      info: [{ coin: 'USDT', balance: '100', equity: '112.5' }],
      USDT: { total: 100 },
    })

    const balance = await bitgetOverrides.fetchBalance!(exchange, { type: 'spot' }, defaultImpl)

    expect((balance['USDT'] as Record<string, unknown>)['total']).toBe(100)
    expect(defaultImpl).toHaveBeenCalledWith(exchange, { type: 'spot' })
  })

  it('pins Classic swap balances to USDT-FUTURES', async () => {
    const exchange = fakeExchange(false)
    const defaultImpl = vi.fn().mockResolvedValue({ USDT: { total: 100 } })

    await bitgetOverrides.fetchBalance!(exchange, { type: 'swap' }, defaultImpl)

    expect(defaultImpl).toHaveBeenCalledWith(exchange, {
      type: 'swap',
      productType: 'USDT-FUTURES',
    })
  })

  it('pins classic positions to USDT-FUTURES instead of relying on CCXT defaults', async () => {
    const exchange = fakeExchange(false)

    await bitgetOverrides.fetchPositions!(exchange, async () => [])

    expect(exchange.fetchPositions).toHaveBeenCalledWith(undefined, {
      productType: 'USDT-FUTURES',
    })
  })

  it('routes UTA positions to the v3 account surface', async () => {
    const exchange = fakeExchange(true)

    await bitgetOverrides.fetchPositions!(exchange, async () => [])

    expect(exchange.fetchPositions).toHaveBeenCalledWith(undefined, {
      productType: 'USDT-FUTURES',
      uta: true,
    })
  })

  it('sweeps every classic spot and USDT-M open-order namespace', async () => {
    const exchange = fakeExchange(false)
    const fetchOpenOrders = exchange.fetchOpenOrders as ReturnType<typeof vi.fn>
    fetchOpenOrders.mockImplementation(async (_symbol, _since, _limit, params: Record<string, unknown>) => {
      return [fakeOrder(JSON.stringify(params), params['type'] === 'spot' ? 'ETH/USDT' : 'BTC/USDT:USDT')]
    })

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

  it('sweeps regular and strategy orders for both UTA categories', async () => {
    const exchange = fakeExchange(true)
    const fetchOpenOrders = exchange.fetchOpenOrders as ReturnType<typeof vi.fn>
    fetchOpenOrders.mockImplementation(async (_symbol, _since, _limit, params: Record<string, unknown>) => {
      return [fakeOrder(JSON.stringify(params), params['type'] === 'spot' ? 'ETH/USDT' : 'BTC/USDT:USDT')]
    })

    const result = await bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])

    expect(fetchOpenOrders.mock.calls.map(call => call[3])).toEqual([
      { type: 'spot', productType: 'SPOT', uta: true },
      { type: 'spot', productType: 'SPOT', uta: true, trigger: true },
      { type: 'swap', productType: 'USDT-FUTURES', uta: true },
      { type: 'swap', productType: 'USDT-FUTURES', uta: true, trigger: true },
    ])
    expect(result).toHaveLength(4)
  })

  it('deduplicates orders that appear in more than one namespace', async () => {
    const exchange = fakeExchange(true)
    ;(exchange.fetchOpenOrders as ReturnType<typeof vi.fn>).mockResolvedValue([
      fakeOrder('same-id', 'BTC/USDT:USDT'),
    ])

    const result = await bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])

    expect(result.map(order => order.id)).toEqual(['same-id'])
  })

  it('throws when any namespace fails so partial reads cannot masquerade as no orders', async () => {
    const exchange = fakeExchange(false)
    ;(exchange.fetchOpenOrders as ReturnType<typeof vi.fn>).mockImplementation(
      async (_symbol, _since, _limit, params: Record<string, unknown>) => {
        if (params['planType'] === 'profit_loss') throw new Error('bitget permission denied')
        return []
      },
    )

    await expect(bitgetOverrides.fetchAllOpenOrders!(exchange, async () => [])).rejects.toThrow('permission denied')
  })
})
