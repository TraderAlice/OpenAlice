import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { Decimal as LongbridgeDecimal } from 'longbridge'
import { LongbridgeBroker, ibkrOrderTypeToLb, ibkrTifToLb } from './LongbridgeBroker.js'
import { makeContract, parseLbSymbol, resolveSymbol, mapLbOrderStatus } from './longbridge-contracts.js'
import '../../contract-ext.js'

// ==================== Longbridge SDK mock ====================

vi.mock('longbridge', () => {
  class MockLongbridgeDecimal {
    private readonly value: string

    constructor(value: string | number) {
      this.value = String(value)
    }

    toString(): string {
      return this.value
    }
  }

  // Numeric enum values mirror the const enum in node_modules/longbridge/index.d.ts.
  const OrderSide = { Unknown: 0, Buy: 1, Sell: 2 } as const
  const OrderType = {
    Unknown: 0, LO: 1, ELO: 2, MO: 3, AO: 4, ALO: 5, ODD: 6,
    LIT: 7, MIT: 8, TSLPAMT: 9, TSLPPCT: 10, TSMAMT: 11, TSMPCT: 12, SLO: 13,
  } as const
  const TimeInForceType = { Unknown: 0, Day: 1, GoodTilCanceled: 2, GoodTilDate: 3 } as const
  const Market = { Unknown: 0, US: 1, HK: 2, CN: 3, SG: 4, Crypto: 5 } as const

  return {
    Decimal: MockLongbridgeDecimal,
    Config: { fromApikey: vi.fn(() => ({ __config: true })) },
    TradeContext: {
      new: vi.fn(() => ({
        accountBalance: vi.fn(),
        stockPositions: vi.fn(),
        submitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        replaceOrder: vi.fn(),
        orderDetail: vi.fn(),
      })),
    },
    QuoteContext: {
      new: vi.fn(() => ({
        quote: vi.fn(),
        depth: vi.fn(),
        staticInfo: vi.fn(),
        tradingSession: vi.fn(),
      })),
    },
    OrderSide,
    OrderType,
    TimeInForceType,
    Market,
  }
})

function expectLongbridgeDecimal(value: unknown, expected: string): void {
  expect(value).toBeInstanceOf(LongbridgeDecimal)
  expect(String(value)).toBe(expected)
}

// Helper: stamp mock contexts onto a freshly-constructed broker so we can
// drive method outcomes without going through init().
function attachMockContexts(broker: LongbridgeBroker): {
  trade: Record<string, ReturnType<typeof vi.fn>>
  quote: Record<string, ReturnType<typeof vi.fn>>
} {
  const trade = {
    accountBalance: vi.fn(),
    stockPositions: vi.fn(),
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
    replaceOrder: vi.fn(),
    orderDetail: vi.fn(),
  }
  const quote = {
    quote: vi.fn(),
    depth: vi.fn(),
    staticInfo: vi.fn(),
    tradingSession: vi.fn(),
    optionQuote: vi.fn(),
    warrantQuote: vi.fn(),
  }
  ;(broker as unknown as { tradeCtx: typeof trade; quoteCtx: typeof quote }).tradeCtx = trade
  ;(broker as unknown as { tradeCtx: typeof trade; quoteCtx: typeof quote }).quoteCtx = quote
  return { trade, quote }
}

function makeBroker(overrides: Partial<{ paper: boolean; id?: string }> = {}): LongbridgeBroker {
  return new LongbridgeBroker({
    appKey: 'k',
    appSecret: 's',
    accessToken: 't',
    paper: overrides.paper ?? true,
    id: overrides.id,
  })
}

// ==================== Symbol parsing & contract resolution ====================

