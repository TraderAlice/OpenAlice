import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import type { UnifiedTradingAccountOptions } from './UnifiedTradingAccount.js'
import { MockBroker, makeContract, makePosition, makeOpenOrder } from './brokers/mock/index.js'
import type { Operation } from './git/types.js'
import './contract-ext.js'

function createUTA(broker?: MockBroker, options?: UnifiedTradingAccountOptions): { uta: UnifiedTradingAccount; broker: MockBroker } {
  const b = broker ?? new MockBroker()
  const uta = new UnifiedTradingAccount(b, options)
  return { uta, broker: b }
}

/** Helper: extract the first staged operation's placeOrder fields */
function getStagedPlaceOrder(uta: UnifiedTradingAccount) {
  const staged = uta.status().staged
  expect(staged).toHaveLength(1)
  const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
  expect(op.action).toBe('placeOrder')
  return { contract: op.contract, order: op.order }
}

// ==================== Read-only / keyless write guard ====================

describe('UTA — read-only / keyless write guard', () => {
  it('refuses stage operations on a read-only account', () => {
    const { uta } = createUTA(undefined, { readOnly: true })
    expect(uta.readOnly).toBe(true)
    expect(uta.keyless).toBe(false)
    expect(() => uta.stageCancelOrder({ orderId: 'x' })).toThrow(/read-only/)
    expect(() => uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 1 } as never)).toThrow(/read-only/)
  })

  it('keyless implies read-only and names keyless in the error', () => {
    const { uta } = createUTA(undefined, { keyless: true })
    expect(uta.keyless).toBe(true)
    expect(uta.readOnly).toBe(true)
    expect(() => uta.stageCancelOrder({ orderId: 'x' })).toThrow(/keyless/)
  })

  it('a normal account stages without complaint', () => {
    const { uta } = createUTA()
    expect(uta.readOnly).toBe(false)
    expect(() => uta.stageCancelOrder({ orderId: 'x' })).not.toThrow()
  })
})

// ==================== Multi-sub-account write disambiguation ====================

describe('UTA — sub-account write disambiguation', () => {
  /** A MockBroker that pretends to be a separate-wallet venue (binance-shaped):
   *  two sub-accounts, instrument routes by secType. */
  function multiSubBroker(): MockBroker {
    const b = new MockBroker()
    ;(b as unknown as Record<string, unknown>).listSubAccounts = async () => ([
      { id: 'spot', label: 'Spot', kind: 'spot' },
      { id: 'derivatives', label: 'Futures', kind: 'derivatives' },
    ])
    ;(b as unknown as Record<string, unknown>).subAccountForContract = (c: Contract) =>
      (c.secType === 'CRYPTO_PERP' || c.secType === 'FUT') ? 'derivatives' : 'spot'
    return b
  }

  const placeParams = (subAccountId?: string) =>
    ({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '1', subAccountId } as never)

  it('single-sub-account brokers need no selector and stamp nothing', async () => {
    const { uta } = createUTA()  // plain MockBroker — one implicit default
    await uta.listSubAccounts()
    expect(() => uta.stagePlaceOrder(placeParams())).not.toThrow()
    const res = uta.commit('buy AAPL')
    expect(res.message).toBe('buy AAPL')  // no [sub:…] tag
  })

  it('multi-sub-account write WITHOUT a selector loud-refuses with the valid ids', async () => {
    const { uta } = createUTA(multiSubBroker())
    await uta.listSubAccounts()  // warm the cache
    expect(() => uta.stagePlaceOrder(placeParams())).toThrow(/multiple sub-accounts.*spot.*derivatives/s)
  })

  it('multi-sub-account write WITH a valid, instrument-consistent selector stamps the commit message', async () => {
    const { uta } = createUTA(multiSubBroker())
    await uta.listSubAccounts()
    expect(() => uta.stagePlaceOrder(placeParams('spot'))).not.toThrow()  // AAPL (STK) → spot
    const res = uta.commit('buy AAPL')
    expect(res.message).toBe('buy AAPL [sub:spot]')
  })

  it('rejects an unknown sub-account id', async () => {
    const { uta } = createUTA(multiSubBroker())
    await uta.listSubAccounts()
    expect(() => uta.stagePlaceOrder(placeParams('funding'))).toThrow(/unknown sub-account "funding".*spot, derivatives/s)
  })

  it('rejects a selector that contradicts the instrument', async () => {
    const { uta } = createUTA(multiSubBroker())
    await uta.listSubAccounts()
    // AAPL (STK) routes to 'spot'; asking for 'derivatives' is a wrong-wallet mistake.
    expect(() => uta.stagePlaceOrder(placeParams('derivatives'))).toThrow(/trades in sub-account "spot", not "derivatives"/)
  })

  it('clears the staged sub-account between commits — no stamp bleed-through', async () => {
    const { uta } = createUTA(multiSubBroker())
    await uta.listSubAccounts()

    uta.stagePlaceOrder(placeParams('spot'))
    expect(uta.commit('first').message).toBe('first [sub:spot]')

    // Second cycle: the tracker was cleared by the first commit, so this stamps
    // only its own sub-account (not 'first's leftover 'spot' duplicated).
    uta.stagePlaceOrder(placeParams('spot'))
    expect(uta.commit('second').message).toBe('second [sub:spot]')
  })
})

// ==================== Operation dispatch (via push) ====================

