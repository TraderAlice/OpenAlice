import { afterEach, describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import { AlpacaBroker } from './AlpacaBroker.js'
import { makeContract } from './alpaca-contracts.js'
import { AlpacaData } from './alpaca-data.js'

const config = { apiKey: 'fixture', secretKey: 'fixture', paper: true }
afterEach(() => vi.unstubAllGlobals())
function respond(...bodies: unknown[]) {
  const fetcher = vi.fn()
  bodies.forEach(body => fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body))))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('Alpaca multi-asset identities and writes', () => {
  it('preserves crypto identity from catalog, compact position symbols and restart keys', async () => {
    const broker = new AlpacaBroker(config)
    const raw = { symbol: 'BTCUSD', asset_class: 'crypto', qty: '0.001', side: 'long', avg_entry_price: '50000', current_price: '60000', market_value: '60', unrealized_pl: '10' }
    Object.assign(broker, { client: { getAssets: async () => [{ symbol: 'BTC/USD', class: 'crypto', tradable: true }], getPositions: async () => [raw] } })
    await broker.refreshCatalog()
    const [found] = await broker.searchContracts('BTC')
    expect(found.contract.secType).toBe('CRYPTO')
    expect(broker.resolveNativeKey('BTC/USD').secType).toBe('CRYPTO')
    expect(broker.resolveNativeKey('BTCUSD').symbol).toBe('BTC/USD')
    expect((await broker.getPositions())[0]).toMatchObject({ contract: { secType: 'CRYPTO', symbol: 'BTC/USD' }, marketValue: '60', unrealizedPnL: '10' })
  })
  it('does not turn cash-notional into quantity when reading an order', async () => {
    const broker = new AlpacaBroker(config)
    Object.assign(broker, { client: { getOrder: async () => ({ id: 'uuid', symbol: 'BTCUSD', asset_class: 'crypto', side: 'buy', qty: null, notional: '100', type: 'market', status: 'new' }) } })
    const result = await broker.getOrder('uuid')
    expect(result?.contract.secType).toBe('CRYPTO')
    expect(result?.order.totalQuantity.equals(UNSET_DECIMAL)).toBe(true)
    expect(result?.order.cashQty.toString()).toBe('100')
    expect(result?.order.orderType).toBe('MKT')
  })
  it('rejects crypto stock-only order flags before sending and preserves fractional quantities', async () => {
    const broker = new AlpacaBroker(config)
    const createOrder = vi.fn().mockResolvedValue({ id: 'crypto-order', status: 'new' })
    Object.assign(broker, { client: { createOrder } })
    const order = Object.assign(new Order(), { action: 'BUY', orderType: 'MKT', tif: 'DAY', totalQuantity: new Decimal('0.00012345') })
    const contract = makeContract('BTC/USD')
    expect((await broker.placeOrder(contract, order)).error).toMatch(/GTC or IOC/)
    order.tif = 'GTC'
    expect((await broker.placeOrder(contract, order, { takeProfit: { price: '100000' } })).success).toBe(false)
    expect(createOrder).not.toHaveBeenCalled()
    expect((await broker.placeOrder(contract, order)).success).toBe(true)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC/USD', qty: '0.00012345', time_in_force: 'gtc' }))
  })
  it('keeps option local identity and multiplier', async () => {
    const broker = new AlpacaBroker(config)
    const contract = broker.resolveNativeKey('SPY260918C00600000')
    expect(contract).toMatchObject({ symbol: 'SPY', localSymbol: 'SPY260918C00600000', secType: 'OPT', strike: 600, multiplier: '100', right: 'C', lastTradeDateOrContractMonth: '20260918' })
    expect(broker.getNativeKey(contract)).toBe('SPY260918C00600000')
  })
})