describe('parseLbSymbol', () => {
  it('parses HK suffix', () => {
    expect(parseLbSymbol('700.HK')).toEqual({ ticker: '700', suffix: 'HK' })
  })

  it('parses US suffix', () => {
    expect(parseLbSymbol('AAPL.US')).toEqual({ ticker: 'AAPL', suffix: 'US' })
  })

  it('parses Shanghai .SH', () => {
    expect(parseLbSymbol('600519.SH')).toEqual({ ticker: '600519', suffix: 'SH' })
  })

  it('parses Shenzhen .SZ', () => {
    expect(parseLbSymbol('000001.SZ')).toEqual({ ticker: '000001', suffix: 'SZ' })
  })

  it('treats bare ticker as US fallback', () => {
    expect(parseLbSymbol('TSLA')).toEqual({ ticker: 'TSLA', suffix: 'US' })
  })
})

describe('makeContract', () => {
  it('HK symbol → SEHK / HKD', () => {
    const c = makeContract('700.HK')
    expect(c.symbol).toBe('700')
    expect(c.localSymbol).toBe('700.HK')
    expect(c.exchange).toBe('SEHK')
    expect(c.currency).toBe('HKD')
    expect(c.secType).toBe('STK')
  })

  it('US symbol → SMART / USD', () => {
    const c = makeContract('AAPL.US')
    expect(c.exchange).toBe('SMART')
    expect(c.currency).toBe('USD')
  })

  it('Shanghai symbol → SSE / CNY', () => {
    const c = makeContract('600519.SH')
    expect(c.exchange).toBe('SSE')
    expect(c.currency).toBe('CNY')
  })

  it('Shenzhen symbol → SZSE / CNY', () => {
    const c = makeContract('000001.SZ')
    expect(c.exchange).toBe('SZSE')
    expect(c.currency).toBe('CNY')
  })

  it('SG symbol → SGX / SGD', () => {
    const c = makeContract('D05.SG')
    expect(c.exchange).toBe('SGX')
    expect(c.currency).toBe('SGD')
  })
})

describe('resolveSymbol round-trip', () => {
  it('preserves localSymbol', () => {
    const c = makeContract('700.HK')
    expect(resolveSymbol(c)).toBe('700.HK')
  })

  it('falls back to aliceId native key', () => {
    const c = new Contract()
    c.aliceId = 'longbridge-main|TSLA.US'
    c.symbol = ''
    expect(resolveSymbol(c)).toBe('TSLA.US')
  })

  it('infers .HK from currency=HKD', () => {
    const c = new Contract()
    c.symbol = '700'
    c.currency = 'HKD'
    expect(resolveSymbol(c)).toBe('700.HK')
  })

  it('returns null for empty contract', () => {
    const c = new Contract()
    c.symbol = ''
    expect(resolveSymbol(c)).toBeNull()
  })
})

// ==================== Order-type translation ====================

describe('ibkrOrderTypeToLb', () => {
  it('MKT on HK → ELO (real MO not accepted on HK)', () => {
    expect(ibkrOrderTypeToLb('MKT', 'HK')).toBe(2 /* ELO */)
  })

  it('MKT on US → MO', () => {
    expect(ibkrOrderTypeToLb('MKT', 'US')).toBe(3 /* MO */)
  })

  it('LMT → LO', () => {
    expect(ibkrOrderTypeToLb('LMT', 'HK')).toBe(1 /* LO */)
    expect(ibkrOrderTypeToLb('LMT', 'US')).toBe(1)
  })

  it('STP → MIT', () => {
    expect(ibkrOrderTypeToLb('STP', 'US')).toBe(8 /* MIT */)
  })

  it('STP LMT → LIT', () => {
    expect(ibkrOrderTypeToLb('STP LMT', 'US')).toBe(7 /* LIT */)
  })

  it('TRAIL → TSMPCT', () => {
    expect(ibkrOrderTypeToLb('TRAIL', 'US')).toBe(12 /* TSMPCT */)
  })

  it('returns null for unknown types', () => {
    expect(ibkrOrderTypeToLb('FOO', 'US')).toBeNull()
  })
})

describe('ibkrTifToLb', () => {
  it('DAY → Day', () => {
    expect(ibkrTifToLb('DAY')).toBe(1 /* Day */)
  })

  it('empty TIF defaults to Day', () => {
    expect(ibkrTifToLb('')).toBe(1)
  })

  it('GTC → GoodTilCanceled', () => {
    expect(ibkrTifToLb('GTC')).toBe(2)
  })

  it('IOC rejected (LB has no IOC)', () => {
    expect(ibkrTifToLb('IOC')).toBeNull()
  })

  it('FOK rejected (LB has no FOK)', () => {
    expect(ibkrTifToLb('FOK')).toBeNull()
  })
})

