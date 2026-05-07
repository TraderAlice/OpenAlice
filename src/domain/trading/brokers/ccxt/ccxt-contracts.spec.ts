/**
 * Tests for the CCXT-side contract translators.
 *
 * Phase 3 of the IBKR-as-truth refactor moved canonical localSymbol
 * generation here — these tests pin the per-secType formats so we don't
 * regress to dumping CCXT's wire format ("BTC/USDT:USDT") onto Contract.
 */

import { describe, it, expect } from 'vitest'
import {
  canonicalLocalSymbol,
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

describe('canonicalLocalSymbol', () => {
  it('spot → base only', () => {
    expect(canonicalLocalSymbol(makeMarket({
      type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT',
    }))).toBe('BTC')
  })

  it('swap → base-PERP (no settle suffix, no quote)', () => {
    expect(canonicalLocalSymbol(makeMarket({
      type: 'swap', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT', settle: 'USDT',
    }))).toBe('BTC-PERP')
  })

  it('dated future → base-FUT-YYYYMM from market.expiry epoch', () => {
    expect(canonicalLocalSymbol(makeMarket({
      type: 'future', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT-220929',
      // 2022-09-29 UTC = 1664409600000
      expiry: 1664409600000,
    } as Partial<CcxtMarket> & { type: 'future'; base: string; quote: string; symbol: string }))).toBe('BTC-FUT-202209')
  })

  it('dated future without epoch — falls back to symbol tail', () => {
    expect(canonicalLocalSymbol(makeMarket({
      type: 'future', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT-220929',
    }))).toBe('BTC-FUT-220929')
  })

  it('option preserves wire format (out of scope for Phase 3)', () => {
    expect(canonicalLocalSymbol(makeMarket({
      type: 'option', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT-240920-50000-C',
    }))).toBe('BTC/USDT:USDT-240920-50000-C')
  })
})

describe('marketToContract — emits canonical Contract', () => {
  it('spot Contract has canonical localSymbol', () => {
    const c = marketToContract(makeMarket({
      type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT',
    }), 'bybit')
    expect(c.symbol).toBe('BTC')
    expect(c.localSymbol).toBe('BTC')
    expect(c.secType).toBe('CRYPTO')
    expect(c.exchange).toBe('bybit')
    expect(c.currency).toBe('USDT')
  })

  it('perp Contract gets canonical -PERP suffix', () => {
    const c = marketToContract(makeMarket({
      type: 'swap', base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT:USDT', settle: 'USDT',
    }), 'bybit')
    expect(c.localSymbol).toBe('ETH-PERP')
    expect(c.secType).toBe('CRYPTO_PERP')
  })

  it('contracts pass assertContract — no missing universal fields', () => {
    expect(() => marketToContract(makeMarket({
      type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT',
    }), 'bybit')).not.toThrow()
  })
})

describe('contractToCcxt — canonical → wire format derivation', () => {
  const markets: Record<string, CcxtMarket> = {
    'BTC/USDT': makeMarket({ type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT' }),
    'BTC/USDT:USDT': makeMarket({ type: 'swap', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT:USDT', settle: 'USDT' }),
    'ETH/USDT': makeMarket({ type: 'spot', base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT' }),
  }

  it('canonical spot Contract resolves to spot wire symbol via base+secType+currency search', () => {
    const c = marketToContract(markets['BTC/USDT'], 'bybit')
    // c.localSymbol = 'BTC', not 'BTC/USDT' — direct lookup misses, falls
    // back to resolveContractSync which finds the spot market.
    expect(contractToCcxt(c, markets, 'bybit')).toBe('BTC/USDT')
  })

  it('canonical perp Contract resolves to perp wire symbol', () => {
    const c = marketToContract(markets['BTC/USDT:USDT'], 'bybit')
    expect(contractToCcxt(c, markets, 'bybit')).toBe('BTC/USDT:USDT')
  })

  it('legacy wire-format localSymbol still resolves (back-compat for user-supplied contracts)', () => {
    // User constructs Contract with wire-format localSymbol — direct hit.
    const c = makeMarket({ type: 'spot', base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT' })
    const wireContract = marketToContract(c, 'bybit')
    wireContract.localSymbol = 'BTC/USDT'  // simulate legacy
    expect(contractToCcxt(wireContract, markets, 'bybit')).toBe('BTC/USDT')
  })
})

describe('ccxtTypeToSecType (already covered, sanity)', () => {
  it('spot/swap/future/option', () => {
    expect(ccxtTypeToSecType('spot')).toBe('CRYPTO')
    expect(ccxtTypeToSecType('swap')).toBe('CRYPTO_PERP')
    expect(ccxtTypeToSecType('future')).toBe('FUT')
    expect(ccxtTypeToSecType('option')).toBe('OPT')
  })
})