describe('Alpaca read-only data endpoints', () => {
  it('uses crypto snapshots rather than stock snapshots', async () => {
    const fetcher = respond({ snapshots: { 'BTC/USD': { latestTrade: { p: 60000, t: '2026-09-10T00:00:00Z' }, latestQuote: { bp: 59999, ap: 60001, t: '2026-09-10T00:00:01Z' } } } })
    const quote = await new AlpacaBroker(config).getQuote(makeContract('BTC/USD'))
    expect(String(fetcher.mock.calls[0][0])).toContain('/v1beta3/crypto/us/snapshots?symbols=BTC%2FUSD')
    expect(quote).toMatchObject({ last: '60000', bid: '59999', ask: '60001', contract: { secType: 'CRYPTO' } })
  })
  it('paginates descending crypto bars and returns the latest N chronologically', async () => {
    const bar = (day: number) => ({ t: `2026-09-0${day}T00:00:00Z`, o: day, h: day, l: day, c: day, v: 2 })
    const fetcher = respond({ bars: { 'BTC/USD': [bar(3), bar(2)] }, next_page_token: 'next' }, { bars: { 'BTC/USD': [bar(1)] } })
    const bars = await new AlpacaBroker(config).getHistorical(makeContract('BTC/USD'), { interval: '1d', limit: 3 })
    expect(bars.map(b => b.close)).toEqual(['1', '2', '3'])
    expect(String(fetcher.mock.calls[1][0])).toContain('page_token=next')
    expect(String(fetcher.mock.calls[0][0])).not.toContain('adjustment')
  })
  it('retains snapshot provenance, explicit feed and continuation token', async () => {
    const fetcher = respond({ snapshots: { SPY260918C00600000: { impliedVolatility: 0.2, greeks: { delta: 0.5 }, latestQuote: { t: '2026-09-10T00:00:00Z', bp: 2, ap: 3 } } }, next_page_token: 'page2' })
    const result = await new AlpacaData(config).optionSnapshots('SPY', { expiration: '2026-09-18', limit: 1 })
    expect(result.nextPageToken).toBe('page2')
    expect(result.metadata).toMatchObject({ feed: 'indicative', indicative: true, possiblyDelayed: true })
    expect(result.snapshots.SPY260918C00600000.greeks?.delta).toBe(0.5)
    expect(String(fetcher.mock.calls[0][0])).toContain('expiration_date=2026-09-18')
  })
  it('does not silently cap contracts at the next weekend or omit OI dates', async () => {
    const fetcher = respond({ option_contracts: [{ symbol: 'SPY260918C00600000', open_interest: '500', open_interest_date: '2026-09-09' }] })
    const result = await new AlpacaData(config).optionContracts('SPY')
    expect(String(fetcher.mock.calls[0][0])).toContain('paper-api.alpaca.markets')
    expect(String(fetcher.mock.calls[0][0])).toContain('expiration_date_lte=2099-12-31')
    expect(result.contracts[0].open_interest_date).toBe('2026-09-09')
  })
  it('propagates entitlement failures without silently switching feeds', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"message":"subscription required"}', { status: 403 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(new AlpacaData(config).optionSnapshots('SPY', { feed: 'opra' })).rejects.toThrow(/403.*subscription required/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('Alpaca close and amendment boundaries', () => {
  it('uses the positions endpoint compact symbol instead of a slash path', async () => {
    const broker = new AlpacaBroker(config)
    const closePosition = vi.fn().mockResolvedValue({ id: 'close', status: 'new' })
    Object.assign(broker, { client: { closePosition } })
    await broker.closePosition(makeContract('BTC/USD'))
    expect(closePosition).toHaveBeenCalledWith('BTCUSD')
  })
  it('blocks option amendments and invalid crypto TIF before replacement', async () => {
    const broker = new AlpacaBroker(config)
    const replaceOrder = vi.fn()
    const getOrder = vi.fn().mockResolvedValueOnce({ symbol: 'SPY260918C00600000', asset_class: 'us_option' }).mockResolvedValueOnce({ symbol: 'BTCUSD', asset_class: 'crypto' })
    Object.assign(broker, { client: { getOrder, replaceOrder, getAccount: async () => ({ options_trading_level: 0 }) } })
    expect((await broker.modifyOrder('option', { tif: 'DAY' })).error).toMatch(/disabled/)
    expect((await broker.modifyOrder('crypto', { tif: 'DAY' })).error).toMatch(/GTC or IOC/)
    expect(replaceOrder).not.toHaveBeenCalled()
  })
})


