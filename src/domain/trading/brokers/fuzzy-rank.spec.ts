import { describe, expect, it } from 'vitest'
import { Contract, type SecType } from '@traderalice/ibkr'
import { fuzzyRankContracts, type FuzzyRankInput } from './fuzzy-rank.js'

function entry(
  symbol: string,
  opts: { base?: string; quote?: string; name?: string; localSymbol?: string; secType?: SecType } = {},
): FuzzyRankInput {
  const c = new Contract()
  c.symbol = symbol
  c.localSymbol = opts.localSymbol ?? ''
  c.description = ''
  c.secType = opts.secType ?? 'STK'
  return { contract: c, base: opts.base, quote: opts.quote, name: opts.name }
}

const symbolsOf = (xs: ReturnType<typeof fuzzyRankContracts>): string[] => xs.map((x) => x.contract.symbol)

describe('fuzzyRankContracts', () => {
  it('returns nothing for empty query', () => {
    expect(fuzzyRankContracts([entry('AAPL')], '')).toEqual([])
  })

  it('drops entries with zero score', () => {
    const cat = [entry('AAPL', { name: 'Apple Inc.' }), entry('XYZ', { name: 'Nothing' })]
    expect(symbolsOf(fuzzyRankContracts(cat, 'apple'))).toEqual(['AAPL'])
  })

  it('exact symbol match outranks substring', () => {
    const cat = [
      entry('CORNING', { name: 'Corning Inc' }),
      entry('CORN', { name: 'Teucrium Commodity Trust' }),
    ]
    expect(symbolsOf(fuzzyRankContracts(cat, 'CORN'))).toEqual(['CORN', 'CORNING'])
  })

  it('exact base match outranks substring (CCXT-style)', () => {
    const cat = [
      entry('CORN', { base: 'CORN', quote: 'USDT', localSymbol: 'CORN/USDT' }),
      entry('POPCORN', { base: 'POPCORN', quote: 'USDT', localSymbol: 'POPCORN/USDT' }),
    ]
    expect(symbolsOf(fuzzyRankContracts(cat, 'corn'))).toEqual(['CORN', 'POPCORN'])
  })

  it('exact name match also lands at the top', () => {
    const cat = [entry('TLT', { name: 'iShares 20+ Year Treasury Bond ETF' }), entry('GLD', { name: 'Gold' })]
    expect(symbolsOf(fuzzyRankContracts(cat, 'gold'))).toEqual(['GLD'])
  })

  it('symbol prefix beats arbitrary substring', () => {
    const cat = [entry('AAPLW', { name: 'Apple Warrant' }), entry('SAAPL', { name: 'Some Apple Index' })]
    expect(symbolsOf(fuzzyRankContracts(cat, 'AAPL'))).toEqual(['AAPLW', 'SAAPL'])
  })

  it('name word-boundary match beats name substring', () => {
    const cat = [
      entry('GS', { name: 'Goldman Sachs Group' }),       // 'gold' substring inside 'Goldman' — no word boundary
      entry('GFI', { name: 'Gold Fields Ltd' }),          // word-boundary "Gold "
    ]
    expect(symbolsOf(fuzzyRankContracts(cat, 'gold'))).toEqual(['GFI', 'GS'])
  })

  it('escapes regex metacharacters in the query', () => {
    // BRK.B contains a dot; "B.B" should not be treated as a wildcard.
    const cat = [entry('BRK.B', { name: 'Berkshire Hathaway B' })]
    expect(symbolsOf(fuzzyRankContracts(cat, 'BRK.B'))).toEqual(['BRK.B'])
    // "B.B" pattern shouldn't match BBB-like rows via regex wildcard.
    expect(symbolsOf(fuzzyRankContracts([entry('BBB')], 'B.B'))).toEqual([])
  })

  it('respects limit', () => {
    const cat = Array.from({ length: 80 }, (_, i) => entry(`SYM${i}`, { name: `Test ${i}` }))
    expect(fuzzyRankContracts(cat, 'sym', { limit: 5 })).toHaveLength(5)
  })

  it('default limit is 50', () => {
    const cat = Array.from({ length: 80 }, (_, i) => entry(`SYM${i}`))
    expect(fuzzyRankContracts(cat, 'sym')).toHaveLength(50)
  })

  it('preserves upstream order on ties', () => {
    const cat = [entry('A1', { name: 'apple one' }), entry('A2', { name: 'apple two' }), entry('A3', { name: 'apple three' })]
    // All three score equally on "apple" name-startsWith — original order should win.
    expect(symbolsOf(fuzzyRankContracts(cat, 'apple'))).toEqual(['A1', 'A2', 'A3'])
  })

  it('quote-currency match is a low-priority fallback', () => {
    // "USDT" should rank pairs by other signals first; pure quote-only matches end up last.
    const cat = [
      entry('USDT-Reserve', { name: 'Tether reserve token', base: 'USDT', quote: 'USD' }), // exact base USDT
      entry('BTC', { base: 'BTC', quote: 'USDT', localSymbol: 'BTC/USDT' }),                // quote-only USDT
    ]
    expect(symbolsOf(fuzzyRankContracts(cat, 'USDT'))).toEqual(['USDT-Reserve', 'BTC'])
  })

  it('handles missing fields gracefully', () => {
    const c = new Contract()
    c.symbol = 'X'
    expect(fuzzyRankContracts([{ contract: c }], 'x')).toHaveLength(1)
    expect(fuzzyRankContracts([{ contract: c }], 'y')).toHaveLength(0)
  })
})
