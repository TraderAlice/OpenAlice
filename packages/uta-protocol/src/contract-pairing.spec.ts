import { describe, expect, it } from 'vitest'

import { computeVenueSpread, pairingKeyOf, pairingKindOf, usablePrice } from './contract-pairing.js'

describe('pairingKeyOf', () => {
  it('maps each tradeable product class onto its own kind', () => {
    expect(pairingKindOf('CRYPTO')).toBe('SPOT')
    expect(pairingKindOf('CRYPTO_PERP')).toBe('PERP')
    expect(pairingKindOf('FUT')).toBe('FUTURE')
    expect(pairingKindOf('OPT')).toBe('OPTION')
    expect(pairingKindOf('FOP')).toBe('OPTION')
  })

  it('builds SYMBOL|CURRENCY|KIND, upper-cased', () => {
    expect(pairingKeyOf({ symbol: 'btc', currency: 'usdt', secType: 'CRYPTO' })).toBe('BTC|USDT|SPOT')
  })

  it('never pairs a spot with a perpetual on the same symbol and currency', () => {
    const spot = pairingKeyOf({ symbol: 'BTC', currency: 'USDT', secType: 'CRYPTO' })
    const perp = pairingKeyOf({ symbol: 'BTC', currency: 'USDT', secType: 'CRYPTO_PERP' })

    expect(perp).not.toBe(spot)
    expect(perp).toBe('BTC|USDT|PERP')
  })

  it('never pairs a future with an option on the same symbol', () => {
    expect(pairingKeyOf({ symbol: 'ES', currency: 'USD', secType: 'FUT' }))
      .not.toBe(pairingKeyOf({ symbol: 'ES', currency: 'USD', secType: 'OPT' }))
  })

  it('keeps unknown secTypes in their own bucket instead of a shared default', () => {
    expect(pairingKeyOf({ symbol: 'AAPL', currency: 'USD', secType: 'STK' })).toBe('AAPL|USD|OTHER:STK')
    expect(pairingKeyOf({ symbol: 'AAPL', currency: 'USD', secType: 'BOND' }))
      .not.toBe(pairingKeyOf({ symbol: 'AAPL', currency: 'USD', secType: 'WARRANT' }))
    // An absent secType is its own unknown, not a wildcard that pairs with STK.
    expect(pairingKeyOf({ symbol: 'AAPL', currency: 'USD' })).not.toBe('AAPL|USD|OTHER:STK')
  })

  it('separates the same symbol on different quote currencies', () => {
    expect(pairingKeyOf({ symbol: 'BTC', currency: 'USDT', secType: 'CRYPTO' }))
      .not.toBe(pairingKeyOf({ symbol: 'BTC', currency: 'USD', secType: 'CRYPTO' }))
  })
})

describe('usablePrice', () => {
  it('keeps a tradeable price and returns the venue’s own text', () => {
    expect(usablePrice('80000.010')).toBe('80000.010')
  })

  it('treats a missing side, 0, negatives, and junk as no quote', () => {
    // `"0"` is what CCXT-backed venues write for a missing side
    // (`String(ticker.bid ?? 0)`) — it is not a price.
    expect(usablePrice('0')).toBeNull()
    expect(usablePrice('0.0')).toBeNull()
    expect(usablePrice('-1')).toBeNull()
    expect(usablePrice('')).toBeNull()
    expect(usablePrice('abc')).toBeNull()
    expect(usablePrice('NaN')).toBeNull()
    expect(usablePrice('Infinity')).toBeNull()
    expect(usablePrice(null)).toBeNull()
    expect(usablePrice(undefined)).toBeNull()
  })
})