describe('Alpaca single-leg options execution', () => {
  const symbol = 'SPY260918C00600000'
  const order = () => Object.assign(new Order(), { action: 'BUY', orderType: 'LMT', tif: 'DAY', totalQuantity: new Decimal(1), lmtPrice: new Decimal('1.25') })
  function setup(level = 2) {
    const broker = new AlpacaBroker(config)
    const client = {
      getAccount: vi.fn().mockResolvedValue({ options_trading_level: level }),
      createOrder: vi.fn().mockResolvedValue({ id: 'entry', status: 'new' }),
      getOrder: vi.fn().mockResolvedValue({ symbol, asset_class: 'us_option', type: 'limit' }),
      replaceOrder: vi.fn().mockResolvedValue({ id: 'replacement', status: 'new' }),
      closePosition: vi.fn().mockResolvedValue({ id: 'exit', status: 'new' }),
    }
    Object.assign(broker, { client })
    return { broker, client, contract: broker.resolveNativeKey(symbol) }
  }
  it('sends OCC identity, contract quantity and per-unit price and advertises approved options', async () => {
    const { broker, client, contract } = setup()
    expect(broker.getCapabilities().supportedSecTypes).not.toContain('OPT')
    expect((await broker.placeOrder(contract, order())).success).toBe(true)
    expect(client.createOrder).toHaveBeenCalledWith({ symbol, side: 'buy', type: 'limit', time_in_force: 'day', qty: '1', limit_price: '1.25' })
    expect(broker.getCapabilities().supportedSecTypes).toContain('OPT')
    expect((await broker.getContractDetails(contract))?.orderTypes).toBe('MKT,LMT,STP,STP LMT')
  })
  it('refreshes permissions and preserves venue rejection reasons', async () => {
    const { broker, client, contract } = setup(0)
    expect((await broker.placeOrder(contract, order())).error).toMatch(/options_trading_level=0/)
    expect(client.createOrder).not.toHaveBeenCalled()
    client.getAccount.mockResolvedValue({ options_trading_level: 1 })
    client.createOrder.mockRejectedValue({ response: { data: { message: 'insufficient options approval level' } } })
    expect((await broker.placeOrder(contract, order())).error).toContain('insufficient options approval level')
  })
  it.each([
    { totalQuantity: new Decimal('0.5') }, { totalQuantity: new Decimal(0) },
    { totalQuantity: new Decimal(-1) }, { cashQty: new Decimal(100) },
    { tif: 'IOC' }, { outsideRth: true }, { orderType: 'TRAIL' },
    { trailingPercent: new Decimal(1) }, { parentId: 1 }, { ocaGroup: 'group' },
    { trailStopPrice: new Decimal(1) }, { goodTillDate: '20260918' },
  ])('rejects unsupported option fields before dispatch: %j', async changes => {
    const { broker, client, contract } = setup()
    expect((await broker.placeOrder(contract, Object.assign(order(), changes))).success).toBe(false)
    expect(client.createOrder).not.toHaveBeenCalled()
  })
  it('fails closed when the account lookup fails or reports a block', async () => {
    const { broker, client, contract } = setup()
    client.getAccount.mockRejectedValueOnce(new Error('account unavailable'))
    expect((await broker.placeOrder(contract, order())).error).toContain('account unavailable')
    client.getAccount.mockResolvedValueOnce({ options_trading_level: 2, trading_blocked: true } as never)
    expect((await broker.placeOrder(contract, order())).error).toContain('blocked')
    expect(client.createOrder).not.toHaveBeenCalled()
  })
  it.each(['C', 'P'])('keeps long/short %s positions in contract units', async right => {
    const { broker } = setup()
    const localSymbol = `SPY260918${right}00600000`
    const raw = (side: string, qty: string) => ({ symbol: localSymbol, asset_class: 'us_option', side, qty, avg_entry_price: '2', current_price: '3', market_value: side === 'long' ? '600' : '-600', unrealized_pl: side === 'long' ? '200' : '-200' })
    Object.assign(broker, { client: { getPositions: async () => [raw('long', '2'), raw('short', '-2')] } })
    const positions = await broker.getPositions()
    expect(positions.map(p => ({ side: p.side, qty: p.quantity.toString(), value: p.marketValue, pnl: p.unrealizedPnL }))).toEqual([
      { side: 'long', qty: '2', value: '600', pnl: '200' },
      { side: 'short', qty: '2', value: '600', pnl: '-200' },
    ])
    for (const p of positions) expect(p.contract).toMatchObject({ secType: 'OPT', localSymbol, multiplier: '100', right })
  })
  it('rejects bracket attachment and applies whole-contract checks to replacements', async () => {
    const { broker, client, contract } = setup()
    expect((await broker.placeOrder(contract, order(), { takeProfit: { price: '2' } })).success).toBe(false)
    expect((await broker.modifyOrder('entry', { totalQuantity: new Decimal('0.5') })).success).toBe(false)
    expect((await broker.modifyOrder('entry', { orderType: 'MKT' })).success).toBe(false)
    expect(client.replaceOrder).not.toHaveBeenCalled()
    expect((await broker.modifyOrder('entry', { totalQuantity: new Decimal(2), lmtPrice: new Decimal('1.15'), tif: 'GTC' })).orderId).toBe('replacement')
    expect(client.replaceOrder).toHaveBeenCalledWith('entry', { qty: '2', limit_price: '1.15', time_in_force: 'gtc' })
  })
  it('closes the precise option rather than matching the underlying; never over-closes', async () => {
    const { broker, client, contract } = setup()
    vi.spyOn(broker, 'getPositions').mockResolvedValue([{ contract, side: 'long', quantity: '2' } as never])
    expect((await broker.closePosition(contract, new Decimal(3))).success).toBe(false)
    expect((await broker.closePosition(contract, new Decimal(1))).success).toBe(true)
    expect(client.createOrder).toHaveBeenCalledWith({ symbol, side: 'sell', type: 'market', time_in_force: 'day', qty: '1' })
    expect((await broker.closePosition(contract)).orderId).toBe('exit')
    expect(client.closePosition).toHaveBeenCalledWith(symbol)
  })
})
