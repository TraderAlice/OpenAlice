import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { IbkrBroker } from './IbkrBroker.js'

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

  it('same-currency book keeps the reconstructed (fresher) netLiquidation', async () => {
    const b = brokerWithCache({
      TotalCashValue: '1000', NetLiquidation: '99999',
      RealizedPnL: '0', BuyingPower: '0', InitMarginReq: '0', MaintMarginReq: '0',
    }, [{ ...usdPos, multiplier: '1', quantity: '10' }])
    const a = await b.getAccount()
    expect(a.netLiquidation).not.toBe('99999') // cash + Σ marketValue, not the cached tag
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
})