// ==================== Status mapping ====================

describe('mapLbOrderStatus', () => {
  it('Filled → Filled', () => expect(mapLbOrderStatus(5)).toBe('Filled'))
  it('Rejected → Inactive', () => expect(mapLbOrderStatus(14)).toBe('Inactive'))
  it('Canceled → Cancelled', () => expect(mapLbOrderStatus(15)).toBe('Cancelled'))
  it('PartialFilled → Submitted (still active)', () => expect(mapLbOrderStatus(11)).toBe('Submitted'))
  it('New → Submitted', () => expect(mapLbOrderStatus(7)).toBe('Submitted'))
})

// ==================== init() ====================

describe('LongbridgeBroker — init()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when appKey is empty', async () => {
    const b = new LongbridgeBroker({ appKey: '', appSecret: 's', accessToken: 't', paper: true })
    await expect(b.init()).rejects.toThrow('No API credentials')
  })

  it('throws when appSecret is empty', async () => {
    const b = new LongbridgeBroker({ appKey: 'k', appSecret: '', accessToken: 't', paper: true })
    await expect(b.init()).rejects.toThrow('No API credentials')
  })

  it('throws when accessToken is empty', async () => {
    const b = new LongbridgeBroker({ appKey: 'k', appSecret: 's', accessToken: '', paper: true })
    await expect(b.init()).rejects.toThrow('No API credentials')
  })

  it('resolves on successful accountBalance probe', async () => {
    const b = makeBroker()
    const lb = await import('longbridge')
    ;(lb.TradeContext.new as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({
      accountBalance: vi.fn().mockResolvedValue([]),
    })
    ;(lb.QuoteContext.new as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({})
    await expect(b.init()).resolves.toBeUndefined()
  })

  it('throws AUTH after MAX_AUTH_RETRIES on 401', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout }) as typeof setTimeout)
    const b = makeBroker()
    const lb = await import('longbridge')
    ;(lb.TradeContext.new as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({
      accountBalance: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    })
    ;(lb.QuoteContext.new as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({})
    await expect(b.init()).rejects.toThrow('Authentication failed')
  })
})

// ==================== getAccount() — multi-currency folding ====================

describe('LongbridgeBroker — getAccount()', () => {
  it('without FxService, picks the HKD bucket', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.accountBalance.mockResolvedValue([
      mockBalance('USD', { totalCash: '5000', netAssets: '6000', buyPower: '12000' }),
      mockBalance('HKD', { totalCash: '40000', netAssets: '50000', buyPower: '80000' }),
      mockBalance('CNY', { totalCash: '10000', netAssets: '12000', buyPower: '20000' }),
    ])
    const info = await b.getAccount()
    expect(info.baseCurrency).toBe('HKD')
    expect(info.totalCashValue).toBe('40000')
    expect(info.netLiquidation).toBe('50000')
    expect(info.buyingPower).toBe('80000')
  })

  it('without FxService and no HKD bucket, picks the largest by netAssets', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.accountBalance.mockResolvedValue([
      mockBalance('USD', { totalCash: '5000', netAssets: '6000' }),
      mockBalance('CNY', { totalCash: '10000', netAssets: '70000' }),
    ])
    const info = await b.getAccount()
    expect(info.baseCurrency).toBe('CNY')
    expect(info.netLiquidation).toBe('70000')
  })

  it('returns zeros when broker reports no balances', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.accountBalance.mockResolvedValue([])
    const info = await b.getAccount()
    expect(info).toMatchObject({ baseCurrency: 'HKD', totalCashValue: '0', netLiquidation: '0' })
  })

  it('with FxService, folds USD + CNY into HKD via cross-rate', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    // Stub FxService: 1 USD = 7.8 HKD; 1 CNY = 1 HKD (round numbers for the assertion).
    b.setFxService({
      convertToUsd: async (amount: string, currency: string) => {
        const rates: Record<string, number> = { USD: 1, HKD: 1 / 7.8, CNY: 1 / 7.8 }
        const usd = new Decimal(amount).times(rates[currency] ?? 1).toString()
        return { usd }
      },
    } as unknown as Parameters<typeof b.setFxService>[0])
    trade.accountBalance.mockResolvedValue([
      mockBalance('HKD', { totalCash: '10000', netAssets: '10000', buyPower: '10000' }),
      mockBalance('USD', { totalCash: '1000',  netAssets: '1000',  buyPower: '1000'  }),
    ])
    const info = await b.getAccount()
    expect(info.baseCurrency).toBe('HKD')
    // 10000 HKD + 1000 USD * 7.8 = 17800 HKD
    expect(new Decimal(info.totalCashValue).toFixed(0)).toBe('17800')
    expect(new Decimal(info.netLiquidation).toFixed(0)).toBe('17800')
  })
})

