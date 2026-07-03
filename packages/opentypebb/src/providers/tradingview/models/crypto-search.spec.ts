import { describe, expect, it } from 'vitest'
import { TradingViewCryptoSearchFetcher } from './crypto-search.js'

describe('TradingViewCryptoSearchFetcher', () => {
  it('maps crypto results to TradingView-qualified symbols', () => {
    const query = TradingViewCryptoSearchFetcher.transformQuery({ query: 'BTC' })
    const out = TradingViewCryptoSearchFetcher.transformData(query, [
      {
        symbol: 'BTCUSDT',
        description: 'Bitcoin / TetherUS',
        exchange: 'BINANCE',
        source_id: 'BINANCE',
        prefix: 'BINANCE',
        provider_id: 'crypto',
        type: 'spot',
      },
    ])

    expect(out).toEqual([
      {
        symbol: 'BINANCE:BTCUSDT',
        name: 'Bitcoin / TetherUS',
        aliases: ['BTCUSDT'],
        exchange: 'BINANCE',
        listed_exchange: 'BINANCE',
        provider_id: 'crypto',
        type: 'spot',
      },
    ])
  })
})
