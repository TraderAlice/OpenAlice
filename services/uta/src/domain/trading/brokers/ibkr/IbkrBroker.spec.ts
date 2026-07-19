import { describe, it, expect, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { IbkrBroker } from './IbkrBroker.js'
import contractCorpus from './__fixtures__/contract-resolution.v1.json'

/**
 * The gate must fire BEFORE any bridge/client access, so it is testable on
 * a bare prototype instance — no TWS connection, no bridge construction.
 */
function bareBroker(): IbkrBroker {
  return Object.create(IbkrBroker.prototype) as IbkrBroker
}

function stkOrder(): { contract: Contract; order: Order } {
  const contract = new Contract()
  contract.symbol = 'AAPL'
  contract.secType = 'STK'
  contract.exchange = 'SMART'
  contract.currency = 'USD'
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'LMT'
  order.totalQuantity = new Decimal(1)
  order.lmtPrice = new Decimal(100)
  return { contract, order }
}

function recordedContract(name: string): Contract {
  const recorded = contractCorpus.cases.find(item => item.name === name)?.canonical
  if (!recorded) throw new Error(`missing recorded IBKR contract fixture: ${name}`)
  const contract = new Contract()
  Object.assign(contract, recorded)
  contract.secType = recorded.secType as Contract['secType']
  return contract
}

function usdChfContract(): Contract {
  return recordedContract('usd-chf-cash')
}

function brokerWithContractIo(resolvedContract = usdChfContract()): {
  broker: IbkrBroker
  bridge: {
    requestCollector: ReturnType<typeof vi.fn>
    requestSnapshot: ReturnType<typeof vi.fn>
    requestCurrentTime: ReturnType<typeof vi.fn>
    requestOrder: ReturnType<typeof vi.fn>
    markDead: ReturnType<typeof vi.fn>
  }
  client: {
    reqContractDetails: ReturnType<typeof vi.fn>
    reqMktData: ReturnType<typeof vi.fn>
    placeOrder: ReturnType<typeof vi.fn>
    cancelOrder: ReturnType<typeof vi.fn>
  }
} {
  const broker = new IbkrBroker({ id: 'ibkr-test', host: '127.0.0.1', port: 7497, clientId: 91 })
  const bridge = {
    connectionDead: false,
    allocReqId: vi.fn(() => 17),
    requestCollector: vi.fn(async () => [{ contract: Object.assign(new Contract(), resolvedContract) }]),
    requestSnapshot: vi.fn(async () => ({ last: 0.8, bid: 0.79, ask: 0.81, volume: 1 })),
    requestCurrentTime: vi.fn(async () => 1_784_289_600),
    getNextOrderId: vi.fn(() => 42),
    requestOrder: vi.fn(async () => ({ orderState: { status: 'Submitted' } })),
    markDead: vi.fn(),
  }
  const client = {
    reqContractDetails: vi.fn(),
    reqMktData: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
  }
  ;(broker as unknown as { bridge: unknown }).bridge = bridge
  ;(broker as unknown as { client: unknown }).client = client
  return { broker, bridge, client }
}

function limitBuy(): Order {
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'LMT'
  order.totalQuantity = new Decimal(1)
  order.lmtPrice = new Decimal('0.1')
  return order
}

describe('IbkrBroker — canonical conId contract resolution', () => {
  it.each(contractCorpus.cases)('replays the recorded $name canonical contract', async ({ canonical }) => {
    const resolved = new Contract()
    Object.assign(resolved, canonical)
    resolved.secType = canonical.secType as Contract['secType']
    const { broker, client } = brokerWithContractIo(resolved)
    const identity = Object.assign(new Contract(), {
      conId: canonical.conId,
      symbol: 'DISPLAY-ONLY',
      secType: 'STK' as const,
      exchange: 'SMART',
      currency: 'USD',
    })

    const result = await broker.placeOrder(identity, limitBuy())

    expect(result.success).toBe(true)
    const sent = client.placeOrder.mock.calls[0][1] as Contract
    expect({
      conId: sent.conId,
      symbol: sent.symbol,
      localSymbol: sent.localSymbol,
      secType: sent.secType,
      exchange: sent.exchange,
      primaryExchange: sent.primaryExchange,
      currency: sent.currency,
      tradingClass: sent.tradingClass,
      multiplier: sent.multiplier,
    }).toEqual(canonical)
  })

  it('resolves a polluted conId through a clean lookup before placing an order', async () => {
    const { broker, client } = brokerWithContractIo()
    const input = new Contract()
    input.conId = 12087820
    input.symbol = 'USDCHF' // display-only value carried by UTA staging
    input.secType = 'STK'
    input.exchange = 'SMART'
    input.currency = 'USD'

    const result = await broker.placeOrder(input, limitBuy())

    expect(result.success).toBe(true)
    expect(client.reqContractDetails).toHaveBeenCalledOnce()
    const lookup = client.reqContractDetails.mock.calls[0][1] as Contract
    expect({
      conId: lookup.conId,
      symbol: lookup.symbol,
      secType: lookup.secType,
      exchange: lookup.exchange,
      currency: lookup.currency,
    }).toEqual({ conId: 12087820, symbol: '', secType: '', exchange: '', currency: '' })

    const sent = client.placeOrder.mock.calls[0][1] as Contract
    expect({
      conId: sent.conId,
      symbol: sent.symbol,
      localSymbol: sent.localSymbol,
      secType: sent.secType,
      exchange: sent.exchange,
      currency: sent.currency,
    }).toEqual({
      conId: 12087820,
      symbol: 'USD',
      localSymbol: 'USD.CHF',
      secType: 'CASH',
      exchange: 'IDEALPRO',
      currency: 'CHF',
    })
  })

  it('does not mutate a symbol-form stock while applying its convenience defaults', async () => {
    const { broker, client } = brokerWithContractIo()
    const input = new Contract()
    input.symbol = 'AAPL'
    input.secType = 'STK'

    await broker.placeOrder(input, limitBuy())

    expect(input.exchange).toBe('')
    expect(input.currency).toBe('')
    const sent = client.placeOrder.mock.calls[0][1] as Contract
    expect(sent.symbol).toBe('AAPL')
    expect(sent.secType).toBe('STK')
    expect(sent.exchange).toBe('SMART')
    expect(sent.currency).toBe('USD')
    expect(client.reqContractDetails).not.toHaveBeenCalled()
  })

  it('refuses to guess routing fields for a non-stock contract without conId', async () => {
    const { broker, client } = brokerWithContractIo()
    const input = new Contract()
    input.symbol = 'USD'
    input.secType = 'CASH'
    input.currency = 'CHF'

    const result = await broker.placeOrder(input, limitBuy())

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/missing exchange.*search\/expand/i)
    expect(client.placeOrder).not.toHaveBeenCalled()
    expect(client.reqContractDetails).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent conId lookups and returns independent contracts', async () => {
    const { broker, client } = brokerWithContractIo()
    const left = Object.assign(new Contract(), { conId: 12087820 })
    const right = Object.assign(new Contract(), { conId: 12087820 })

    const [a, b] = await Promise.all([broker.getQuote(left), broker.getQuote(right)])

    expect(client.reqContractDetails).toHaveBeenCalledOnce()
    expect(a.contract).not.toBe(b.contract)
    a.contract.exchange = 'MUTATED'
    expect(b.contract.exchange).toBe('IDEALPRO')
  })

  it('drops a failed cached lookup so the conId can be retried', async () => {
    const { broker, bridge, client } = brokerWithContractIo()
    bridge.requestCollector
      .mockRejectedValueOnce(new Error('temporary contract lookup failure'))
      .mockResolvedValueOnce([{ contract: usdChfContract() }])
    const input = Object.assign(new Contract(), { conId: 12087820 })

    await expect(broker.getQuote(input)).rejects.toThrow(/temporary contract lookup failure/)
    await expect(broker.getQuote(input)).resolves.toMatchObject({ contract: { exchange: 'IDEALPRO' } })
    expect(client.reqContractDetails).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes a conId contract before an order modification', async () => {
    const { broker, client } = brokerWithContractIo()
    const polluted = Object.assign(new Contract(), {
      conId: 12087820,
      symbol: 'USDCHF',
      secType: 'STK',
      exchange: 'SMART',
      currency: 'USD',
    })
    ;(broker as unknown as { getOrder: unknown }).getOrder = vi.fn(async () => ({
      contract: polluted,
      order: limitBuy(),
      orderState: { status: 'Submitted' },
    }))

    const result = await broker.modifyOrder('42', { lmtPrice: new Decimal('0.2') })

    expect(result.success).toBe(true)
    const sent = client.placeOrder.mock.calls[0][1] as Contract
    expect(sent.secType).toBe('CASH')
    expect(sent.exchange).toBe('IDEALPRO')
    expect(sent.currency).toBe('CHF')
  })

  it('closes an FX position without overwriting its venue contract', async () => {
    const broker = bareBroker()
    const positionContract = usdChfContract()
    ;(broker as unknown as { getPositions: unknown }).getPositions = vi.fn(async () => [{
      contract: positionContract,
      side: 'long',
      quantity: new Decimal('1'),
    }])
    const placeOrder = vi.fn(async (_contract: Contract, _order: Order) => ({ success: true, orderId: '42' }))
    ;(broker as unknown as { placeOrder: unknown }).placeOrder = placeOrder

    const result = await broker.closePosition(Object.assign(new Contract(), { conId: 12087820 }))

    expect(result.success).toBe(true)
    const sent = placeOrder.mock.calls[0][0] as Contract
    expect(sent.exchange).toBe('IDEALPRO')
    expect(positionContract.exchange).toBe('IDEALPRO')
  })
})