// ==================== getPositions() ====================

describe('LongbridgeBroker — getPositions()', () => {
  it('flattens channels + sets long side for positive qty', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [
        {
          accountChannel: 'HK',
          positions: [
            { symbol: '700.HK', symbolName: '腾讯', quantity: dec('200'), costPrice: dec('300'), currency: 'HKD', market: 2 },
          ],
        },
        {
          accountChannel: 'US',
          positions: [
            { symbol: 'AAPL.US', symbolName: 'Apple', quantity: dec('50'), costPrice: dec('150'), currency: 'USD', market: 1 },
          ],
        },
      ],
    })
    const positions = await b.getPositions()
    expect(positions).toHaveLength(2)
    expect(positions[0].contract.localSymbol).toBe('700.HK')
    expect(positions[0].currency).toBe('HKD')
    expect(positions[0].quantity.toString()).toBe('200')
    expect(positions[0].marketValue).toBe('60000')
    expect(positions[1].currency).toBe('USD')
  })

  it('skips zero-quantity positions', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'HK', positions: [
        { symbol: '700.HK', symbolName: '', quantity: dec('0'), costPrice: dec('300'), currency: 'HKD', market: 2 },
      ] }],
    })
    expect(await b.getPositions()).toHaveLength(0)
  })

  it('marks negative qty as short', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'US', positions: [
        { symbol: 'TSLA.US', symbolName: '', quantity: dec('-100'), costPrice: dec('200'), currency: 'USD', market: 1 },
      ] }],
    })
    const [p] = await b.getPositions()
    expect(p.side).toBe('short')
    expect(p.quantity.toString()).toBe('100')
  })

  it('uses live lastDone from quote() as marketPrice (not costPrice)', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'HK', positions: [
        { symbol: '700.HK', symbolName: 'Tencent', quantity: dec('200'), costPrice: dec('300'), currency: 'HKD', market: 2 },
      ] }],
    })
    quote.quote.mockResolvedValue([{ symbol: '700.HK', lastDone: dec('350') }])
    quote.staticInfo.mockResolvedValue([{ symbol: '700.HK', stockDerivatives: [], lotSize: 100 }])

    const [p] = await b.getPositions()
    expect(p.avgCost).toBe('300')
    expect(p.marketPrice).toBe('350')                  // live, not costPrice
    expect(p.marketPrice).not.toBe(p.avgCost)          // bug 1 regression guard
    expect(p.marketValue).toBe('70000')                // 200 * 350 * 1
    expect(p.unrealizedPnL).toBe('10000')              // (350-300) * 200 * 1
    expect(p.multiplier).toBe('1')
  })

  it('falls back to costPrice when quote() fails for the symbol', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'HK', positions: [
        { symbol: '700.HK', symbolName: '', quantity: dec('100'), costPrice: dec('300'), currency: 'HKD', market: 2 },
      ] }],
    })
    quote.quote.mockRejectedValue(new Error('rate limited'))

    const [p] = await b.getPositions()
    expect(p.marketPrice).toBe('300')                  // fallback to cost
    expect(p.marketValue).toBe('30000')                // 100 * 300 * 1
    expect(p.unrealizedPnL).toBe('0')                  // mark==cost → 0 PnL
  })

  it('applies 100x multiplier to US options (contractMultiplier from optionQuote)', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'US', positions: [
        // 1 contract of an AAPL call, $5.50 cost basis, current $7.00
        { symbol: 'AAPL241220C00200000.US', symbolName: 'AAPL Call', quantity: dec('1'), costPrice: dec('5.5'), currency: 'USD', market: 1 },
      ] }],
    })
    quote.quote.mockResolvedValue([{ symbol: 'AAPL241220C00200000.US', lastDone: dec('7') }])
    quote.staticInfo.mockResolvedValue([
      { symbol: 'AAPL241220C00200000.US', stockDerivatives: [0 /* Option */], lotSize: 100 },
    ])
    quote.optionQuote.mockResolvedValue([
      { symbol: 'AAPL241220C00200000.US', contractMultiplier: dec('100') },
    ])

    const [p] = await b.getPositions()
    expect(p.multiplier).toBe('100')
    expect(p.marketPrice).toBe('7')
    expect(p.marketValue).toBe('700')                  // 1 * 7 * 100 — was 7 before fix
    expect(p.unrealizedPnL).toBe('150')                // (7-5.5) * 1 * 100
  })

  it('applies conversionRatio multiplier to HK warrants', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'HK', positions: [
        { symbol: '21125.HK', symbolName: 'HSI Warrant', quantity: dec('10000'), costPrice: dec('0.20'), currency: 'HKD', market: 2 },
      ] }],
    })
    quote.quote.mockResolvedValue([{ symbol: '21125.HK', lastDone: dec('0.25') }])
    quote.staticInfo.mockResolvedValue([
      { symbol: '21125.HK', stockDerivatives: [1 /* Warrant */], lotSize: 1000 },
    ])
    quote.warrantQuote.mockResolvedValue([
      { symbol: '21125.HK', conversionRatio: dec('0.1') },  // 1 warrant ↔ 0.1 share
    ])

    const [p] = await b.getPositions()
    expect(p.multiplier).toBe('0.1')
    expect(p.marketPrice).toBe('0.25')
    expect(p.marketValue).toBe('250')                  // 10000 * 0.25 * 0.1
    // (0.25 - 0.2) * 10000 * 0.1 = 50
    expect(new Decimal(p.unrealizedPnL).toFixed(0)).toBe('50')
  })

  it('mixes plain stock + option in one batch correctly', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'US', positions: [
        { symbol: 'TSLA.US', symbolName: 'Tesla', quantity: dec('10'), costPrice: dec('200'), currency: 'USD', market: 1 },
        { symbol: 'TSLA241220C00250000.US', symbolName: 'TSLA Call', quantity: dec('2'), costPrice: dec('3'), currency: 'USD', market: 1 },
      ] }],
    })
    quote.quote.mockResolvedValue([
      { symbol: 'TSLA.US', lastDone: dec('210') },
      { symbol: 'TSLA241220C00250000.US', lastDone: dec('4') },
    ])
    quote.staticInfo.mockResolvedValue([
      { symbol: 'TSLA.US', stockDerivatives: [], lotSize: 1 },
      { symbol: 'TSLA241220C00250000.US', stockDerivatives: [0], lotSize: 100 },
    ])
    quote.optionQuote.mockResolvedValue([
      { symbol: 'TSLA241220C00250000.US', contractMultiplier: dec('100') },
    ])

    const positions = await b.getPositions()
    const stock = positions.find(p => p.contract.localSymbol === 'TSLA.US')!
    const opt = positions.find(p => p.contract.localSymbol === 'TSLA241220C00250000.US')!
    expect(stock.multiplier).toBe('1')
    expect(stock.marketValue).toBe('2100')             // 10 * 210 * 1
    expect(opt.multiplier).toBe('100')
    expect(opt.marketValue).toBe('800')                // 2 * 4 * 100
  })

  it('staticInfo failure → all positions degrade to multiplier=1 (does not throw)', async () => {
    const b = makeBroker()
    const { trade, quote } = attachMockContexts(b)
    trade.stockPositions.mockResolvedValue({
      channels: [{ accountChannel: 'US', positions: [
        { symbol: 'AAPL241220C00200000.US', symbolName: '', quantity: dec('1'), costPrice: dec('5.5'), currency: 'USD', market: 1 },
      ] }],
    })
    quote.quote.mockResolvedValue([{ symbol: 'AAPL241220C00200000.US', lastDone: dec('7') }])
    quote.staticInfo.mockRejectedValue(new Error('boom'))

    const [p] = await b.getPositions()
    expect(p.multiplier).toBe('1')                     // graceful degrade
    expect(p.marketPrice).toBe('7')                    // live quote still works
    expect(p.marketValue).toBe('7')                    // 1 * 7 * 1 (under-counts but doesn't throw)
  })

  it('still throws BrokerError when stockPositions itself fails', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.stockPositions.mockRejectedValue(new Error('500 Internal Server Error'))
    await expect(b.getPositions()).rejects.toThrow(/Internal Server Error/)
  })
})

