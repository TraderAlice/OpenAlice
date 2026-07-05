import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  val, money, price,
  compactContract, compactOrderFields, compactOperation,
  compactResult, compactStatus, compactAccountInfo,
} from './trading-compact.js'

describe('val — sentinel normalization', () => {
  it('drops every IBKR unset sentinel in every value form', () => {
    expect(val(1.7976931348623157e+308)).toBeUndefined()        // UNSET_DOUBLE number
    expect(val('1.7976931348623157e+308')).toBeUndefined()      // …as string
    expect(val(2147483647)).toBeUndefined()                     // UNSET_INTEGER
    expect(val('1.70141183460469231731687303715884105727e+38')).toBeUndefined() // UNSET_DECIMAL string
    expect(val(new Decimal('1.70141183460469231731687303715884105727e+38'))).toBeUndefined()
    expect(val('')).toBeUndefined()
    expect(val(null)).toBeUndefined()
    expect(val(undefined)).toBeUndefined()
  })

  it('keeps real values, including awkward ones', () => {
    expect(val('0.01')).toBe('0.01')
    expect(val(0)).toBe('0')
    expect(val(new Decimal('0.00000001'))).toBe('0.00000001')
    expect(val('DAY')).toBe('DAY')
  })
})

describe('money / price — display precision', () => {
  it('caps money at 2dp and price at 8dp without mangling', () => {
    expect(money('90273.826752780986')).toBe('90273.83')
    expect(money('150.48841053856901168')).toBe('150.49')
    expect(price('2165.8896354239932')).toBe('2165.88963542')
    expect(price('0.00000001')).toBe('0.00000001')
  })
})

describe('compactContract', () => {
  it('keeps instrument identity, drops sentinels/empties, normalizes right', () => {
    const c = compactContract({
      conId: 0, symbol: 'AAPL', secType: 'OPT', lastTradeDateOrContractMonth: '20260717',
      lastTradeDate: '', strike: 300, right: 'CALL', multiplier: '100', exchange: 'SMART',
      primaryExchange: '', currency: 'USD', localSymbol: 'AAPL 260717C00300000',
      tradingClass: '', includeExpired: false, secIdType: '', comboLegs: [],
      deltaNeutralContract: null, aliceId: 'ibkr|x',
    })
    expect(c).toEqual({
      aliceId: 'ibkr|x', symbol: 'AAPL', localSymbol: 'AAPL 260717C00300000',
      secType: 'OPT', currency: 'USD', exchange: 'SMART',
      expiry: '20260717', strike: '300', right: 'C', multiplier: '100',
    })
  })

  it('omits multiplier when it is 1 (canonical, carries no signal)', () => {
    expect(compactContract({ symbol: 'ETH', multiplier: '1' })).toEqual({ symbol: 'ETH' })
  })
})

describe('compactOrderFields', () => {
  it('reduces the ~120-field Order to its set fields', () => {
    const o = compactOrderFields({
      action: 'BUY', orderType: 'LMT', totalQuantity: '0.01', lmtPrice: '1200',
      auxPrice: '1.70141183460469231731687303715884105727e+38',
      trailingPercent: '1.70141183460469231731687303715884105727e+38',
      minQty: 2147483647, percentOffset: 1.7976931348623157e+308,
      tif: 'DAY', outsideRth: false, softDollarTier: { name: '' },
      filledQuantity: '1.70141183460469231731687303715884105727e+38',
    })
    expect(o).toEqual({ action: 'BUY', orderType: 'LMT', totalQuantity: '0.01', lmtPrice: '1200', tif: 'DAY' })
  })
})

describe('compactOperation / compactStatus / compactResult', () => {
  it('placeOrder operation has no sentinel anywhere in its JSON', () => {
    const op = compactOperation({
      action: 'placeOrder',
      contract: { symbol: 'ETH', strike: 1.7976931348623157e+308, conId: 0 },
      order: { action: 'BUY', totalQuantity: '0.01', minQty: 2147483647 },
    })
    const json = JSON.stringify(op)
    expect(json).not.toMatch(/1\.797693|1\.7014118|2147483647/)
    expect(op).toEqual({ action: 'placeOrder', contract: { symbol: 'ETH' }, order: { action: 'BUY', totalQuantity: '0.01' } })
  })

  it('compactResult drops raw + orderState but keeps the reject reason', () => {
    const r = compactResult({
      action: 'placeOrder', success: false, status: 'rejected', error: 'price band',
      raw: { huge: 'payload' },
      orderState: { status: 'Inactive', rejectReason: 'okx 51138', commissionAndFees: 1.7976931348623157e+308 },
    })
    expect(r).toEqual({ action: 'placeOrder', success: false, status: 'rejected', error: 'price band', rejectReason: 'okx 51138' })
  })

  it('compactResult surfaces bracket leg ids (agent confirmation that protective legs exist)', () => {
    const r = compactResult({
      action: 'placeOrder', success: true, status: 'submitted', orderId: 'parent-1',
      legs: [{ orderId: 'tp-1', kind: 'takeProfit' }, { orderId: 'sl-1', kind: 'stopLoss' }],
      raw: { huge: 'payload' },
    })
    expect(r['legs']).toEqual([
      { orderId: 'tp-1', kind: 'takeProfit' },
      { orderId: 'sl-1', kind: 'stopLoss' },
    ])
    expect('raw' in r).toBe(false)
  })

  it('compactStatus compacts staged ops and renames pending→awaitingApproval', () => {
    const idle = compactStatus({
      staged: [{ action: 'cancelOrder', orderId: 'o1' }],
      pendingMessage: null, pendingHash: null, head: 'abc', commitCount: 5,
    })
    expect(idle).toEqual({ staged: [{ action: 'cancelOrder', orderId: 'o1' }], awaitingApproval: null, head: 'abc', commitCount: 5 })

    const committed = compactStatus({
      staged: [], pendingMessage: 'long ETH', pendingHash: 'h1', head: 'abc', commitCount: 5,
    })
    expect(committed.awaitingApproval).toEqual({ message: 'long ETH', hash: 'h1' })
  })
})

describe('compactAccountInfo', () => {
  it('rounds money to 2dp and omits unreported fields (never fabricates zeros)', () => {
    const a = compactAccountInfo({
      baseCurrency: 'USD', netLiquidation: '90273.826752780986',
      totalCashValue: '81351.50743564543', unrealizedPnL: '150.48841053856901168',
      realizedPnL: '-0.3654613868044494', initMarginReq: '1.11583333333',
    })
    expect(a).toEqual({
      baseCurrency: 'USD', netLiquidation: '90273.83', totalCashValue: '81351.51',
      unrealizedPnL: '150.49', realizedPnL: '-0.37', initMarginReq: '1.12',
    })
    expect('buyingPower' in a).toBe(false)
  })
})
