import { http, HttpResponse } from 'msw'
import {
  demoMarketAAPL,
  demoMarketSearchAAPL,
  demoMarketEmpty,
  demoSectorRotation,
} from '../fixtures/market'

const AAPL = 'AAPL'

function symbolFromUrl(url: string): string {
  return (new URL(url).searchParams.get('symbol') ?? '').toUpperCase()
}

function aaplOnly(payload: object): (req: { request: Request }) => Response {
  return ({ request }) => {
    if (symbolFromUrl(request.url) === AAPL) return HttpResponse.json(payload)
    return HttpResponse.json(demoMarketEmpty)
  }
}

export const marketHandlers = [
  // Search — AAPL / Apple matches the snapshot; anything else returns empty.
  http.get('/api/market/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('query') ?? '').toLowerCase()
    if (q === 'aapl' || q === 'apple' || (q.length > 0 && 'apple inc.'.startsWith(q))) {
      return HttpResponse.json(demoMarketSearchAAPL)
    }
    return HttpResponse.json({ results: [], count: 0 })
  }),

  // Sector rotation — static snapshot fixture.
  http.get('/api/market/sector-rotation', () => HttpResponse.json(demoSectorRotation)),

  // ---- equity data ----
  http.get('/api/market-data-v1/:assetClass/price/historical', ({ request, params }) => {
    if (params.assetClass !== 'equity' || symbolFromUrl(request.url) !== AAPL) {
      return HttpResponse.json(demoMarketEmpty)
    }
    return HttpResponse.json(demoMarketAAPL.historical)
  }),
  http.get('/api/market-data-v1/equity/profile', aaplOnly(demoMarketAAPL.profile)),
  http.get('/api/market-data-v1/equity/price/quote', aaplOnly(demoMarketAAPL.quote)),
  http.get('/api/market-data-v1/equity/fundamental/metrics', aaplOnly(demoMarketAAPL.metrics)),
  http.get('/api/market-data-v1/equity/fundamental/ratios', aaplOnly(demoMarketAAPL.ratios)),
  http.get('/api/market-data-v1/equity/fundamental/balance', aaplOnly(demoMarketAAPL.balance)),
  http.get('/api/market-data-v1/equity/fundamental/income', aaplOnly(demoMarketAAPL.income)),
  http.get('/api/market-data-v1/equity/fundamental/cash', aaplOnly(demoMarketAAPL.cash)),

  http.post('/api/market-data/test-provider', () => HttpResponse.json({ ok: true })),
]