describe('IbkrBroker — attached TP/SL refusal gate', () => {
  // Guards the silent naked-entry failure: the tpsl param used to be
  // `_tpsl` (ignored) — the ledger recorded protection TWS never received.
  it('refuses placeOrder with takeProfit', async () => {
    const { contract, order } = stkOrder()
    const result = await bareBroker().placeOrder(contract, order, { takeProfit: { price: '120' } })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/TP\/SL.*not implemented|refusing/i)
  })

  it('refuses placeOrder with stopLoss', async () => {
    const { contract, order } = stkOrder()
    const result = await bareBroker().placeOrder(contract, order, { stopLoss: { price: '90' } })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/refusing/i)
  })

  it('an empty tpsl object does not trip the gate', async () => {
    const { contract, order } = stkOrder()
    // No bridge on the bare instance — passing the gate means it throws on
    // bridge access, NOT a refusal result.
    await expect(async () => {
      const r = await bareBroker().placeOrder(contract, order, {})
      if (r.success === false && /refusing/i.test(r.error ?? '')) throw new Error('gate tripped')
      return r
    }).not.toThrow(/gate tripped/)
  })
})

describe('IbkrBroker — nativeKey grammar (hub/leaf identity)', () => {
  // conId = canonical leaf; issuer: = bond-issuer directory; bare symbol =
  // STK convenience. Hubs must REFUSE resolution (directories aren't
  // tradeable) instead of the old silent assume-STK.
  it('getNativeKey prefers conId, falls back to issuer: for bond hubs, then symbol', () => {
    const b = bareBroker()

    const leaf = new Contract()
    leaf.conId = 265598
    leaf.symbol = 'AAPL'
    expect(b.getNativeKey(leaf)).toBe('265598')

    const bondHub = new Contract()
    bondHub.secType = 'BOND'
    bondHub.issuerId = 'e1400789'
    expect(b.getNativeKey(bondHub)).toBe('issuer:e1400789')

    const symbolOnly = new Contract()
    symbolOnly.symbol = 'AAPL'
    expect(b.getNativeKey(symbolOnly)).toBe('AAPL')
  })

  it('resolveNativeKey refuses issuer: directories with an actionable message', () => {
    const b = bareBroker()
    expect(() => b.resolveNativeKey('issuer:e1400789')).toThrow(/directory.*expand|expand.*directory/i)
  })

  it('resolveNativeKey round-trips conId and keeps the STK symbol convenience', () => {
    const b = bareBroker()
    expect(b.resolveNativeKey('265598').conId).toBe(265598)
    const sym = b.resolveNativeKey('AAPL')
    expect(sym.symbol).toBe('AAPL')
    expect(sym.secType).toBe('STK')
  })
})