describe('UTA — operation dispatch', () => {
  let uta: UnifiedTradingAccount
  let broker: MockBroker

  beforeEach(() => {
    ({ uta, broker } = createUTA())
  })

  describe('placeOrder', () => {
    it('calls broker.placeOrder with contract and order', async () => {
      const spy = vi.spyOn(broker, 'placeOrder')
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)
      order.tif = 'DAY'

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [passedContract, passedOrder] = spy.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(passedOrder.action).toBe('BUY')
      expect(passedOrder.orderType).toBe('MKT')
      expect(passedOrder.totalQuantity.toNumber()).toBe(10)
    })

    it('passes aliceId and extra contract fields', async () => {
      const spy = vi.spyOn(broker, 'placeOrder')
      const contract = makeContract({
        aliceId: 'mock-paper|AAPL',
        symbol: 'AAPL',
        secType: 'STK',
        currency: 'USD',
        exchange: 'NASDAQ',
      })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.totalQuantity = new Decimal(5)
      order.lmtPrice = new Decimal(150)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('limit buy AAPL')
      await uta.push()

      const [passedContract, passedOrder] = spy.mock.calls[0]
      expect(passedContract.aliceId).toBe('mock-paper|AAPL')
      expect(passedContract.secType).toBe('STK')
      expect(passedContract.currency).toBe('USD')
      expect(passedContract.exchange).toBe('NASDAQ')
      expect(passedOrder.lmtPrice.toNumber()).toBe(150)
    })

    it('returns submitted result in push (fill confirmed via sync)', async () => {
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      const result = await uta.push()

      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].orderId).toBeDefined()
      expect(result.submitted[0].status).toBe('filled')
    })

    it('handles broker error', async () => {
      vi.spyOn(broker, 'placeOrder').mockResolvedValue({ success: false, error: 'Insufficient funds' })

      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      const result = await uta.push()

      expect(result.rejected).toHaveLength(1)
    })
  })

  describe('closePosition', () => {
    it('calls broker.closePosition with contract and qty', async () => {
      const spy = vi.spyOn(broker, 'closePosition')
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract, quantity: new Decimal(5) })
      uta.git.commit('partial close AAPL')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [passedContract, qty] = spy.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(qty!.toNumber()).toBe(5)
    })

    it('passes undefined qty for full close', async () => {
      const spy = vi.spyOn(broker, 'closePosition')
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract })
      uta.git.commit('close AAPL')
      await uta.push()

      const [, qty] = spy.mock.calls[0]
      expect(qty).toBeUndefined()
    })
  })

  describe('cancelOrder', () => {
    it('calls broker.cancelOrder and records as cancelled', async () => {
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      const spy = vi.spyOn(broker, 'cancelOrder').mockResolvedValue({
        success: true, orderId: 'ord-789', orderState,
      })
      uta.git.add({ action: 'cancelOrder', orderId: 'ord-789' })
      uta.git.commit('cancel order')
      const result = await uta.push()

      expect(spy).toHaveBeenCalledWith('ord-789', undefined)
      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('cancelled')
      expect(result.rejected).toHaveLength(0)
    })
  })

  describe('modifyOrder', () => {
    it('calls broker.modifyOrder with orderId and changes', async () => {
      const spy = vi.spyOn(broker, 'modifyOrder')
      const changes: Partial<Order> = { lmtPrice: 155, totalQuantity: new Decimal(20) } as any
      uta.git.add({ action: 'modifyOrder', orderId: 'ord-123', changes })
      uta.git.commit('modify order')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [orderId, passedChanges] = spy.mock.calls[0]
      expect(orderId).toBe('ord-123')
      expect(passedChanges.lmtPrice).toBe(155)
    })
  })
})

// ==================== State bridge (via getState) ====================

describe('UTA — getState', () => {
  let uta: UnifiedTradingAccount
  let broker: MockBroker

  beforeEach(() => {
    ({ uta, broker } = createUTA())
  })

  it('assembles GitState from broker data', async () => {
    broker.setAccountInfo({ totalCashValue: '50000', netLiquidation: '55000', unrealizedPnL: '3000', realizedPnL: '800' })
    broker.setPositions([makePosition()])

    // Push a limit order to create a pending entry in git history
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '5', lmtPrice: '145' })
    uta.commit('limit buy')
    await uta.push()

    const state = await uta.getState()

    expect(state.totalCashValue).toBe('50000')
    expect(state.netLiquidation).toBe('55000')
    expect(state.unrealizedPnL).toBe('3000')
    expect(state.realizedPnL).toBe('800')
    expect(state.positions).toHaveLength(1)
    // Limit order is pending (Submitted) — found via getOrders([pendingId])
    expect(state.pendingOrders).toHaveLength(1)
    expect(state.pendingOrders[0].orderState.status).toBe('Submitted')
  })

  it('calls all three broker methods', async () => {
    const spyAccount = vi.spyOn(broker, 'getAccount')
    const spyPositions = vi.spyOn(broker, 'getPositions')
    const spyOrders = vi.spyOn(broker, 'getOrders')
    await uta.getState()

    expect(spyAccount).toHaveBeenCalledTimes(1)
    expect(spyPositions).toHaveBeenCalledTimes(1)
    expect(spyOrders).toHaveBeenCalledTimes(1)
  })

  it('returns empty pendingOrders when no orders are pending', async () => {
    const filledState = new OrderState()
    filledState.status = 'Filled'
    const cancelledState = new OrderState()
    cancelledState.status = 'Cancelled'

    broker.setOrders([
      makeOpenOrder({ orderState: filledState }),
      makeOpenOrder({ orderState: cancelledState }),
    ])

    const state = await uta.getState()

    expect(state.pendingOrders).toHaveLength(0)
  })
})

// ==================== getAccount PnL invariant ====================

