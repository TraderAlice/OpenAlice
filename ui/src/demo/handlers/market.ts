import { http, HttpResponse } from 'msw'
import {
  demoMarketAAPL,
  demoMarketSearchAAPL,
  demoMarketEmpty,
  demoSectorRotation,
} from '../fixtures/market'
import type { BarSourceCandidate, BarMeta } from '../../api/market'
import type { MoversBoard, MoverRow, CalendarBoard, MacroBoard, MacroSeriesCard, TermStructureBoard } from '../../api/reference'

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

  // Movers board — static snapshot, typed against the canonical contract.
  http.get('/api/reference/movers', () => HttpResponse.json(demoMovers)),
  http.get('/api/reference/calendar', () => HttpResponse.json(demoCalendar)),
  http.get('/api/reference/macro', () => HttpResponse.json(demoMacro)),
  http.get('/api/reference/term-structure', () => HttpResponse.json(demoTermStructure)),

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

// ---- movers fixture ----

function mover(symbol: string, name: string, price: number, pct: number, volume: number, rvol: number): MoverRow {
  return {
    symbol, name, price,
    change: price * pct,
    percent_change: pct,
    volume,
    avg_volume: Math.round(volume / rvol),
    relative_volume: rvol,
    turnover: 0.02,
    dollar_volume: price * volume,
  }
}

const demoMovers: MoversBoard = {
  gainers: [
    mover('NVDA', 'NVIDIA Corporation', 1042.1, 0.062, 5.1e7, 1.8),
    mover('SMCI', 'Super Micro Computer', 812.4, 0.054, 9.2e6, 2.6),
    mover('AAPL', 'Apple Inc.', 228.9, 0.031, 6.4e7, 1.2),
  ],
  losers: [
    mover('TSLA', 'Tesla, Inc.', 182.3, -0.047, 9.8e7, 1.5),
    mover('INTC', 'Intel Corporation', 30.6, -0.038, 4.4e7, 1.1),
  ],
  active: [
    mover('TSLA', 'Tesla, Inc.', 182.3, -0.047, 9.8e7, 1.5),
    mover('AAPL', 'Apple Inc.', 228.9, 0.031, 6.4e7, 1.2),
    mover('NVDA', 'NVIDIA Corporation', 1042.1, 0.062, 5.1e7, 1.8),
  ],
  meta: { provider: 'yfinance', asOf: '2026-06-10T13:30:00.000Z' },
}

const demoCalendar: CalendarBoard = {
  earnings: [
    { report_date: '2026-06-11', symbol: 'ORCL', name: 'Oracle Corporation', eps_previous: 1.41, eps_consensus: 1.65 },
    { report_date: '2026-06-12', symbol: 'ADBE', name: 'Adobe Inc.', eps_previous: 4.48, eps_consensus: 4.97 },
    { report_date: '2026-06-17', symbol: 'ACN', name: 'Accenture plc', eps_previous: 3.13, eps_consensus: 3.32 },
  ],
  ipos: [
    { symbol: 'DEMO', ipo_date: '2026-06-15', name: 'Demo Robotics Holdings', exchange: 'NASDAQ' },
  ],
  dividends: [
    { ex_dividend_date: '2026-06-12', symbol: 'AAPL', amount: 0.26, name: 'Apple Inc.', record_date: '2026-06-13', payment_date: '2026-06-19', declaration_date: '2026-05-01' } as CalendarBoard['dividends'][number],
  ],
  window: { start: '2026-06-10', end: '2026-06-24' },
  meta: { provider: 'fmp', asOf: '2026-06-10T13:30:00.000Z' },
}

function macroCard(id: string, label: string, unit: MacroSeriesCard['unit'], base: number, drift: number): MacroSeriesCard {
  const points = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10),
    value: base + drift * i + Math.sin(i / 6) * Math.abs(drift) * 3,
  }))
  const latest = points[points.length - 1]
  const prev = points[points.length - 2]
  return { id, label, unit, points, latest: latest.value, latestDate: latest.date, change: latest.value - prev.value }
}

const demoMacro: MacroBoard = {
  cards: [
    macroCard('DFF', 'Fed Funds Rate', 'percent', 4.25, -0.002),
    macroCard('DGS2', '2Y Treasury', 'percent', 3.9, -0.004),
    macroCard('DGS10', '10Y Treasury', 'percent', 4.3, 0.002),
    macroCard('T10Y2Y', '10Y–2Y Spread', 'percent', 0.2, 0.005),
    macroCard('UNRATE', 'Unemployment Rate', 'percent', 4.1, 0.003),
    macroCard('CPI_YOY', 'CPI YoY', 'percent', 2.8, -0.005),
    macroCard('ICSA', 'Initial Jobless Claims', 'count', 218000, 350),
    macroCard('DCOILWTICO', 'WTI Crude', 'usd', 71, 0.12),
    macroCard('DTWEXBGS', 'Dollar Index (Broad)', 'index', 121, -0.05),
  ],
  meta: { provider: 'federal_reserve', asOf: '2026-06-10T13:30:00.000Z' },
}

function termCurve(symbol: string, spot: number): TermStructureBoard['curves'][number] {
  const expiries = [['2026-06-26', 16], ['2026-07-31', 51], ['2026-09-25', 107], ['2026-12-25', 198], ['2027-03-26', 289]] as const
  return {
    symbol,
    spot,
    points: expiries.map(([expiration, days]) => {
      const basis = 6 + days / 150
      return {
        expiration,
        price: Math.round(spot * (1 + (basis / 100) * (days / 365))),
        daysToExpiry: days,
        annualizedBasis: basis,
      }
    }),
  }
}

const demoTermStructure: TermStructureBoard = {
  curves: [termCurve('BTC', 104500), termCurve('ETH', 5230)],
  meta: { provider: 'deribit', asOf: '2026-06-10T13:30:00.000Z' },
}
