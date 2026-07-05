import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract } from '@traderalice/ibkr'
import { RequestBridge } from './request-bridge.js'

function stk(conId: number, symbol: string): Contract {
  const c = new Contract()
  c.conId = conId
  c.symbol = symbol
  c.secType = 'STK'
  c.currency = 'USD'
  return c
}

function pushUpdate(b: RequestBridge, contract: Contract, qty: number, avgCost = '100'): void {
  b.updatePortfolio(contract, new Decimal(qty), '101', String(qty * 101), avgCost, '1', '0', 'DU1')
}

describe('RequestBridge — error routing', () => {
  it('routes 10xxx errors into the pending request (no silent timeout)', async () => {
    // Regression: `errorCode >= 2000` swallowed 10089 (market data needs
    // subscription) — the snapshot promise timed out with zero context
    // instead of carrying the venue's actionable message.
    const b = new RequestBridge()
    const promise = b.requestSnapshot(9001, 5000)
    b.error(9001, 0, 10089, 'Requested market data requires additional subscription for API.')
    await expect(promise).rejects.toThrow(/subscription/)
  })

  it('still ignores 21xx farm-status noise', () => {
    const b = new RequestBridge()
    // no pending request — must simply not throw
    expect(() => b.error(-1, 0, 2104, 'Market data farm connection is OK')).not.toThrow()
  })
})

/**
 * TWS account-subscription semantics: full download bursts end with
 * accountDownloadEnd; between bursts TWS pushes DELTAS with no end marker
 * (a fill updates one position immediately; the next full download can be
 * ~3 minutes away). The cache used to apply deltas only at the next swap —
 * the ledger said filled while the portfolio surface showed the old
 * quantity for minutes (found live, IBKR round, S8).
 */
describe('RequestBridge — account cache delta semantics', () => {
  function readyBridge(): RequestBridge {
    const b = new RequestBridge()
    ;(b as unknown as { accountCachePending_: unknown }).accountCachePending_ = { positions: [], values: new Map() }
    pushUpdate(b, stk(1, 'AAPL'), 10)
    pushUpdate(b, stk(2, 'TSLA'), 5)
    b.updateAccountValue('TotalCashValue', '1000', 'USD', 'DU1')
    b.accountDownloadEnd('DU1')
    return b
  }

  it('applies a delta update to the live cache immediately (no downloadEnd needed)', () => {
    const b = readyBridge()
    pushUpdate(b, stk(1, 'AAPL'), 9)

    const cache = b.getAccountCache()!
    const aapl = cache.positions.find((p) => p.contract.conId === 1)!
    expect(aapl.quantity.toNumber()).toBe(9)
    expect(cache.positions).toHaveLength(2)
  })

  it('removes a fully-closed position (zero quantity) immediately', () => {
    const b = readyBridge()
    pushUpdate(b, stk(2, 'TSLA'), 0)

    const cache = b.getAccountCache()!
    expect(cache.positions.map((p) => p.contract.conId)).toEqual([1])
  })

  it('applies account-value deltas to the live cache immediately', () => {
    const b = readyBridge()
    b.updateAccountValue('TotalCashValue', '900', 'USD', 'DU1')
    expect(b.getAccountCache()!.values.get('TotalCashValue')).toBe('900')
  })

  it('repeated updates within one batch window do not duplicate rows', () => {
    const b = readyBridge()
    // price-tick churn: same position updated 3x before the next downloadEnd
    pushUpdate(b, stk(1, 'AAPL'), 9)
    pushUpdate(b, stk(1, 'AAPL'), 9)
    pushUpdate(b, stk(2, 'TSLA'), 5)
    b.accountDownloadEnd('DU1')

    const cache = b.getAccountCache()!
    expect(cache.positions).toHaveLength(2)
    expect(cache.positions.find((p) => p.contract.conId === 1)!.quantity.toNumber()).toBe(9)
  })

  it('full-download swap does not resurrect a position closed mid-window', () => {
    const b = readyBridge()
    pushUpdate(b, stk(2, 'TSLA'), 0)        // closed via delta
    pushUpdate(b, stk(1, 'AAPL'), 10)       // next full burst: only AAPL remains
    b.accountDownloadEnd('DU1')

    expect(b.getAccountCache()!.positions.map((p) => p.contract.conId)).toEqual([1])
  })
})

describe('RequestBridge — currency-aware account values (issue #295)', () => {
  function readyBridge(): RequestBridge {
    const b = new RequestBridge()
    ;(b as unknown as { accountCachePending_: unknown }).accountCachePending_ = { positions: [], values: new Map() }
    b.accountDownloadEnd('DU1')
    return b
  }

  it('BASE wins the plain key regardless of arrival order', () => {
    const b = readyBridge()
    b.updateAccountValue('CashBalance', '1036370', 'BASE', 'DU1')
    b.updateAccountValue('CashBalance', '-51005', 'HKD', 'DU1')   // arrives after BASE
    const v = b.getAccountCache()!.values
    expect(v.get('CashBalance')).toBe('1036370')                   // not clobbered
    expect(v.get('CashBalance:HKD')).toBe('-51005')
    expect(v.get('CashBalance:BASE')).toBe('1036370')
  })

  it('BASE arriving late still reclaims the plain key', () => {
    const b = readyBridge()
    b.updateAccountValue('CashBalance', '-51005', 'HKD', 'DU1')    // HKD first
    const v = b.getAccountCache()!.values
    expect(v.get('CashBalance')).toBe('-51005')                    // provisional
    b.updateAccountValue('CashBalance', '1036370', 'BASE', 'DU1')
    expect(v.get('CashBalance')).toBe('1036370')                   // corrected
  })

  it('single-send tags (one currency line, no BASE) keep the plain key', () => {
    const b = readyBridge()
    b.updateAccountValue('NetLiquidation', '1046101.70', 'USD', 'DU1')
    expect(b.getAccountCache()!.values.get('NetLiquidation')).toBe('1046101.70')
    expect(b.getAccountCache()!.values.get('ExchangeRate:USD')).toBeUndefined()
  })
})