describe('UTA — getAccount PnL invariant', () => {
  it('account-level unrealizedPnL equals the sum over positions (broker placeholder overridden)', async () => {
    const { uta, broker } = createUTA()
    // CCXT-spot pattern: broker account info carries a placeholder 0 while
    // the positions surface has real PnL. MockBroker derives position PnL
    // from qty/avgCost/markPrice: (160-150)*10 = 100 and (1645.46-1644.44)*2
    // = 2.04 → account must report the 102.04 sum, not the placeholder.
    broker.setAccountInfo({ unrealizedPnL: '0' })
    broker.setPositions([
      makePosition({ quantity: new Decimal(10), avgCost: '150', marketPrice: '160' }),
      makePosition({
        contract: makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH', secType: 'CRYPTO' }),
        quantity: new Decimal(2),
        avgCost: '1644.44',
        marketPrice: '1645.46',
      }),
    ])

    const account = await uta.getAccount()
    expect(account.unrealizedPnL).toBe('102.04')
  })

  it('keeps the broker-reported value for mixed-currency books (no blind cross-currency sum)', async () => {
    const { uta, broker } = createUTA()
    broker.setAccountInfo({ baseCurrency: 'USD', unrealizedPnL: '777' })
    broker.setPositions([
      makePosition({ unrealizedPnL: '100' }), // USD
      makePosition({
        contract: makeContract({ aliceId: 'mock-paper|0700', symbol: '0700', currency: 'HKD' }),
        currency: 'HKD',
        unrealizedPnL: '500', // HKD — not summable with USD
      }),
    ])

    const account = await uta.getAccount()
    expect(account.unrealizedPnL).toBe('777')
  })
})

// ==================== aliceId expansion overlay ====================

describe('UTA — _expandAliceIdIfNeeded overlay (via getQuote)', () => {
  it('does not clobber resolved fields with Contract numeric defaults (conId=0)', async () => {
    // Regression (IBKR round 7): the HTTP route wraps the body with
    // Object.assign(new Contract(), body) — string defaults ('') were
    // skipped by the overlay, but conId=0 was copied and CLOBBERED the
    // expanded conId. The broker got an all-empty contract → TWS 321.
    const broker = new MockBroker()
    const seen: Contract[] = []
    broker.resolveNativeKey = (nativeKey: string) => {
      const c = new Contract()
      c.conId = 12087792
      c.symbol = 'EUR'
      c.secType = 'CASH'
      c.exchange = 'IDEALPRO'
      c.currency = 'USD'
      void nativeKey
      return c
    }
    const origQuote = broker.getQuote.bind(broker)
    broker.getQuote = async (c: Contract) => {
      seen.push(c)
      return origQuote(makeContract({ symbol: 'EUR' }))
    }
    const uta = new UnifiedTradingAccount(broker)

    // Route-style stub: aliceId only, every other field at Contract defaults
    const stub = Object.assign(new Contract(), { aliceId: 'mock-paper|12087792' })
    await uta.getQuote(stub)

    expect(seen).toHaveLength(1)
    expect(seen[0].conId).toBe(12087792)
    expect(seen[0].symbol).toBe('EUR')
    expect(seen[0].exchange).toBe('IDEALPRO')
  })

  it('still applies caller overrides that carry real values', async () => {
    const broker = new MockBroker()
    const seen: Contract[] = []
    broker.resolveNativeKey = () => {
      const c = new Contract()
      c.conId = 42
      c.symbol = 'AAPL'
      c.exchange = 'SMART'
      return c
    }
    const origQuote = broker.getQuote.bind(broker)
    broker.getQuote = async (c: Contract) => {
      seen.push(c)
      return origQuote(makeContract({ symbol: 'AAPL' }))
    }
    const uta = new UnifiedTradingAccount(broker)

    const stub = Object.assign(new Contract(), { aliceId: 'mock-paper|42', exchange: 'NASDAQ' })
    await uta.getQuote(stub)

    expect(seen[0].conId).toBe(42)
    expect(seen[0].exchange).toBe('NASDAQ') // real override survives
  })
})

// ==================== stagePlaceOrder ====================