describe('IbkrBroker — getAccount mixed-currency math (ANG-101 / issues #295 #314)', () => {
  function brokerWithCache(values: Record<string, string>, positions: unknown[]): IbkrBroker {
    const b = bareBroker()
    ;(b as unknown as { bridge: unknown }).bridge = {
      getAccountCache: () => ({ values: new Map(Object.entries(values)), positions }),
    }
    return b
  }
  const hkdPos = { contract: { conId: 1 }, currency: 'HKD', unrealizedPnL: '-4767.62', marketValue: '46426.72' }
  const usdPos = { contract: { conId: 2 }, currency: 'USD', unrealizedPnL: '368.80', marketValue: '2913.10' }

  it('converts per-position PnL via TWS ExchangeRate tags instead of blind-summing', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1036370.91', NetLiquidation: '1046101.70',
      'ExchangeRate:HKD': '0.1276211',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [hkdPos, usdPos])
    const a = await b.getAccount()
    // -4767.62 × 0.1276211 + 368.80 = -239.66… (blind sum was -4398.82)
    expect(Number(a.unrealizedPnL)).toBeCloseTo(-239.66, 1)
    // Mixed book → TWS's consolidated NetLiquidation tag wins (#314)
    expect(a.netLiquidation).toBe('1046101.7')
  })

  it('missing FX rate falls back to broker values, never sums garbage', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1036370.91', NetLiquidation: '1046101.70', UnrealizedPnL: '-240',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [hkdPos, usdPos])
    const a = await b.getAccount()
    expect(a.unrealizedPnL).toBe('-240')
    expect(a.netLiquidation).toBe('1046101.7')
  })

  it('prefers broker NetLiquidation for a same-currency book too', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1000', NetLiquidation: '99999',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [{ ...usdPos, multiplier: '1', quantity: '10' }])
    const a = await b.getAccount()
    expect(a.netLiquidation).toBe('99999')
  })

  it('reconstructs NetLiquidation only when the broker value is unavailable', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1000',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [{ ...usdPos, multiplier: '1', quantity: '10', side: 'long' }])
    const a = await b.getAccount()
    expect(a.netLiquidation).toBe('3913.1')
  })

  it('reconstructs NetLiquidation when the broker value is non-finite', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1000', NetLiquidation: 'NaN',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [{ ...usdPos, multiplier: '1', quantity: '10', side: 'long' }])
    const a = await b.getAccount()
    expect(a.netLiquidation).toBe('3913.1')
  })
})

