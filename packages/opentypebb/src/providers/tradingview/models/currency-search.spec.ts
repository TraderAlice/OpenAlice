import { describe, expect, it } from 'vitest'
import { TradingViewCurrencySearchFetcher } from './currency-search.js'

describe('TradingViewCurrencySearchFetcher', () => {
  it('maps forex results to TradingView-qualified symbols', () => {
    const query = TradingViewCurrencySearchFetcher.transformQuery({ query: 'EURUSD' })
    const out = TradingViewCurrencySearchFetcher.transformData(query, [
      {
        symbol: 'EURUSD',
        description: 'Euro / U.S. Dollar',
        exchange: 'FX',
        source_id: 'FX',
        prefix: 'FX',
        provider_id: 'forex',
        type: 'forex',
      },
    ])

    expect(out).toEqual([
      {
        symbol: 'FX:EURUSD',
        name: 'Euro / U.S. Dollar',
        aliases: ['EURUSD'],
        exchange: 'FX',
        listed_exchange: 'FX',
        provider_id: 'forex',
        type: 'forex',
      },
    ])
  })
})