describe('UTA — stagePlaceOrder', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('sets BUY action', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('BUY')
  })

  it('sets SELL action', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'MKT', totalQuantity: '10' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('SELL')
  })

  it('passes order types through', () => {
    // Each type with its required fields (stage-time validation refuses less)
    const cases: Array<[string, Record<string, string>]> = [
      ['MKT', {}],
      ['LMT', { lmtPrice: '100' }],
      ['STP', { auxPrice: '95' }],
      ['STP LMT', { auxPrice: '95', lmtPrice: '94' }],
      ['TRAIL', { auxPrice: '5' }],
    ]
    for (const [orderType, extra] of cases) {
      const { uta: u } = createUTA()
      u.stagePlaceOrder({ aliceId: 'mock-paper|X', action: 'BUY', orderType, totalQuantity: '1', ...extra })
      const { order } = getStagedPlaceOrder(u)
      expect(order.orderType).toBe(orderType)
    }
  })

  describe('per-orderType required-field gate (stage-time refusal)', () => {
    // The bug this guards: a CLI typo (--quantity for --totalQuantity) staged
    // a quantity-less, price-less LMT order that committed clean.
    const place = (p: Record<string, unknown>) =>
      uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', ...p } as never)

    it('refuses LMT without lmtPrice', () => {
      expect(() => place({ orderType: 'LMT', totalQuantity: '1' })).toThrow(/requires lmtPrice/)
    })

    it('refuses LMT without any quantity', () => {
      expect(() => place({ orderType: 'LMT', lmtPrice: '100' })).toThrow(/requires totalQuantity/)
    })

    it('refuses MKT with neither totalQuantity nor cashQty', () => {
      expect(() => place({ orderType: 'MKT' })).toThrow(/totalQuantity .*or cashQty/)
    })

    it('refuses totalQuantity + cashQty together', () => {
      expect(() => place({ orderType: 'MKT', totalQuantity: '1', cashQty: '100' })).toThrow(/mutually exclusive/)
    })

    it('refuses cashQty on non-MKT orders', () => {
      expect(() => place({ orderType: 'LMT', cashQty: '100', lmtPrice: '100' })).toThrow(/only supported for MKT/)
    })

    it('refuses STP without auxPrice', () => {
      expect(() => place({ orderType: 'STP', totalQuantity: '1' })).toThrow(/requires auxPrice/)
    })

    it('refuses STP LMT missing either price', () => {
      expect(() => place({ orderType: 'STP LMT', totalQuantity: '1', lmtPrice: '94' })).toThrow(/requires auxPrice/)
      expect(() => place({ orderType: 'STP LMT', totalQuantity: '1', auxPrice: '95' })).toThrow(/requires lmtPrice/)
    })

    it('refuses TRAIL with neither/both of auxPrice and trailingPercent', () => {
      expect(() => place({ orderType: 'TRAIL', totalQuantity: '1' })).toThrow(/auxPrice .*or trailingPercent/)
      expect(() => place({ orderType: 'TRAIL', totalQuantity: '1', auxPrice: '5', trailingPercent: '1' })).toThrow(/mutually exclusive/)
    })

    it('refuses TRAIL LIMIT without lmtPrice', () => {
      expect(() => place({ orderType: 'TRAIL LIMIT', totalQuantity: '1', auxPrice: '5' })).toThrow(/requires lmtPrice/)
    })

    it('treats empty string as absent (LLM-emitted "" must not satisfy a requirement)', () => {
      expect(() => place({ orderType: 'LMT', totalQuantity: '1', lmtPrice: '' })).toThrow(/requires lmtPrice/)
    })
  })

  it('sets totalQuantity as Decimal', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '42' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.totalQuantity).toBeInstanceOf(Decimal)
    expect(order.totalQuantity.toNumber()).toBe(42)
  })

  it('sets cashQty', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', cashQty: '5000' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.cashQty.toNumber()).toBe(5000)
  })

  it('sets lmtPrice and auxPrice', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'STP LMT', totalQuantity: '10', lmtPrice: '150', auxPrice: '145' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.lmtPrice.toNumber()).toBe(150)
    expect(order.auxPrice.toNumber()).toBe(145)
  })

  it('auxPrice sets trailing offset for TRAIL orders', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: '10', auxPrice: '5' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.auxPrice.toNumber()).toBe(5)
    expect(order.orderType).toBe('TRAIL')
  })

  it('TRAIL order with trailStopPrice and auxPrice', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: '10', trailStopPrice: '145', auxPrice: '5' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.trailStopPrice.toNumber()).toBe(145)
    expect(order.auxPrice.toNumber()).toBe(5)
  })

  it('sets trailingPercent', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: '10', trailingPercent: '2.5' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.trailingPercent.toNumber()).toBe(2.5)
  })

  it('preserves string-input precision for price fields (crypto-scale)', () => {
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|ETH', action: 'BUY', orderType: 'LMT',
      totalQuantity: '0.12345678', lmtPrice: '0.00001234',
    })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.totalQuantity.toFixed()).toBe('0.12345678')
    expect(order.lmtPrice.toFixed()).toBe('0.00001234')
  })

  it('JSON round-trips staged price as string (not number)', () => {
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'LMT',
      totalQuantity: '10', lmtPrice: '145.25',
    })
    const wire = JSON.parse(JSON.stringify(uta.status()))
    const staged = wire.staged[0]
    expect(typeof staged.order.lmtPrice).toBe('string')
    expect(staged.order.lmtPrice).toBe('145.25')
    expect(typeof staged.order.totalQuantity).toBe('string')
  })

  it('defaults tif to DAY', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('DAY')
  })

  it('allows overriding tif', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150', tif: 'GTC' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('GTC')
  })

  it('sets outsideRth', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150', outsideRth: true })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.outsideRth).toBe(true)
  })

  it('sets aliceId and symbol on contract', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    const { contract } = getStagedPlaceOrder(uta)
    expect(contract.aliceId).toBe('mock-paper|AAPL')
    expect(contract.symbol).toBe('AAPL')
  })

  it('sets tpsl with takeProfit only', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10', takeProfit: { price: '160' } })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({ takeProfit: { price: '160' }, stopLoss: undefined })
  })

  it('sets tpsl with stopLoss only', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10', stopLoss: { price: '140' } })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({ takeProfit: undefined, stopLoss: { price: '140' } })
  })

  it('sets tpsl with both TP and SL', () => {
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10',
      takeProfit: { price: '160' }, stopLoss: { price: '140', limitPrice: '139.50' },
    })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({
      takeProfit: { price: '160' },
      stopLoss: { price: '140', limitPrice: '139.50' },
    })
  })

  it('omits tpsl when neither TP nor SL provided', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toBeUndefined()
  })
})

// ==================== stageModifyOrder ====================

describe('UTA — stageModifyOrder', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('sets provided fields on Partial<Order>', () => {
    uta.stageModifyOrder({ orderId: 'ord-1', totalQuantity: '20', lmtPrice: '155', orderType: 'LMT', tif: 'GTC' })
    const staged = uta.status().staged
    expect(staged).toHaveLength(1)
    const op = staged[0] as Extract<Operation, { action: 'modifyOrder' }>
    expect(op.action).toBe('modifyOrder')
    expect(op.orderId).toBe('ord-1')
    expect(op.changes.totalQuantity).toBeInstanceOf(Decimal)
    expect(op.changes.totalQuantity!.toNumber()).toBe(20)
    expect(op.changes.lmtPrice!.toNumber()).toBe(155)
    expect(op.changes.orderType).toBe('LMT')
    expect(op.changes.tif).toBe('GTC')
  })

  it('omits fields not provided', () => {
    uta.stageModifyOrder({ orderId: 'ord-1', lmtPrice: '160' })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'modifyOrder' }>
    expect(op.changes.lmtPrice!.toNumber()).toBe(160)
    expect(op.changes.totalQuantity).toBeUndefined()
    expect(op.changes.orderType).toBeUndefined()
    expect(op.changes.tif).toBeUndefined()
  })
})

// ==================== stageClosePosition ====================

