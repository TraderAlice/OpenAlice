import { describe, it, expect } from 'vitest'
import { contractPrimary, contractSecondary, contractSecondaryParts } from './contract-display'

describe('contractSecondaryParts — name/meta split for tiered styling (#340)', () => {
  it('splits the long-name from the coded metadata for an equity', () => {
    expect(contractSecondaryParts({
      symbol: 'AAPL', secType: 'STK', exchange: 'SMART',
      primaryExchange: 'NASDAQ', description: 'Apple Inc', currency: 'USD',
    })).toEqual({ name: 'Apple Inc', meta: 'STK · NASDAQ · USD' })
  })

  it('has no name for crypto (meta only)', () => {
    expect(contractSecondaryParts({
      symbol: 'BTC', secType: 'CRYPTO_PERP', exchange: 'binance', description: 'BTC/USDT swap', currency: 'USD',
    })).toEqual({ name: undefined, meta: 'CRYPTO_PERP · binance · USD' })
  })
})

describe('contractSecondary — long-name + primary exchange (#340)', () => {
  it('leads with the long-name and uses primaryExchange for an equity', () => {
    expect(contractSecondary({
      symbol: 'AAPL', secType: 'STK', exchange: 'SMART',
      primaryExchange: 'NASDAQ', description: 'Apple Inc', currency: 'USD',
    })).toBe('Apple Inc · STK · NASDAQ · USD')
  })

  it('falls back to symbol-only display when no long-name/primaryExchange', () => {
    // Pre-#340 behaviour preserved.
    expect(contractSecondary({ symbol: 'AAPL', secType: 'STK', exchange: 'SMART', currency: 'USD' }))
      .toBe('STK · SMART · USD')
  })

  it('treats empty-string wire values as absent (no blank segments)', () => {
    expect(contractSecondary({
      symbol: 'AAPL', secType: 'STK', exchange: 'SMART',
      primaryExchange: '', description: '', currency: 'USD',
    })).toBe('STK · SMART · USD')
  })

  it('suppresses the redundant pair description for crypto', () => {
    // CCXT sets description to the pair ("BTC/USDT spot") — redundant with the
    // primary line, so it must NOT appear on the secondary line.
    expect(contractSecondary({
      symbol: 'BTC', secType: 'CRYPTO_PERP', exchange: 'binance',
      description: 'BTC/USDT swap (USDT settled)', currency: 'USD',
    })).toBe('CRYPTO_PERP · binance · USD')
  })

  it('keeps the option multiplier and prefers primaryExchange', () => {
    expect(contractSecondary({
      symbol: 'AAPL', secType: 'OPT', exchange: 'SMART', primaryExchange: 'CBOE',
      description: 'APPLE INC', currency: 'USD', multiplier: 100,
    })).toBe('APPLE INC · OPT · CBOE · USD · ×100')
  })
})

describe('contractPrimary — unchanged by #340', () => {
  it('still renders a bare equity symbol', () => {
    expect(contractPrimary({ symbol: 'AAPL', secType: 'STK', description: 'Apple Inc' })).toBe('AAPL')
  })
  it('still suffixes PERP for crypto perps', () => {
    expect(contractPrimary({ symbol: 'BTC', localSymbol: 'BTC/USDT:USDT', secType: 'CRYPTO_PERP' })).toBe('BTC/USDT:USDT PERP')
  })
})
