import { describe, expect, it, vi } from 'vitest'
import ccxt from 'ccxt'

describe('CCXT 4.5.38 Bitget Classic routing contract', () => {
  it('defaults an unscoped balance read to the spot endpoint', async () => {
    const exchange = new ccxt.bitget()
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchSpotAssets = vi.fn().mockResolvedValue({ data: [] })
    ;(exchange as any).privateSpotGetV2SpotAccountAssets = fetchSpotAssets

    await exchange.fetchBalance()

    expect(fetchSpotAssets).toHaveBeenCalledWith({})
  })

  it('routes an explicit USDT-M balance read to the contract account endpoint', async () => {
    const exchange = new ccxt.bitget()
    exchange.loadMarkets = vi.fn().mockResolvedValue({}) as typeof exchange.loadMarkets
    const fetchContractAssets = vi.fn().mockResolvedValue({ data: [] })
    ;(exchange as any).privateMixGetV2MixAccountAccounts = fetchContractAssets

    await exchange.fetchBalance({ type: 'swap', productType: 'USDT-FUTURES' })

    expect(fetchContractAssets).toHaveBeenCalledWith({ productType: 'USDT-FUTURES' })
  })

  it('routes TP/SL reads to the profit_loss plan namespace', async () => {
    const exchange = new ccxt.bitget()
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
