import { describe, expect, it } from 'vitest'

import type { BarSourceCandidate } from '../../api/market'
import { normalizeAssetSearchCandidates } from './useAssetSearch'

function candidate(barId: string, symbol: string): BarSourceCandidate {
  return {
    barId,
    source: barId.startsWith('yfinance|') ? 'vendor' : 'uta',
    sourceId: barId.split('|')[0] ?? '',
    symbol,
    assetClass: 'equity',
    label: symbol,
  }
}

describe('normalizeAssetSearchCandidates', () => {
  it('removes blank and duplicate operational identities before applying the limit', () => {
    expect(normalizeAssetSearchCandidates([
      candidate('ibkr|-1', ''),
      candidate('yfinance|AAPL', 'AAPL'),
      candidate('yfinance|AAPL', 'AAPL duplicate'),
      candidate('', 'MSFT'),
      candidate('yfinance|MSFT', 'MSFT'),
      candidate('yfinance|TSLA', 'TSLA'),
    ], 2).map((row) => row.barId)).toEqual([
      'yfinance|AAPL',
      'yfinance|MSFT',
    ])
  })
})