describe('IbkrBroker — option position snapshot marks (issue #314)', () => {
  function optionPosition() {
    const contract = Object.assign(new Contract(), {
      conId: 123456,
      symbol: 'AAPL',
      localSymbol: 'AAPL  260918C00250000',
      secType: 'OPT' as const,
      exchange: 'SMART',
      currency: 'USD',
      multiplier: '100',
    })
    return {
      contract,
      currency: 'USD',
      side: 'long' as const,
      quantity: new Decimal(2),
      avgCost: '1.5',
      marketPrice: '1',
      marketValue: '200',
      unrealizedPnL: '-100',
      realizedPnL: '0',
      multiplier: '100',
    }
  }

  it('overlays an option midpoint and recomputes multiplier-aware value and PnL', async () => {
    const position = optionPosition()
    const { broker, bridge } = brokerWithContractIo(position.contract)
    ;(bridge as unknown as { getAccountCache: unknown }).getAccountCache = () => ({
      values: new Map(),
      positions: [position],
    })
    bridge.requestSnapshot.mockResolvedValue({ bid: 2, ask: 4 })

    const [refreshed] = await broker.getPositions()

    expect(refreshed.marketPrice).toBe('3')
    expect(refreshed.marketValue).toBe('600')
    expect(refreshed.unrealizedPnL).toBe('300')
    expect(bridge.requestSnapshot).toHaveBeenCalledOnce()
    expect(bridge.requestSnapshot.mock.calls[0][2]).toEqual({ resolveOnBidAsk: true })
    expect(position.marketPrice).toBe('1') // cache remains broker-owned
  })

  it('keeps cached option marks when snapshot data is unavailable', async () => {
    const position = optionPosition()
    const { broker, bridge } = brokerWithContractIo(position.contract)
    ;(bridge as unknown as { getAccountCache: unknown }).getAccountCache = () => ({
      values: new Map(),
      positions: [position],
    })
    bridge.requestSnapshot.mockRejectedValue(new Error('market data subscription unavailable'))

    await expect(broker.getPositions()).resolves.toEqual([position])
    await expect(broker.getPositions()).resolves.toEqual([position])
    expect(bridge.requestSnapshot).toHaveBeenCalledOnce() // short negative cache
  })

  it('coalesces concurrent refreshes for the same option conId', async () => {
    const position = optionPosition()
    const { broker, bridge } = brokerWithContractIo(position.contract)
    ;(bridge as unknown as { getAccountCache: unknown }).getAccountCache = () => ({
      values: new Map(),
      positions: [position],
    })

    const [left, right] = await Promise.all([broker.getPositions(), broker.getPositions()])

    expect(left[0].marketPrice).toBe('0.8')
    expect(right[0].marketPrice).toBe('0.8')
    expect(bridge.requestSnapshot).toHaveBeenCalledOnce()
  })

  it('does not request snapshots for non-option positions', async () => {
    const position = { ...optionPosition(), contract: recordedContract('aapl-stock'), multiplier: '1' }
    const { broker, bridge } = brokerWithContractIo(position.contract)
    ;(bridge as unknown as { getAccountCache: unknown }).getAccountCache = () => ({
      values: new Map(),
      positions: [position],
    })

    await expect(broker.getPositions()).resolves.toEqual([position])
    expect(bridge.requestSnapshot).not.toHaveBeenCalled()
  })
})