describe('UTA — stageClosePosition', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('stages with Decimal quantity when qty provided', () => {
    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL', qty: '5' })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'closePosition' }>
    expect(op.action).toBe('closePosition')
    expect(op.contract.aliceId).toBe('mock-paper|AAPL')
    expect(op.quantity).toBeInstanceOf(Decimal)
    expect(op.quantity!.toNumber()).toBe(5)
  })

  it('stages with undefined quantity for full close', () => {
    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL' })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'closePosition' }>
    expect(op.quantity).toBeUndefined()
  })
})

// ==================== contractFromAliceId ====================

describe('UTA — contractFromAliceId', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('resolves a valid aliceId to a Contract with native fields filled', () => {
    const contract = uta.contractFromAliceId('mock-paper|AAPL')
    expect(contract.aliceId).toBe('mock-paper|AAPL')
    // MockBroker.resolveNativeKey produces a stamped Contract with the
    // ticker on `symbol` — anything more concrete is broker-specific, but
    // we at minimum want a non-empty handle that downstream broker APIs
    // can resolve back to the same market.
    expect(contract.symbol || contract.localSymbol).toBeTruthy()
  })

  it('throws on malformed aliceId (no separator)', () => {
    expect(() => uta.contractFromAliceId('mock-paper-AAPL')).toThrow(/Invalid aliceId/)
  })

  it('throws when aliceId belongs to a different UTA', () => {
    expect(() => uta.contractFromAliceId('alpaca-paper|AAPL')).toThrow(/belongs to UTA "alpaca-paper"/)
  })
})

// ==================== stageCancelOrder ====================

describe('UTA — stageCancelOrder', () => {
  it('stages cancelOrder with orderId', () => {
    const { uta } = createUTA()
    uta.stageCancelOrder({ orderId: 'ord-999' })
    const staged = uta.status().staged
    expect(staged).toHaveLength(1)
    const op = staged[0] as Extract<Operation, { action: 'cancelOrder' }>
    expect(op.action).toBe('cancelOrder')
    expect(op.orderId).toBe('ord-999')
  })
})

// ==================== git flow edge cases ====================

describe('UTA — git flow', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('commit throws when staging area is empty', () => {
    expect(() => uta.commit('empty')).toThrow('staging area is empty')
  })

  it('push throws when not committed', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    await expect(uta.push()).rejects.toThrow('please commit first')
  })

  it('executes multiple operations in a single push', async () => {
    const { uta: u, broker: b } = createUTA()
    const spy = vi.spyOn(b, 'placeOrder')
    u.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    u.stagePlaceOrder({ aliceId: 'mock-paper|MSFT', symbol: 'MSFT', action: 'BUY', orderType: 'MKT', totalQuantity: '5' })
    u.commit('buy both')
    await u.push()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('clears staging area after push', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy')
    await uta.push()

    expect(uta.status().staged).toHaveLength(0)
  })
})

// ==================== sync ====================

describe('UTA — sync', () => {
  it('returns updatedCount: 0 when no pending orders', async () => {
    const { uta } = createUTA()
    const result = await uta.sync()
    expect(result.updatedCount).toBe(0)
  })

  it('detects pending order becoming filled', async () => {
    const { uta, broker } = createUTA()

    // Limit order → MockBroker keeps it pending naturally
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]?.orderId
    expect(orderId).toBeDefined()

    // Simulate fill via test helper
    broker.fillPendingOrder(orderId!, 149)

    const result = await uta.sync()
    expect(result.updatedCount).toBe(1)
    expect(result.updates[0].orderId).toBe(orderId)
    expect(result.updates[0].currentStatus).toBe('filled')
    // Execution data must flow into the sync record — without qty/price the
    // fill is invisible to cost-basis reconstruction.
    expect(result.updates[0].filledQty).toBe('10')
    expect(result.updates[0].filledPrice).toBe('149')
  })

  it('records cumulative qty + weighted avg price across partial fills', async () => {
    const { uta, broker } = createUTA()

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]!.orderId!

    broker.fillOrder(orderId, { qty: '4', price: '148' })
    broker.fillOrder(orderId, { qty: '6', price: '150' })

    const result = await uta.sync()
    expect(result.updates[0].currentStatus).toBe('filled')
    expect(result.updates[0].filledQty).toBe('10')
    // (148*4 + 150*6) / 10 = 149.2
    expect(result.updates[0].filledPrice).toBe('149.2')
  })

  it('listing mode: getOrder is spent ONLY on orders absent from the open-orders listing', async () => {
    const { uta, broker } = createUTA()

    // Two pending limit orders; one fills (vanishes from the listing).
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('a'); const a = (await uta.push()).submitted[0]!.orderId!
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '5', lmtPrice: '140' })
    uta.commit('b'); const b = (await uta.push()).submitted[0]!.orderId!
    broker.fillOrder(a, { price: '149' })

    const getOrderSpy = vi.spyOn(broker, 'getOrder')
    const result = await uta.sync()

    // Transition pass: the confirm step polls ONLY the vanished order (a).
    // (_getState's snapshot read adds delegated getOrder calls via
    // getOrders — those happen once per pass WITH updates, not per order
    // per pass, so assert on the confirm call specifically.)
    expect(getOrderSpy.mock.calls.filter((c) => c[0] === a && c.length > 1)).toHaveLength(1)
    expect(result.updatedCount).toBe(1)
    expect(uta.getPendingOrderIds().map((p) => p.orderId)).toEqual([b])

    // Steady-state pass: order b hangs (still in the listing) — ZERO
    // getOrder calls. A stop/TP parked for weeks costs one listing per
    // pass for the whole account, not one poll per order.
    getOrderSpy.mockClear()
    const second = await uta.sync()
    expect(second.updatedCount).toBe(0)
    expect(getOrderSpy).not.toHaveBeenCalled()
  })

  it('per-order fallback: brokers without a listing API still detect fills', async () => {
    const { uta, broker } = createUTA()
    // Simulate a venue with no open-orders enumeration.
    ;(broker as { getOpenOrders?: unknown }).getOpenOrders = undefined

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('limit buy')
    const orderId = (await uta.push()).submitted[0]!.orderId!
    broker.fillPendingOrder(orderId, 149)

    const result = await uta.sync()
    expect(result.updatedCount).toBe(1)
    expect(result.updates[0].currentStatus).toBe('filled')
  })

  it('per-order fallback: hangers back off (5min cadence after an hour)', async () => {
    vi.useFakeTimers()
    try {
      const { uta, broker } = createUTA()
      ;(broker as { getOpenOrders?: unknown }).getOpenOrders = undefined

      uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
      uta.commit('limit buy')
      await uta.push()

      const getOrderSpy = vi.spyOn(broker, 'getOrder')
      await uta.sync() // fresh — polls (registers firstSeen)
      expect(getOrderSpy).toHaveBeenCalledTimes(1)

      // Two hours later, two syncs 10s apart: only the first polls.
      vi.advanceTimersByTime(2 * 60 * 60_000)
      await uta.sync()
      vi.advanceTimersByTime(10_000)
      await uta.sync()
      expect(getOrderSpy).toHaveBeenCalledTimes(2)

      // 5 minutes on, it's due again.
      vi.advanceTimersByTime(5 * 60_000)
      await uta.sync()
      expect(getOrderSpy).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the operation localSymbol as the broker symbolHint', async () => {
    const { uta, broker } = createUTA()

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]!.orderId!
    broker.fillPendingOrder(orderId, 149)

    const spy = vi.spyOn(broker, 'getOrder')
    await uta.sync()
    // MockBroker stamps localSymbol = nativeKey on contracts it resolves; a
    // symbol-scoped broker (CCXT) needs this hint to look orders up after a
    // restart wipes its in-memory cache.
    expect(spy).toHaveBeenCalledWith(orderId, expect.any(String))
  })

  it('does not update when pending order not found in broker', async () => {
    const { uta, broker } = createUTA()

    // Limit order → pending
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '10', lmtPrice: '150' })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]?.orderId
    expect(orderId).toBeDefined()

    // Clear all orders — simulates order vanishing from exchange
    broker.setOrders([])
    const result = await uta.sync()
    expect(result.updatedCount).toBe(0)
  })
})