// ==================== placeOrder() ====================

describe('LongbridgeBroker — placeOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('converts decimal.js submit values to SDK Decimal instances', async () => {
    const broker = makeBroker()
    const { trade } = attachMockContexts(broker)
    trade.submitOrder.mockResolvedValue({ orderId: 'decimal-submit' })
    const contract = makeContract('AAPL.US')
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'TRAIL LIMIT'
    order.totalQuantity = new Decimal('1.25')
    order.lmtPrice = new Decimal('201.125')
    order.auxPrice = new Decimal('199.875')
    order.trailingPercent = new Decimal('1.5')
    order.tif = 'DAY'

    await broker.placeOrder(contract, order)

    const sent = trade.submitOrder.mock.calls[0][0]
    expectLongbridgeDecimal(sent.submittedQuantity, '1.25')
    expectLongbridgeDecimal(sent.submittedPrice, '201.125')
    expectLongbridgeDecimal(sent.triggerPrice, '199.875')
    expectLongbridgeDecimal(sent.trailingPercent, '1.5')
  })

  it('translates HK MKT → ELO (HK quirk)', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.submitOrder.mockResolvedValue({ orderId: 'ord-hk' })
    const c = makeContract('700.HK')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'MKT'
    o.totalQuantity = new Decimal(200)
    o.tif = 'DAY'

    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-hk')
    const sent = trade.submitOrder.mock.calls[0][0]
    expect(sent.orderType).toBe(2 /* ELO */)
    expect(sent.symbol).toBe('700.HK')
    expect(sent.side).toBe(1 /* Buy */)
  })

  it('translates US MKT → MO', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.submitOrder.mockResolvedValue({ orderId: 'ord-us' })
    const c = makeContract('AAPL.US')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'MKT'
    o.totalQuantity = new Decimal(10)
    o.tif = 'DAY'

    await b.placeOrder(c, o)
    expect(trade.submitOrder.mock.calls[0][0].orderType).toBe(3 /* MO */)
  })

  it('returns error when contract is unresolvable', async () => {
    const b = makeBroker()
    attachMockContexts(b)
    const c = new Contract()
    c.symbol = ''
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'MKT'
    o.totalQuantity = new Decimal(1)
    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Cannot resolve/)
  })

  it('rejects unsupported order types', async () => {
    const b = makeBroker()
    attachMockContexts(b)
    const c = makeContract('AAPL.US')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'WTF'
    o.totalQuantity = new Decimal(1)
    o.tif = 'DAY'
    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not supported/)
  })

  it('rejects IOC TIF (LB has no IOC)', async () => {
    const b = makeBroker()
    attachMockContexts(b)
    const c = makeContract('AAPL.US')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'LMT'
    o.totalQuantity = new Decimal(1)
    o.lmtPrice = new Decimal(100)
    o.tif = 'IOC'
    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Time-in-force/)
  })

  it('rejects zero quantity', async () => {
    const b = makeBroker()
    attachMockContexts(b)
    const c = makeContract('AAPL.US')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'LMT'
    o.totalQuantity = new Decimal(0)
    o.tif = 'DAY'
    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/quantity/i)
  })

  it('passes lmtPrice through for LMT orders', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.submitOrder.mockResolvedValue({ orderId: 'lmt-1' })
    const c = makeContract('700.HK')
    const o = new Order()
    o.action = 'SELL'
    o.orderType = 'LMT'
    o.totalQuantity = new Decimal(100)
    o.lmtPrice = new Decimal('305.5')
    o.tif = 'DAY'

    await b.placeOrder(c, o)
    const sent = trade.submitOrder.mock.calls[0][0]
    expect(sent.orderType).toBe(1 /* LO */)
    expect(sent.side).toBe(2 /* Sell */)
    expect(sent.submittedPrice.toString()).toBe('305.5')
  })

  it('surfaces SDK errors as failures', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.submitOrder.mockRejectedValue(new Error('insufficient buying power'))
    const c = makeContract('AAPL.US')
    const o = new Order()
    o.action = 'BUY'
    o.orderType = 'LMT'
    o.totalQuantity = new Decimal(1)
    o.lmtPrice = new Decimal(100)
    o.tif = 'DAY'
    const result = await b.placeOrder(c, o)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/insufficient/)
  })
})

