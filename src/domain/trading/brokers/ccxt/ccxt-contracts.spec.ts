/**
 * Tests for the CCXT-side contract translators.
 *
 * `marketToContract` writes CCXT's wire symbol (`market.symbol`) into
 * `Contract.localSymbol` directly — that string is CCXT's own uniqueness
 * primitive (encodes base/quote/settle) and feeds straight into
 * `getNativeKey` → aliceId. No normalization across brokers.
 */

import { describe, it, expect } from 'vitest'
import {
  marketToContract,
  contractToCcxt,
  ccxtTypeToSecType,
} from './ccxt-contracts.js'
import type { CcxtMarket } from './ccxt-types.js'

function makeMarket(overrides: Partial<CcxtMarket> & { type: CcxtMarket['type']; base: string; quote: string; symbol: string }): CcxtMarket {
  return {
    id: overrides.symbol,
    active: true,
    ...overrides,
  } as CcxtMarket
}

describe('marketToContract — preserves CCXT wire format', () => {
  it('spot Contract.localSymbol matches market.symbol', () => {
    const c = marketToContract(makeMarket({
      type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT',
    }), 'bybit')
    expect(c.symbol).toBe('BTC')
    expect(c.localSymbol).toBe('BTC/USDT')
    expect(c.secType).toBe('CRYPTO')
    expect(c.exchange).toBe('bybit')
    expect(c.currency).toBe('USDT')
  })

  it('perp Contract.localSymbol carries :settle suffix (USDT-margined)', () => {
    const c = marketToContract(makeMarket({
      type: 'swap', base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT:USDT', settle: 'USDT',
    }), 'bybit')
    expect(c.localSymbol).toBe('ETH/USDT:USDT')
    expect(c.secType).toBe('CRYPTO_PERP')
  })

  it('USDC-margined perp stays distinct from USDT-margined perp', () => {
    // Same underlying (ETH), different settle currency = different products
    // — wire format encodes this distinction; canonicalization would erase it.
    const usdt = marketToContract(makeMarket({
      type: 'swap', base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT:USDT', settle: 'USDT',
    }), 'bybit')
    const usdc = marketToContract(makeMarket({
      type: 'swap', base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC:USDC', settle: 'USDC',
    }), 'bybit')
    expect(usdt.localSymbol).not.toBe(usdc.localSymbol)
    expect(usdt.localSymbol).toBe('ETH/USDT:USDT')
    expect(usdc.localSymbol).toBe('ETH/USDC:USDC')
  })

  it('FUT carries expiry derived from market.expiry (ms epoch)', () => {
    const c = marketToContract(makeMarket({
      type: 'future', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT-220929',
      // 2022-09-29 UTC = 1664409600000
      expiry: 1664409600000,
      contractSize: 1,
    } as Partial<CcxtMarket> & { type: 'future'; base: string; quote: string; symbol: string }), 'bybit')
    expect(c.localSymbol).toBe('BTC/USDT:USDT-220929')
    expect(c.lastTradeDateOrContractMonth).toBe('20220929')
    expect(c.multiplier).toBe('1')
  })

  it('contracts pass assertContract — no missing universal fields', () => {
    expect(() => marketToContract(makeMarket({
      type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT',
    }), 'bybit')).not.toThrow()
  })
})

describe('contractToCcxt — wire-format Contract resolves directly via markets table', () => {
  const markets: Record<string, CcxtMarket> = {
    'BTC/USDT': makeMarket({ type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT' }),
    'BTC/USDT:USDT': makeMarket({ type: 'swap', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT', settle: 'USDT' }),
    'ETH/USDT': makeMarket({ type: 'spot', base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT' }),
  }

  it('spot Contract.localSymbol === market.symbol → direct hit', () => {
    const c = marketToContract(markets['BTC/USDT'], 'bybit')
    expect(contractToCcxt(c, markets, 'bybit')).toBe('BTC/USDT')
  })

  it('perp Contract.localSymbol === wire format → direct hit', () => {
    const c = marketToContract(markets['BTC/USDT:USDT'], 'bybit')
    expect(contractToCcxt(c, markets, 'bybit')).toBe('BTC/USDT:USDT')
  })

  it('user-supplied Contract with no localSymbol falls back to base+secType+currency search', () => {
    // Some callers construct Contract from scratch (symbol only). The
    // resolveContractSync fallback handles this path.
    const c = marketToContract(markets['BTC/USDT'], 'bybit')
    c.localSymbol = ''  // simulate user-constructed contract
    expect(contractToCcxt(c, markets, 'bybit')).toBe('BTC/USDT')
  })
})

describe('ccxtTypeToSecType (sanity)', () => {
  it('spot/swap/future/option', () => {
    expect(ccxtTypeToSecType('spot')).toBe('CRYPTO')
    expect(ccxtTypeToSecType('swap')).toBe('CRYPTO_PERP')
    expect(ccxtTypeToSecType('future')).toBe('FUT')
    expect(ccxtTypeToSecType('option')).toBe('OPT')
  })
})