// ==================== reconcile race guard ====================

describe('UTA — wallet reconcile defers while orders are in flight', () => {
  it('drift is not booked at mark price while the aliceId has a pending order; residual reconciles after settlement', async () => {
    const { uta, broker } = createUTA()
    const aliceId = 'mock-paper|AAPL'
    broker.setPositions([
      makePosition({
        contract: makeContract({ aliceId }),
        quantity: new Decimal(10),
        avgCost: '150',
        marketPrice: '160',
        avgCostSource: 'wallet',
      }),
    ])

    // In-flight order on the same aliceId.
    uta.stagePlaceOrder({ aliceId, symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '5', lmtPrice: '150' })
    uta.commit('limit buy')
    const orderId = (await uta.push()).submitted[0]!.orderId!

    // The dfb01435 race: positions read while the fill is in flight must
    // NOT record drift as a mark-price reconcile.
    await uta.getPositions()
    expect(uta.log({ limit: 10 }).some((c) => c.message.startsWith('reconcile:'))).toBe(false)

    // Order settles and syncs (fill enters cost basis at execution price).
    broker.fillPendingOrder(orderId, 149)
    await uta.sync()

    // No in-flight orders left — the TRUE residual (the pre-existing 10
    // that no order explains) reconciles now.
    await uta.getPositions()
    const reconcile = uta.log({ limit: 10 }).find((c) => c.message.startsWith('reconcile:'))
    expect(reconcile).toBeDefined()
  })
})

// ==================== guards ====================