// ==================== cancelOrder / modifyOrder ====================

describe('LongbridgeBroker — cancelOrder()', () => {
  it('returns success on SDK ack', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.cancelOrder.mockResolvedValue(undefined)
    const result = await b.cancelOrder('ord-1')
    expect(result.success).toBe(true)
    expect(trade.cancelOrder).toHaveBeenCalledWith('ord-1')
  })

  it('returns failure on SDK error', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.cancelOrder.mockRejectedValue(new Error('order not found'))
    const result = await b.cancelOrder('ord-2')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})

describe('LongbridgeBroker — modifyOrder()', () => {
  it('requires totalQuantity', async () => {
    const b = makeBroker()
    attachMockContexts(b)
    const result = await b.modifyOrder('ord-1', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/totalQuantity/)
  })

  it('passes new quantity to replaceOrder', async () => {
    const b = makeBroker()
    const { trade } = attachMockContexts(b)
    trade.replaceOrder.mockResolvedValue(undefined)
    const result = await b.modifyOrder('ord-1', { totalQuantity: new Decimal(150) })
    expect(result.success).toBe(true)
    const sent = trade.replaceOrder.mock.calls[0][0]
    expect(sent.orderId).toBe('ord-1')
    expect(sent.quantity.toString()).toBe('150')
  })

  it('converts decimal.js replacement values to SDK Decimal instances', async () => {
    const broker = makeBroker()
    const { trade } = attachMockContexts(broker)
    trade.replaceOrder.mockResolvedValue(undefined)

    await broker.modifyOrder('ord-1', {
      totalQuantity: new Decimal('2.5'),
      lmtPrice: new Decimal('202.25'),
      auxPrice: new Decimal('198.75'),
    })

    const sent = trade.replaceOrder.mock.calls[0][0]
    expectLongbridgeDecimal(sent.quantity, '2.5')
    expectLongbridgeDecimal(sent.price, '202.25')
    expectLongbridgeDecimal(sent.triggerPrice, '198.75')
  })
})