describe('computeVenueSpread', () => {
  // Two venues quoting the same instrument 100 apart, ±0.01 either side.
  const legA = { source: 'venue-a', bid: '79999.99', ask: '80000.01' }
  const legB = { source: 'venue-b', bid: '80099.99', ask: '80100.01' }

  it('buys on the lowest ask and sells on the highest bid across venues', () => {
    const { executableSpread } = computeVenueSpread([legA, legB])

    expect(executableSpread).toEqual({
      buyOn: 'venue-a',
      sellOn: 'venue-b',
      buyAt: '80000.01',
      sellAt: '80099.99',
      abs: '99.98',
      // 99.98 / ((80099.99 + 80000.01) / 2) × 10000 = 99.98 / 80050 × 10000
      bps: '12.4897',
    })
  })

  it('compares mids for the mid spread', () => {
    const { midSpread } = computeVenueSpread([legA, legB])

    expect(midSpread).toEqual({
      lowAt: 'venue-a',
      highAt: 'venue-b',
      abs: '100',
      // 100 / 80050 × 10000
      bps: '12.4922',
    })
  })

  it('reports the exact decimal difference, not a float approximation', () => {
    const { executableSpread } = computeVenueSpread([
      { source: 'a', bid: '0.3', ask: '0.3000000001' },
      { source: 'b', bid: '0.1', ask: '0.1000000001' },
    ])

    // Float arithmetic would give 0.19999999990000002 here.
    expect(executableSpread?.abs).toBe('0.1999999999')
  })

  it('reports nothing when a single venue quotes both sides', () => {
    expect(computeVenueSpread([legA])).toEqual({ executableSpread: null, midSpread: null })
  })

  it('reports nothing when two-sided quotes all come from one venue', () => {
    // Same venue listed twice: a venue cannot trade with itself.
    const { executableSpread, midSpread } = computeVenueSpread([legA, { ...legA }])

    expect(executableSpread).toBeNull()
    expect(midSpread).toBeNull()
  })

  it('excludes a venue with no two-sided quote instead of pricing it at 0', () => {
    // CCXT-backed venues report a market with no bid/ask as the strings "0".
    // Priced at 0, the silent venue would become the cheapest place to buy.
    const silent = { source: 'silent', bid: '0', ask: '0' }
    const { executableSpread, midSpread } = computeVenueSpread([silent, legA, legB])

    expect(executableSpread).toEqual({
      buyOn: 'venue-a',
      sellOn: 'venue-b',
      buyAt: '80000.01',
      sellAt: '80099.99',
      abs: '99.98',
      bps: '12.4897',
    })
    expect(midSpread?.lowAt).toBe('venue-a')
    expect(midSpread?.highAt).toBe('venue-b')
  })

  it('never manufactures a spread out of a 0-priced venue and one real venue', () => {
    const { executableSpread, midSpread } = computeVenueSpread([
      { source: 'silent', bid: '0', ask: '0' },
      legA,
    ])

    expect(executableSpread).toBeNull()
    expect(midSpread).toBeNull()
  })

  it('ignores a one-sided venue even when its lone side is the best price', () => {
    // `bid-only` has by far the highest bid, but without an ask it is not a
    // tradeable leg and must not become the sell venue.
    const { executableSpread } = computeVenueSpread([
      { source: 'bid-only', bid: '90000', ask: null },
      legA,
      legB,
    ])

    expect(executableSpread?.sellOn).toBe('venue-b')
    expect(executableSpread?.abs).toBe('99.98')
  })

  it('reports nothing when only one venue quotes both sides', () => {
    const { executableSpread, midSpread } = computeVenueSpread([
      { source: 'bid-only', bid: '90000', ask: null },
      { source: 'ask-only', bid: null, ask: '70000' },
      legA,
    ])

    expect(executableSpread).toBeNull()
    expect(midSpread).toBeNull()
  })

  it('reports a negative cross rather than a zero one when no venue crosses', () => {
    // Every venue’s bid sits below every other venue’s ask: the honest answer
    // is the best (still negative) cross-venue difference.
    const { executableSpread } = computeVenueSpread([
      { source: 'a', bid: '99.00', ask: '100.00' },
      { source: 'b', bid: '98.00', ask: '102.00' },
    ])

    expect(executableSpread).toEqual({
      buyOn: 'a',
      sellOn: 'b',
      buyAt: '100.00',
      sellAt: '98.00',
      abs: '-2',
      // −2 / ((98.00 + 100.00) / 2) × 10000 = −2 / 99 × 10000
      bps: '-202.0202',
    })
  })

  it('still finds the remaining cross when the best bid and best ask are one venue', () => {
    // `tight` has the tightest book (best bid AND best ask). Buying and selling
    // on `tight` is not tradeable, but buying on `wide` and selling on `tight`
    // is, so the read must not collapse to "no spread".
    const { executableSpread } = computeVenueSpread([
      { source: 'tight', bid: '100.05', ask: '100.06' },
      { source: 'wide', bid: '99.00', ask: '100.50' },
    ])

    expect(executableSpread).toEqual({
      buyOn: 'wide',
      sellOn: 'tight',
      buyAt: '100.50',
      sellAt: '100.05',
      abs: '-0.45',
      // −0.45 / ((100.05 + 100.50) / 2) × 10000 = −0.45 / 100.275 × 10000
      bps: '-44.8766',
    })
  })
})
