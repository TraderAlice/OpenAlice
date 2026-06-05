// Real AAPL market data captured from Alice's market-data-v1 endpoints on
// 2026-05-29 (FMP provider via in-process opentypebb). Frozen as JSON
// fixtures — re-snapshot if a downstream contract change forces it.
//
// The capture process: `pnpm dev` → backend on 47331 → curl each
// /api/market-data-v1/<asset>/<query>?symbol=AAPL → write to .json.
import aaplProfile from './market/aapl-equity-profile.json'
import aaplQuote from './market/aapl-equity-price-quote.json'
import aaplHistorical from './market/aapl-equity-price-historical.json'
import aaplMetrics from './market/aapl-equity-fundamental-metrics.json'
import aaplRatios from './market/aapl-equity-fundamental-ratios.json'
import aaplBalance from './market/aapl-equity-fundamental-balance.json'
import aaplIncome from './market/aapl-equity-fundamental-income.json'
import aaplCash from './market/aapl-equity-fundamental-cash.json'
import aaplSearch from './market/aapl-search.json'
import sectorRotation from './market/sector-rotation-demo.json'

export const demoSectorRotation = sectorRotation

export const demoMarketAAPL = {
  profile: aaplProfile,
  quote: aaplQuote,
  historical: aaplHistorical,
  metrics: aaplMetrics,
  ratios: aaplRatios,
  balance: aaplBalance,
  income: aaplIncome,
  cash: aaplCash,
} as const

export const demoMarketSearchAAPL = aaplSearch

// Empty-shape fallback for any non-AAPL symbol. UI's panels handle
// `{ results: null, error }` by rendering an empty/error state.
export const demoMarketEmpty = {
  results: null,
  provider: 'demo',
  error: 'Demo mode — only AAPL data is snapshotted. Install OpenAlice locally to query other symbols.',
}
