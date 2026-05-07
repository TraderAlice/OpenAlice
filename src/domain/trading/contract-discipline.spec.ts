import { describe, it, expect } from 'vitest'
import { Contract } from '@traderalice/ibkr'
import {
  isSecType,
  validateContract,
  assertContract,
  SEC_TYPES,
} from './contract-discipline.js'

function makeContract(overrides: Partial<Contract> = {}): Contract {
  const c = new Contract()
  c.symbol = overrides.symbol ?? 'AAPL'
  c.secType = overrides.secType ?? 'STK'
  c.exchange = overrides.exchange ?? 'NASDAQ'
  c.currency = overrides.currency ?? 'USD'
  if (overrides.lastTradeDateOrContractMonth) c.lastTradeDateOrContractMonth = overrides.lastTradeDateOrContractMonth
  if (overrides.strike != null) c.strike = overrides.strike
  if (overrides.right) c.right = overrides.right
  if (overrides.multiplier) c.multiplier = overrides.multiplier
  if (overrides.localSymbol) c.localSymbol = overrides.localSymbol
  return c
}

describe('SecType taxonomy', () => {
  it('SEC_TYPES covers the documented set', () => {
    expect(SEC_TYPES).toEqual([
      // IBKR canonical taxonomy (mirrors TWS API)
      'STK', 'OPT', 'FUT', 'FOP', 'IND', 'CASH', 'BOND', 'CMDTY',
      'WAR', 'IOPT', 'FUND', 'BAG', 'NEWS', 'CFD', 'CRYPTO',
      // OpenAlice extension (only allowed deviation from IBKR)
      'CRYPTO_PERP',
    ])
  })

  it('isSecType narrows correctly', () => {
    expect(isSecType('STK')).toBe(true)
    expect(isSecType('OPT')).toBe(true)
    expect(isSecType('CRYPTO_PERP')).toBe(true)
    expect(isSecType('crypto')).toBe(false)  // case-sensitive
    expect(isSecType('FUTURES')).toBe(false)
    expect(isSecType('')).toBe(false)
    expect(isSecType(null)).toBe(false)
  })
})

describe('validateContract — universal fields', () => {
  it('ok for a complete STK contract', () => {
    const r = validateContract(makeContract())
    expect(r.ok).toBe(true)
  })

  it('rejects empty symbol', () => {
    const c = makeContract({ symbol: '' })
    const r = validateContract(c)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /symbol/.test(e))).toBe(true)
  })

  it('rejects unknown secType', () => {
    const c = makeContract()
    // Forced cast — TS would reject the literal at compile time (which is the
    // whole point of the SecType union). The test is verifying the runtime
    // validator catches the same shape if it were to slip through e.g. a JSON
    // load from an old commit.json.
    c.secType = 'BANANA' as unknown as typeof c.secType
    const r = validateContract(c)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /secType .* not a known SecType/.test(e))).toBe(true)
  })

  it('rejects empty exchange / currency', () => {
    const c = makeContract({ exchange: '' })
    const r = validateContract(c)
    expect(r.ok).toBe(false)
  })
})

describe('validateContract — OPT/FOP requirements', () => {
  it('OPT needs expiry + strike + right + multiplier', () => {
    const c = makeContract({ secType: 'OPT' })
    const r = validateContract(c)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some(e => /lastTradeDateOrContractMonth/.test(e))).toBe(true)
      expect(r.errors.some(e => /strike/.test(e))).toBe(true)
      expect(r.errors.some(e => /right/.test(e))).toBe(true)
      expect(r.errors.some(e => /multiplier/.test(e))).toBe(true)
    }
  })

  it('OPT with all four fields is valid', () => {
    const c = makeContract({
      secType: 'OPT', symbol: 'AAPL', exchange: 'CBOE',
      lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'C', multiplier: '100',
    })
    expect(validateContract(c).ok).toBe(true)
  })

  it('OPT with bad right value fails', () => {
    const c = makeContract({
      secType: 'OPT', symbol: 'AAPL', exchange: 'CBOE',
      lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'X', multiplier: '100',
    })
    const r = validateContract(c)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /right must be C\/P/.test(e))).toBe(true)
  })
})

describe('validateContract — FUT requirements', () => {
  it('FUT needs expiry + multiplier; not strike/right', () => {
    const incomplete = makeContract({ secType: 'FUT', symbol: 'ES', exchange: 'CME' })
    expect(validateContract(incomplete).ok).toBe(false)
    const ok = makeContract({
      secType: 'FUT', symbol: 'ES', exchange: 'CME',
      lastTradeDateOrContractMonth: '202606', multiplier: '50',
    })
    expect(validateContract(ok).ok).toBe(true)
  })
})

describe('validateContract — STK / CRYPTO need only universal', () => {
  it('STK passes without expiry/strike/right/multiplier', () => {
    expect(validateContract(makeContract({ secType: 'STK' })).ok).toBe(true)
  })

  it('CRYPTO passes without derivative fields', () => {
    const c = makeContract({ secType: 'CRYPTO', symbol: 'BTC', exchange: 'BYBIT', currency: 'USD' })
    expect(validateContract(c).ok).toBe(true)
  })

  it('CRYPTO_PERP passes', () => {
    const c = makeContract({ secType: 'CRYPTO_PERP', symbol: 'BTC', exchange: 'BYBIT', currency: 'USDT' })
    expect(validateContract(c).ok).toBe(true)
  })
})

describe('assertContract', () => {
  it('throws with all errors joined', () => {
    const c = makeContract({ secType: 'OPT', symbol: '' })
    expect(() => assertContract(c)).toThrow(/Invalid contract:.*symbol.*OPT requires/s)
  })

  it('returns silently on valid contract', () => {
    expect(() => assertContract(makeContract())).not.toThrow()
  })
})