// ==================== getQuote() ====================

describe('LongbridgeBroker — getQuote()', () => {
  it('combines quote() + depth() for last + bid/ask', async () => {
    const b = makeBroker()
    const { quote } = attachMockContexts(b)
    quote.quote.mockResolvedValue([{
      symbol: '700.HK',
      lastDone: dec('305.5'),
      open: dec('300'),
      high: dec('310'),
      low: dec('299'),
      volume: 1234567,
      timestamp: new Date('2026-05-01T03:00:00Z'),
    }])
    quote.depth.mockResolvedValue({
      asks: [{ price: dec('305.6'), volume: 100 }],
      bids: [{ price: dec('305.4'), volume: 200 }],
    })

    const c = makeContract('700.HK')
    const q = await b.getQuote(c)
    expect(q.last).toBe('305.5')
    expect(q.bid).toBe('305.4')
    expect(q.ask).toBe('305.6')
    expect(q.volume).toBe('1234567')
  })

  it('falls back to 0 bid/ask if depth fails', async () => {
    const b = makeBroker()
    const { quote } = attachMockContexts(b)
    quote.quote.mockResolvedValue([{
      symbol: 'AAPL.US',
      lastDone: dec('150'),
      open: dec('149'),
      high: dec('151'),
      low: dec('148'),
      volume: 100,
      timestamp: new Date(),
    }])
    quote.depth.mockRejectedValue(new Error('depth not available'))

    const c = makeContract('AAPL.US')
    const q = await b.getQuote(c)
    expect(q.last).toBe('150')
    expect(q.bid).toBe('0')
    expect(q.ask).toBe('0')
  })
})