describe('IbkrBroker — dead-connection gate (issue #294)', () => {
  it('cache-backed reads and order paths refuse loudly when the socket is known-dead', async () => {
    const b = bareBroker()
    ;(b as unknown as { bridge: unknown }).bridge = { connectionDead: true }

    await expect(b.getAccount()).rejects.toThrow(/connection lost/i)
    await expect(b.getPositions()).rejects.toThrow(/connection lost/i)

    const { contract, order } = stkOrder()
    const r = await b.placeOrder(contract, order)
    // placeOrder catches and returns { success: false } — the message must
    // still carry the dead-connection cause, not a generic failure.
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/connection lost/i)
  })

  it('probes the socket immediately before an order write', async () => {
    const { broker, bridge, client } = brokerWithContractIo(recordedContract('aapl-stock'))
    const { contract, order } = stkOrder()

    await expect(broker.placeOrder(contract, order)).resolves.toMatchObject({ success: true })

    expect(bridge.requestCurrentTime).toHaveBeenCalledOnce()
    expect(client.placeOrder).toHaveBeenCalledOnce()
    expect(bridge.requestCurrentTime.mock.invocationCallOrder[0])
      .toBeLessThan(client.placeOrder.mock.invocationCallOrder[0])
  })

  it('marks the connection dead and refuses without touching the order socket when the probe fails', async () => {
    const { broker, bridge, client } = brokerWithContractIo(recordedContract('aapl-stock'))
    bridge.requestCurrentTime.mockRejectedValue(new Error('silent half-open'))
    const { contract, order } = stkOrder()

    const result = await broker.placeOrder(contract, order)

    expect(result).toMatchObject({ success: false })
    expect(result.error).toMatch(/liveness|connection/i)
    expect(bridge.markDead).toHaveBeenCalledOnce()
    expect(client.placeOrder).not.toHaveBeenCalled()
  })

  it('uses the same write probe for modify and cancel', async () => {
    const canonical = recordedContract('aapl-stock')
    const { broker, bridge, client } = brokerWithContractIo(canonical)
    const originalOrder = limitBuy()
    originalOrder.orderId = 42
    ;(broker as unknown as { getOrder: unknown }).getOrder = vi.fn(async () => ({
      contract: canonical,
      order: originalOrder,
      orderState: { status: 'Submitted' },
    }))

    await expect(broker.modifyOrder('42', { lmtPrice: new Decimal('0.2') }))
      .resolves.toMatchObject({ success: true })
    await expect(broker.cancelOrder('42')).resolves.toMatchObject({ success: true })

    expect(bridge.requestCurrentTime).toHaveBeenCalledTimes(2)
    expect(client.placeOrder).toHaveBeenCalledOnce()
    expect(client.cancelOrder).toHaveBeenCalledOnce()
  })
})
