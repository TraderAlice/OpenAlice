/**
 * createCcxtProviderTools — unit tests.
 *
 * Verifies the AI-tool layer correctly resolves aliceId via
 * `uta.contractFromAliceId` before forwarding to the broker. Bug history:
 * the prior implementation stamped the raw input on `Contract.aliceId` and
 * passed it through, leaving `contractToCcxt` unable to resolve.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { asSchema } from 'ai'

// Mock ccxt BEFORE importing CcxtBroker (mirrors CcxtBroker.spec.ts).
vi.mock('ccxt', () => {
  const MockExchange = vi.fn(function (this: any) {
    // `id` is what CcxtBroker.resolveNativeKey forwards to marketToContract
    // as the exchange tag. Empty id → buildContract rejects.
    this.id = 'bybit'
    this.markets = {}
    this.options = { fetchMarkets: { types: ['spot', 'linear'] } }
    this.setSandboxMode = vi.fn()
    this.loadMarkets = vi.fn().mockResolvedValue({})
    this.fetchMarkets = vi.fn().mockResolvedValue([])
    this.fetchOrderBook = vi.fn()
    this.fetchFundingRate = vi.fn()
  })
  return { default: { bybit: MockExchange, binance: MockExchange } }
})

import { CcxtBroker } from './CcxtBroker.js'
import { createCcxtProviderTools } from './ccxt-tools.js'
import { MockBroker } from '../mock/MockBroker.js'
import { UTAManager } from '../../uta-manager.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import '../../contract-ext.js'

function makeSwapMarket(base: string, quote: string): any {
  return {
    id: `${base}${quote}`,
    symbol: `${base}/${quote}:${quote}`,
    base, quote,
    type: 'swap',
    active: true,
    precision: { price: 0.01 },
    limits: {},
    settle: quote,
  }
}

function makeCcxtUta(): { uta: UnifiedTradingAccount; broker: CcxtBroker; mgr: UTAManager } {
  const broker = new CcxtBroker({ exchange: 'bybit', apiKey: 'k', secret: 's', sandbox: false })
  ;(broker as any).initialized = true
  // CcxtBroker.markets is a getter that reads from exchange.markets — set there.
  ;(broker as any).exchange.markets = {
    'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT'),
  }
  // UTA._connect runs broker.init + broker.getAccount in the constructor; the
  // ccxt mock has no real init wiring, so stub both to no-op so the UTA stays
  // enabled. We're not exercising the connection path here — only resolution.
  vi.spyOn(broker, 'init').mockResolvedValue(undefined)
  vi.spyOn(broker, 'getAccount').mockResolvedValue({
    netLiquidation: '0', totalCashValue: '0', buyingPower: '0',
    unrealizedPnL: '0', realizedPnL: '0', currency: 'USD',
  } as any)
  vi.spyOn(broker, 'getPositions').mockResolvedValue([])
  vi.spyOn(broker, 'getOrders').mockResolvedValue([])
  const uta = new UnifiedTradingAccount(broker)
  const mgr = new UTAManager()
  mgr.add(uta)
  return { uta, broker, mgr }
}

describe('createCcxtProviderTools — getOrderBook', () => {
  let broker: CcxtBroker
  let mgr: UTAManager

  beforeEach(() => {
    ({ broker, mgr } = makeCcxtUta())
    ;(broker as any).exchange.fetchOrderBook = vi.fn().mockResolvedValue({
      bids: [[100, 1], [99, 2]],
      asks: [[101, 1], [102, 2]],
      timestamp: Date.now(),
    })
  })

  it('resolves aliceId via UTA and forwards a Contract with localSymbol', async () => {
    const tools = createCcxtProviderTools(mgr)
    const brokerSpy = vi.spyOn(broker, 'getOrderBook')

    const result = await (tools.getOrderBook.execute as Function)({
      aliceId: 'bybit-main|BTC/USDT:USDT',
    })

    expect(brokerSpy).toHaveBeenCalledTimes(1)
    const [passedContract] = brokerSpy.mock.calls[0]
    // Without contractFromAliceId, localSymbol would be empty and
    // contractToCcxt would fail.
    expect(passedContract.localSymbol).toBe('BTC/USDT:USDT')
    expect(passedContract.aliceId).toBe('bybit-main|BTC/USDT:USDT')
    expect(result.source).toBe('bybit-main')
    expect(result.bids).toHaveLength(2)
  })

  it('returns error on malformed aliceId', async () => {
    const tools = createCcxtProviderTools(mgr)
    const result = await (tools.getOrderBook.execute as Function)({
      aliceId: 'no-separator-here',
    })
    expect(result.error).toMatch(/Invalid aliceId/)
  })

  it('returns error when aliceId points to a different UTA', async () => {
    const tools = createCcxtProviderTools(mgr)
    const result = await (tools.getOrderBook.execute as Function)({
      aliceId: 'other-account|BTC/USDT:USDT',
    })
    expect(result.error).toMatch(/belongs to UTA "other-account"/)
  })

  it('returns error when no CCXT account is registered', async () => {
    const mgrOnlyMock = new UTAManager()
    mgrOnlyMock.add(new UnifiedTradingAccount(new MockBroker({ id: 'mock-paper' })))
    const tools = createCcxtProviderTools(mgrOnlyMock)
    const result = await (tools.getOrderBook.execute as Function)({
      aliceId: 'mock-paper|BTC',
    })
    expect(result.error).toMatch(/No CCXT account available/)
  })

  it('accepts order-book limit 400 and forwards it to broker.getOrderBook', async () => {
    const tools = createCcxtProviderTools(mgr)
    const brokerSpy = vi.spyOn(broker, 'getOrderBook')

    const result = await (tools.getOrderBook.execute as Function)({
      aliceId: 'bybit-main|BTC/USDT:USDT',
      limit: 400,
    })

    expect(brokerSpy).toHaveBeenCalledTimes(1)
    expect(brokerSpy.mock.calls[0][1]).toBe(400)
    expect(result.source).toBe('bybit-main')
  })

  it('rejects order-book limit 5001 before calling broker.getOrderBook', async () => {
    const tools = createCcxtProviderTools(mgr)
    const brokerSpy = vi.spyOn(broker, 'getOrderBook')

    const validation = await asSchema(tools.getOrderBook.inputSchema).validate?.({
      aliceId: 'bybit-main|BTC/USDT:USDT',
      limit: 5001,
    })
    expect(validation?.success).toBe(false)
    expect(brokerSpy).not.toHaveBeenCalled()
  })
})

describe('createCcxtProviderTools — getFundingRate', () => {
  it('resolves aliceId via UTA and forwards Contract to broker.getFundingRate', async () => {
    const { broker, mgr } = makeCcxtUta()
    ;(broker as any).exchange.fetchFundingRate = vi.fn().mockResolvedValue({
      fundingRate: 0.0001,
      fundingDatetime: new Date().toISOString(),
      timestamp: Date.now(),
    })
    const brokerSpy = vi.spyOn(broker, 'getFundingRate')
    const tools = createCcxtProviderTools(mgr)

    const result = await (tools.getFundingRate.execute as Function)({
      aliceId: 'bybit-main|BTC/USDT:USDT',
    })

    expect(brokerSpy).toHaveBeenCalledTimes(1)
    const [passedContract] = brokerSpy.mock.calls[0]
    expect(passedContract.localSymbol).toBe('BTC/USDT:USDT')
    expect(result.source).toBe('bybit-main')
    expect(result.fundingRate).toBe(0.0001)
  })
})
