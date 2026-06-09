import { http, HttpResponse } from 'msw'
import {
  demoMarketAAPL,
  demoMarketSearchAAPL,
  demoMarketEmpty,
  demoSectorRotation,
} from '../fixtures/market'
import type { BarSourceCandidate, BarMeta } from '../../api/market'

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

  // ---- federated bars (multi-source K-lines) ----
  // AAPL has two demo sources so the source picker is exercised.
  http.get('/api/bars/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('query') ?? '').toUpperCase()
    if (!q.includes('AAPL') && !q.includes('APPLE')) return HttpResponse.json({ candidates: [], count: 0 })
    const candidates: BarSourceCandidate[] = [
      { barId: 'yfinance|AAPL', source: 'vendor', sourceId: 'yfinance', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', label: 'AAPL', barCapability: 'delayed' },
      { barId: 'alpaca-paper|AAPL', source: 'uta', sourceId: 'alpaca-paper', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', label: 'AAPL', barCapability: 'iex' },
    ]
    return HttpResponse.json({ candidates, count: candidates.length })
  }),
  http.get('/api/bars', ({ request }) => {
    const url = new URL(request.url)
    const barId = url.searchParams.get('barId')
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase()
    if (!(barId?.includes('AAPL') || symbol === AAPL)) {
      return HttpResponse.json({ results: null, meta: null, error: 'No demo data for this symbol.' })
    }
    const results = demoMarketAAPL.historical.results
    const sourceId = barId ? barId.split('|')[0] : 'yfinance'
    const meta: BarMeta = {
      symbol: 'AAPL', from: results[0]?.date ?? '', to: results[results.length - 1]?.date ?? '', bars: results.length,
      source: sourceId === 'alpaca-paper' ? 'uta' : 'vendor', sourceId, barId: barId ?? `${sourceId}|AAPL`,
      provider: sourceId, barCapability: sourceId === 'alpaca-paper' ? 'iex' : 'delayed',
    }
    return HttpResponse.json({ results, meta })
  }),

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