describe('UTA — guards', () => {
  it('rejects operation when guard blocks it', async () => {
    const { uta, broker } = createUTA(undefined, {
      guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
    })
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({ aliceId: 'mock-paper|TSLA', symbol: 'TSLA', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy TSLA (should be blocked)')
    const result = await uta.push()

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].error).toContain('guard')
    expect(spy).not.toHaveBeenCalled()
  })

  it('allows operation when guard passes', async () => {
    const { uta, broker } = createUTA(undefined, {
      guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
    })
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL (allowed)')
    await uta.push()

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// ==================== constructor — savedState ====================

describe('UTA — constructor', () => {
  it('restores from savedState', async () => {
    // Create a UTA, push a commit, export state
    const { uta: original } = createUTA()
    original.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    original.commit('initial buy')
    await original.push()

    const savedState = original.exportGitState()
    expect(original.log()).toHaveLength(1)

    // Create new UTA from saved state
    const { uta: restored } = createUTA(undefined, { savedState })
    expect(restored.log()).toHaveLength(1)
    expect(restored.log()[0].message).toBe('initial buy')
  })
})

// ==================== health tracking ====================

describe('UTA — health tracking', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** Let _connect() (fire-and-forget from constructor) complete via microtask flush. */
  async function flush() { await vi.advanceTimersByTimeAsync(0) }

  it('connects automatically on construction and becomes healthy', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().lastSuccessAt).toBeInstanceOf(Date)
  })

  it('goes offline and starts recovery when initial connect fails', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100) // init + getAccount will fail
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
  })

  it('auto-recovers after initial connect failure when broker comes back', async () => {
    const broker = new MockBroker()
    // _connect calls init() which fails (consumes 1). Recovery at 5s: init() + getAccount() succeed.
    broker.setFailMode(1)
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')

    // Advance to trigger first recovery attempt — broker is back (failMode exhausted)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('transitions healthy → degraded after 3 consecutive failures', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(3)

    for (let i = 0; i < 3; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('degraded')
  })

  it('transitions degraded → offline after 6 consecutive failures', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(6)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    await uta.close()
  })

  it('resets to healthy on any successful call', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(4)

    for (let i = 0; i < 4; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('degraded')

    // Next call succeeds (failMode exhausted)
    await uta.getAccount()
    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().consecutiveFailures).toBe(0)
  })

  it('fails fast when offline and recovering', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(100)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)

    // Subsequent calls fail fast with offline message
    await expect(uta.getAccount()).rejects.toThrow(/offline and reconnecting/)
    await uta.close()
  })

  it('push() throws when offline', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(100)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL')
    await expect(uta.push()).rejects.toThrow(/offline/)
    await uta.close()
  })

  it('auto-recovery restores healthy after runtime disconnect', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    expect(uta.health).toBe('healthy')

    // Go offline via runtime failures
    broker.setFailMode(6)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)

    // Broker is back (failMode exhausted) — advance timer to trigger recovery
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('close() cancels recovery timer', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100)
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('getHealthInfo returns full snapshot', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()

    const info = uta.getHealthInfo()
    expect(info.status).toBe('healthy')
    expect(info.consecutiveFailures).toBe(0)
    expect(info.lastSuccessAt).toBeInstanceOf(Date)
    expect(info.recovering).toBe(false)
  })

  it('tracks health across different broker methods', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(2)

    await expect(uta.getAccount()).rejects.toThrow()
    await expect(uta.getPositions()).rejects.toThrow()
    expect(uta.getHealthInfo().consecutiveFailures).toBe(2)

    // Success on a different method resets
    await uta.getMarketClock()
    expect(uta.health).toBe('healthy')
  })

  // ---- capability ladder (connect / read / write are different things) ----

  it('keyless data account is healthy at "connected" and never probes getAccount', async () => {
    const broker = new MockBroker()
    broker.setFailMethod('getAccount') // would throw "requires apiKey" if the probe touched it
    const { uta } = createUTA(broker, { keyless: true })
    await flush()

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().reach).toBe('connected')
    expect(uta.getHealthInfo().tier).toBe('data')
    expect(broker.callCount('getAccount')).toBe(0) // the fix: probe stops at L1
  })

  it('funded account with failing account-read is degraded (connected), not offline, and recovers', async () => {
    const broker = new MockBroker()
    broker.setFailMethod('getAccount')
    const { uta } = createUTA(broker) // funded → target "readable"
    await flush()

    expect(uta.getHealthInfo().reach).toBe('connected') // transport up...
    expect(uta.health).toBe('degraded')                 // ...but below target — NOT a full outage
    expect(uta.getHealthInfo().recovering).toBe(true)

    broker.clearFailMethod('getAccount') // account-read comes back
    await vi.advanceTimersByTimeAsync(5_000)
    expect(uta.getHealthInfo().reach).toBe('readable')
    expect(uta.health).toBe('healthy')
    await uta.close()
  })

  it('reports tier: data (keyless) / account (read-only) / trading (writable)', () => {
    expect(createUTA(new MockBroker(), { keyless: true }).uta.getHealthInfo().tier).toBe('data')
    expect(createUTA(new MockBroker(), { readOnly: true }).uta.getHealthInfo().tier).toBe('account')
    expect(createUTA(new MockBroker()).uta.getHealthInfo().tier).toBe('trading')
  })
})

// ==================== Wallet cost-basis reconciliation ====================