// ==================== getMarketClock() ====================

describe('LongbridgeBroker — getMarketClock()', () => {
  it('returns isOpen=true if any market session covers now', async () => {
    const b = makeBroker()
    const { quote } = attachMockContexts(b)
    const now = new Date()
    const start = { hour: 0, minute: 0, second: 0 }
    const end = { hour: 23, minute: 59, second: 59 }
    quote.tradingSession.mockResolvedValue([
      { market: 2 /* HK */, tradeSessions: [{ beginTime: start, endTime: end, tradeSession: 0 }] },
    ])
    const clock = await b.getMarketClock()
    expect(clock.isOpen).toBe(true)
    expect(clock.timestamp).toBeInstanceOf(Date)
    void now
  })

  it('returns isOpen=false if no session covers now', async () => {
    const b = makeBroker()
    const { quote } = attachMockContexts(b)
    quote.tradingSession.mockResolvedValue([
      { market: 2, tradeSessions: [{
        beginTime: { hour: 23, minute: 50, second: 0 },
        endTime: { hour: 23, minute: 59, second: 0 },
        tradeSession: 0,
      }] },
    ])
    // Spoof the wall clock to a time outside the window.
    const originalGetHours = Date.prototype.getHours
    const originalGetMinutes = Date.prototype.getMinutes
    Date.prototype.getHours = function () { return 12 }
    Date.prototype.getMinutes = function () { return 0 }
    try {
      const clock = await b.getMarketClock()
      expect(clock.isOpen).toBe(false)
    } finally {
      Date.prototype.getHours = originalGetHours
      Date.prototype.getMinutes = originalGetMinutes
    }
  })
})

// ==================== Capabilities + identity ====================

describe('LongbridgeBroker — capabilities + identity', () => {
  it('reports STK + standard order types', () => {
    const b = makeBroker()
    const cap = b.getCapabilities()
    expect(cap.supportedSecTypes).toContain('STK')
    expect(cap.supportedOrderTypes).toContain('MKT')
    expect(cap.supportedOrderTypes).toContain('LMT')
  })

  it('getNativeKey returns LB-suffixed symbol', () => {
    const b = makeBroker()
    const c = makeContract('700.HK')
    expect(b.getNativeKey(c)).toBe('700.HK')
  })

  it('resolveNativeKey round-trips', () => {
    const b = makeBroker()
    const c = b.resolveNativeKey('AAPL.US')
    expect(c.symbol).toBe('AAPL')
    expect(c.exchange).toBe('SMART')
  })
})

// ==================== Helpers ====================

function dec(s: string): { toString(): string } {
  return { toString: () => s }
}

function mockBalance(currency: string, fields: Partial<{
  totalCash: string; netAssets: string; buyPower: string; initMargin: string; maintenanceMargin: string
}>): unknown {
  return {
    currency,
    totalCash: dec(fields.totalCash ?? '0'),
    netAssets: dec(fields.netAssets ?? '0'),
    buyPower: dec(fields.buyPower ?? '0'),
    initMargin: dec(fields.initMargin ?? '0'),
    maintenanceMargin: dec(fields.maintenanceMargin ?? '0'),
  }
}
