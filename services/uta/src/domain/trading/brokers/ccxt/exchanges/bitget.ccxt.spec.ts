import { describe, expect, it, vi } from 'vitest'
import ccxt from 'ccxt'

describe('CCXT 4.5.38 Bitget routing contract', () => {
  it('uses the UTA account-assets endpoint when options.uta=true', async () => {
    const exchange = new ccxt.bitget({ options: { uta: true } })
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchUtaAssets = vi.fn().mockResolvedValue({ data: { assets: [] } })
    ;(exchange as any).privateUtaGetV3AccountAssets = fetchUtaAssets

    await exchange.fetchBalance()

    expect(fetchUtaAssets).toHaveBeenCalledWith({})
  })

  it('uses the Classic contract-account endpoint for an explicit USDT-M balance read', async () => {
    const exchange = new ccxt.bitget({ options: { uta: false } })
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchClassicAssets = vi.fn().mockResolvedValue({ data: [] })
    ;(exchange as any).privateMixGetV2MixAccountAccounts = fetchClassicAssets

    await exchange.fetchBalance({ type: 'swap', productType: 'USDT-FUTURES' })

    expect(fetchClassicAssets).toHaveBeenCalledWith({ productType: 'USDT-FUTURES' })
  })

  it('pins UTA spot open orders to category=SPOT', async () => {
    const exchange = new ccxt.bitget({ options: { uta: true } })
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchOpenOrders = vi.fn().mockResolvedValue({ data: [] })
    ;(exchange as any).privateUtaGetV3TradeUnfilledOrders = fetchOpenOrders

    await exchange.fetchOpenOrders(undefined, undefined, undefined, {
      type: 'spot',
      productType: 'SPOT',
      uta: true,
    })

    expect(fetchOpenOrders).toHaveBeenCalledWith({ category: 'SPOT' })
  })

  it('routes Classic TP/SL reads to the profit_loss plan namespace', async () => {
    const exchange = new ccxt.bitget({ options: { uta: false } })
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchPlans = vi.fn().mockResolvedValue({ data: { entrustedList: [] } })
    ;(exchange as any).privateMixGetV2MixOrderOrdersPlanPending = fetchPlans

    await exchange.fetchOpenOrders(undefined, undefined, undefined, {
      type: 'swap',
      productType: 'USDT-FUTURES',
      trigger: true,
      planType: 'profit_loss',
    })

    expect(fetchPlans).toHaveBeenCalledWith({
      productType: 'USDT-FUTURES',
      planType: 'profit_loss',
    })
  })
})