describe('UTA — getPositions wallet reconciliation', () => {
  it('passes through positions with avgCostSource=broker untouched', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({ avgCostSource: 'broker', avgCost: '150', marketPrice: '160', unrealizedPnL: '100' })])
    const { uta } = createUTA(broker)
    const positions = await uta.getPositions()
    expect(positions[0].avgCost).toBe('150')
    expect(positions[0].unrealizedPnL).toBe('100')
  })

  it('passes through positions without avgCostSource (back-compat)', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({ avgCost: '150', marketPrice: '160', unrealizedPnL: '100' })])
    const { uta } = createUTA(broker)
    const positions = await uta.getPositions()
    expect(positions[0].avgCost).toBe('150')
    expect(positions[0].unrealizedPnL).toBe('100')
  })

  it('bootstraps at broker-reported avgCost when it differs from markPrice', async () => {
    // Mock externalTrade scenario: broker observed a real fill at $148.50,
    // current mark is $152. Bootstrap should use the trade price, not mark
    // — otherwise we destroy the broker's correct cost basis on first sight
    // (covered call test surfaced this 2026-05-07: AAPL bought at $148.50,
    // mark at $152, UI showed avgCost=$152 / PnL=0 instead of avgCost=$148.50
    // / PnL=+$350).
    const broker = new MockBroker()
    broker.setPositions([makePosition({
      contract: makeContract({ symbol: 'AAPL', secType: 'STK' }),
      quantity: new Decimal('100'),
      avgCost: '148.50',           // broker has the real trade price
      marketPrice: '152',          // mark moved up
      unrealizedPnL: '0',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)

    const positions = await uta.getPositions()
    expect(new Decimal(positions[0].avgCost).toNumber()).toBeCloseTo(148.50, 4)
    expect(new Decimal(positions[0].unrealizedPnL).toNumber()).toBeCloseTo(350, 4)

    // Reconcile commit recorded the drift at the trade price, not markPrice.
    const commits = uta.git.exportState().commits
    const reconciles = commits.filter(c => c.operations.some(op => op.action === 'reconcileBalance'))
    expect(reconciles).toHaveLength(1)
    const op = reconciles[0].operations[0] as Extract<Operation, { action: 'reconcileBalance' }>
    expect(new Decimal(op.markPrice).toNumber()).toBeCloseTo(148.50, 4)
  })

  it('bootstraps a wallet position with no history → reconcile at markPrice, PnL=0', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({
      contract: makeContract({ symbol: 'BTC' }),
      quantity: new Decimal('1.0093'),
      avgCost: '80569.90',
      marketPrice: '80569.90',
      unrealizedPnL: '0',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)

    const positions = await uta.getPositions()
    expect(new Decimal(positions[0].avgCost).toNumber()).toBeCloseTo(80569.90, 4)
    expect(positions[0].unrealizedPnL).toBe('0')

    // Synthetic reconcile commit was created
    const commits = uta.git.exportState().commits
    const reconciles = commits.filter(c => c.operations.some(op => op.action === 'reconcileBalance'))
    expect(reconciles).toHaveLength(1)
    const op = reconciles[0].operations[0] as Extract<Operation, { action: 'reconcileBalance' }>
    expect(op.aliceId).toBe('mock-paper|BTC')
    expect(new Decimal(op.quantityDelta).toNumber()).toBeCloseTo(1.0093, 4)
  })

  it('uses markPrice drift to compute true PnL after first observation', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1'),
      avgCost: '80000',  // placeholder = markPrice on first sight
      marketPrice: '80000',
      unrealizedPnL: '0',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)
    await uta.getPositions()  // bootstrap

    // Price moves up. avgCost should stay at the bootstrap price; PnL reflects change.
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1'),
      avgCost: '90000',  // broker placeholder updates to current markPrice
      marketPrice: '90000',
      unrealizedPnL: '0',
      avgCostSource: 'wallet',
    })])
    const positions = await uta.getPositions()
    expect(new Decimal(positions[0].avgCost).toNumber()).toBe(80000)
    expect(new Decimal(positions[0].unrealizedPnL).toNumber()).toBe(10000)
  })

  it('reconciles upward drift: broker reports more qty than git projects', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1'),
      avgCost: '80000',
      marketPrice: '80000',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)
    await uta.getPositions()  // first sight: bootstrap 1 BTC @ 80k

    // External deposit: broker now reports 1.5 BTC. markPrice climbed to 100k.
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1.5'),
      avgCost: '100000',
      marketPrice: '100000',
      avgCostSource: 'wallet',
    })])
    const positions = await uta.getPositions()

    // WAC over (1@80k bootstrap, 0.5@100k drift) = (80000 + 50000) / 1.5 ≈ 86666.67
    expect(new Decimal(positions[0].avgCost).toNumber()).toBeCloseTo(86666.67, 2)
    // PnL = (100000 - 86666.67) * 1.5 ≈ 20000
    expect(new Decimal(positions[0].unrealizedPnL).toNumber()).toBeCloseTo(20000, 0)
  })

  it('does not synthesize reconcile for sub-dust drift', async () => {
    const broker = new MockBroker()
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1'),
      avgCost: '80000',
      marketPrice: '80000',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)
    await uta.getPositions()  // bootstrap commit 1

    // Same qty (modulo dust) — no new commit should be added.
    broker.setPositions([makePosition({
      contract: makeContract({ aliceId: 'mock-paper|BTC' }),
      quantity: new Decimal('1.000000001'),
      avgCost: '80000',
      marketPrice: '80000',
      avgCostSource: 'wallet',
    })])
    const before = uta.git.exportState().commits.length
    await uta.getPositions()
    const after = uta.git.exportState().commits.length
    expect(after).toBe(before)
  })

  it('skips positions without aliceId (defensive)', async () => {
    const broker = new MockBroker()
    const contract = makeContract()
    contract.aliceId = ''  // simulate broker that didn't stamp
    broker.setPositions([makePosition({
      contract,
      quantity: new Decimal('1'),
      avgCost: '50000',
      marketPrice: '60000',
      avgCostSource: 'wallet',
    })])
    const { uta } = createUTA(broker)
    // UTA's stampAliceId will fill it, but if broker emits without symbol/contract id we fall through cleanly.
    await expect(uta.getPositions()).resolves.toBeDefined()
  })
})

// ==================== Cold-start connecting gate ====================

describe('UTA — connecting gate (non-blocking cold start)', () => {
  it('reports connecting=true until the initial connect settles, then false', async () => {
    const { uta } = createUTA()
    expect(uta.getHealthInfo().connecting).toBe(true)
    await uta.waitForConnect()
    expect(uta.getHealthInfo().connecting).toBe(false)
  })

  it('a read during a SLOW connect fast-fails CONNECTING after the grace, without poisoning health', async () => {
    vi.useFakeTimers()
    try {
      const broker = new MockBroker()
      // Hang init() so the account is stuck in the connecting window — stands in
      // for CCXT loadMarkets taking tens of seconds.
      let release!: () => void
      ;(broker as unknown as { init: () => Promise<void> }).init = () =>
        new Promise<void>((resolve) => { release = resolve })

      const { uta } = createUTA(broker)
      expect(uta.getHealthInfo().connecting).toBe(true)

      // Attach the rejection expectation BEFORE advancing time, so the
      // rejection (which fires mid-advance) is never momentarily unhandled.
      const assertion = expect(uta.getAccount()).rejects.toThrow(/still connecting/)
      // Past the grace window — the read returns instead of blocking on init.
      await vi.advanceTimersByTimeAsync(2_000)
      await assertion

      // The gate threw BEFORE the broker call, so it never registered as a
      // failure: no counter bump, no premature recovery, account not disabled.
      const h = uta.getHealthInfo()
      expect(h.connecting).toBe(true)
      expect(h.consecutiveFailures).toBe(0)
      expect(h.recovering).toBe(false)
      expect(h.disabled).toBe(false)

      // Let the connect finish so timer/teardown is clean.
      release()
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
  })

  it('serves a read normally once an instant broker has connected (grace not consumed)', async () => {
    const { uta } = createUTA()
    await uta.waitForConnect()
    await expect(uta.getAccount()).resolves.toBeDefined()
  })
})
