import { http, HttpResponse } from 'msw'
import {
  demoMarketAAPL,
  demoMarketSearchAAPL,
  demoMarketEmpty,
  demoSectorRotation,
} from '../fixtures/market'
import type { BarSourceCandidate, BarMeta } from '../../api/market'
import type { MoversBoard, MoverRow, CalendarBoard, MacroBoard, MacroSeriesCard, TermStructureBoard, ValuationStrip, GlobalMacroBoard, ShippingBoard, FedBoard } from '../../api/reference'

const AAPL = 'AAPL'
const DEMO_FX: Record<string, { name: string; spot: number; aliases: string[] }> = {
  EURUSD: { name: 'Euro / U.S. Dollar', spot: 1.0842, aliases: ['EUR', 'EURO'] },
  USDJPY: { name: 'U.S. Dollar / Japanese Yen', spot: 157.35, aliases: ['JPY', 'YEN'] },
  GBPUSD: { name: 'British Pound / U.S. Dollar', spot: 1.2915, aliases: ['GBP', 'POUND', 'STERLING'] },
  USDCNH: { name: 'U.S. Dollar / Offshore Renminbi', spot: 7.185, aliases: ['CNH', 'RMB', 'RENMINBI', 'YUAN'] },
}

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
  http.get('/api/reference/valuation', () => HttpResponse.json(demoValuation)),
  http.get('/api/reference/global-macro', () => HttpResponse.json(demoGlobalMacro)),
  http.get('/api/reference/shipping', () => HttpResponse.json(demoShipping)),
  http.get('/api/reference/fed', () => HttpResponse.json(demoFed)),

  // ---- federated bars (multi-source K-lines) ----
  // Cover the provider/asset-class combinations that have historically broken
  // at the UI → bar-service boundary. AAPL has two sources so the picker is
  // exercised; the other rows validate vendor-native namespaces.
  http.get('/api/bars/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('query') ?? '').toUpperCase()
    let candidates: BarSourceCandidate[] = []
    if (q.includes('AAPL') || q.includes('APPLE')) {
      candidates = [
        { barId: 'yfinance|AAPL', source: 'vendor', sourceId: 'yfinance', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', label: 'AAPL', barCapability: 'delayed' },
        { barId: 'alpaca-paper|AAPL', source: 'uta', sourceId: 'alpaca-paper', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', label: 'AAPL', barCapability: 'iex' },
      ]
    } else if (Object.entries(DEMO_FX).some(([symbol, fx]) => q.includes(symbol) || fx.aliases.some((alias) => q.includes(alias)))) {
      candidates = Object.entries(DEMO_FX)
        .filter(([symbol, fx]) => q.includes(symbol) || fx.aliases.some((alias) => q.includes(alias)))
        .map(([symbol, fx]) => ({
          barId: `yfinance|${symbol}`,
          source: 'vendor' as const,
          sourceId: 'yfinance',
          symbol,
          name: fx.name,
          assetClass: 'currency' as const,
          label: symbol,
          barCapability: 'delayed' as const,
        }))
    } else if (q.includes('GOLD') || q.includes('XAU') || q.includes('黄金')) {
      candidates = [
        { barId: 'yfinance|gold', source: 'vendor', sourceId: 'yfinance', symbol: 'gold', name: 'Gold', assetClass: 'commodity', label: 'gold', barCapability: 'delayed' },
      ]
    } else if (q.includes('600519') || q.includes('茅台')) {
      candidates = [
        { barId: 'eastmoney|1.600519', source: 'vendor', sourceId: 'eastmoney', symbol: '1.600519', name: '贵州茅台', assetClass: 'equity', label: '1.600519', barCapability: 'delayed' },
      ]
    }
    return HttpResponse.json({ candidates, count: candidates.length })
  }),
  http.get('/api/bars', ({ request }) => {
    const url = new URL(request.url)
    const barId = url.searchParams.get('barId')
    const assetClass = url.searchParams.get('assetClass')
    const fallbackSymbol = url.searchParams.get('symbol') ?? ''
    const knownSources: Record<string, { symbol: string; assetClass: string }> = {
      'yfinance|AAPL': { symbol: 'AAPL', assetClass: 'equity' },
      'alpaca-paper|AAPL': { symbol: 'AAPL', assetClass: 'equity' },
      ...Object.fromEntries(Object.keys(DEMO_FX).map((symbol) => [`yfinance|${symbol}`, { symbol, assetClass: 'currency' }])),
      'yfinance|gold': { symbol: 'gold', assetClass: 'commodity' },
      'eastmoney|1.600519': { symbol: '1.600519', assetClass: 'equity' },
    }
    const selected = barId ? knownSources[barId] : Object.values(knownSources).find((row) => row.symbol === fallbackSymbol)
    if (!selected) {
      return HttpResponse.json({ results: null, meta: null, error: 'No demo data for this symbol.' })
    }
    if (barId && !barId.startsWith('alpaca-paper|') && assetClass !== selected.assetClass) {
      return HttpResponse.json({ results: null, meta: null, error: `Vendor barId needs assetClass=${selected.assetClass}.` })
    }
    const rawResults = demoMarketAAPL.historical.results ?? []
    const targetSpot = DEMO_FX[selected.symbol]?.spot
    const results = targetSpot == null
      ? rawResults
      : (() => {
          const last = Math.max(1, rawResults.length - 1)
          const factor = (index: number) => 1
            + (index - last) * 0.00012
            + Math.sin(index / 4) * 0.007
            + Math.sin(index / 1.7) * 0.003
          const anchor = factor(last)
          const closeAt = (index: number) => targetSpot * factor(index) / anchor
          return rawResults.map((bar, index) => {
            const close = closeAt(index)
            const open = index === 0 ? close * 0.9996 : closeAt(index - 1)
            const band = close * 0.0012
            return {
              ...bar,
              open,
              high: Math.max(open, close) + band,
              low: Math.min(open, close) - band,
              close,
              volume: null,
            }
          })
        })()
    const sourceId = barId ? barId.split('|')[0] : 'yfinance'
    const meta: BarMeta = {
      symbol: selected.symbol, from: results[0]?.date ?? '', to: results[results.length - 1]?.date ?? '', bars: results.length,
      source: sourceId === 'alpaca-paper' ? 'uta' : 'vendor', sourceId, barId: barId ?? `${sourceId}|${selected.symbol}`,
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
  http.get('/api/market/equity/profile', aaplOnly(demoMarketAAPL.profile)),
  http.get('/api/market-data-v1/equity/price/quote', aaplOnly(demoMarketAAPL.quote)),
  http.get('/api/market/equity/metrics', aaplOnly(demoMarketAAPL.metrics)),
  http.get('/api/market/equity/ratios', aaplOnly(demoMarketAAPL.ratios)),
  http.get('/api/market/equity/balance', aaplOnly(demoMarketAAPL.balance)),
  http.get('/api/market/equity/income', aaplOnly(demoMarketAAPL.income)),
  http.get('/api/market/equity/cash', aaplOnly(demoMarketAAPL.cash)),

  http.post('/api/market-data/test-provider', () => HttpResponse.json({ ok: true })),
  http.get('/api/market-data/hub-status', () =>
    HttpResponse.json({ enabled: true, baseUrl: 'https://traderhub.openalice.ai', reachable: true }),
  ),
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
  undervaluedGrowth: [
    mover('MGNI', 'Magnite, Inc.', 15.8, 0.021, 4.2e6, 1.1),
    mover('PFE', 'Pfizer Inc.', 28.4, 0.008, 3.1e7, 0.9),
  ],
  growthTech: [
    mover('APH', 'Amphenol Corporation', 154.1, 0.014, 6.8e6, 1.0),
    mover('CRWD', 'CrowdStrike Holdings', 401.2, 0.027, 3.4e6, 1.3),
  ],
  smallCaps: [
    mover('LESL', "Leslie's, Inc.", 8.2, 0.059, 5.6e6, 2.1),
  ],
  undervaluedLarge: [
    mover('BCH', 'Banco De Chile', 38.5, 0.006, 1.2e6, 0.8),
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

const demoValuation: ValuationStrip = {
  cards: [
    macroCard('pe_month', 'S&P 500 PE', 'index', 27.4, 0.03),
    macroCard('shiller_pe_month', 'Shiller PE (CAPE)', 'index', 36.2, 0.04),
    macroCard('earnings_yield_month', 'Earnings Yield', 'percent', 3.6, -0.004),
    macroCard('dividend_yield_month', 'Dividend Yield', 'percent', 1.25, -0.001),
  ],
  meta: { provider: 'multpl', asOf: '2026-06-10T13:30:00.000Z' },
}

function gmRow(country: string, label: string, cpi: number | null, rate: number | null, cli: number | null, house?: number | null, share?: number | null): GlobalMacroBoard['rows'][number] {
  const cell = (value: number | null) => (value == null ? { value: null, date: null, error: 'no data' } : { value, date: '2026-04-01' })
  return { country, label, cpiYoy: cell(cpi), shortRate: cell(rate), cli: cell(cli), housePrice: cell(house ?? null), sharePrice: cell(share ?? null) }
}

const demoGlobalMacro: GlobalMacroBoard = {
  rows: [
    gmRow('united_states', 'United States', 3.1, 3.9, 100.9, 152.3, 214.8),
    gmRow('china', 'China', 1.2, 1.6, 101.5, 96.4, 118.2),
    gmRow('japan', 'Japan', 2.4, 0.6, 100.2, 121.7, 246.0),
    gmRow('germany', 'Germany', 2.2, 2.1, 99.6, 128.9, 168.3),
    gmRow('united_kingdom', 'United Kingdom', 2.8, 4.1, 99.9, 119.5, 132.6),
    gmRow('india', 'India', 4.6, 6.4, null, null, 287.4),
    gmRow('brazil', 'Brazil', 4.1, 10.2, 100.4, 108.2, 176.9),
  ],
  meta: { provider: 'oecd', asOf: '2026-06-10T13:30:00.000Z' },
}

function shippingCurve(key: string, name: string, baseTons: number, vessels: number): ShippingBoard['curves'][number] {
  const points = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 3, 9 + i)).toISOString().slice(0, 10),
    tons: Math.round(baseTons * (1 + Math.sin(i / 7) * 0.18)),
    vessels: Math.max(1, Math.round(vessels * (1 + Math.sin(i / 7) * 0.15))),
  }))
  return { key, name, points, latest: points[points.length - 1] }
}

const demoFed: FedBoard = {
  cards: [
    macroCard('WALCL', 'Total Assets', 'count', 6.62e12, -2.1e9),
    macroCard('TREAST', 'Treasuries Held', 'count', 4.47e12, -1.4e9),
    macroCard('WSHOMCB', 'MBS Held', 'count', 1.96e12, -0.9e9),
    macroCard('PD_NET', 'Dealer Net Positions', 'count', 6.9e11, 1.2e9),
    macroCard('PD_UST', 'Dealer Net Treasuries', 'count', 5.2e11, 0.8e9),
  ],
  documents: [
    { date: '2026-06-17', title: 'FOMC Statement — 2026-06-17', type: 'statement', url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a1.htm' },
    { date: '2026-05-28', title: 'FOMC Minutes — 2026-05-28', type: 'minutes', url: 'https://www.federalreserve.gov/monetarypolicy/fomcminutes20260528.htm' },
    { date: '2026-06-17', title: 'FOMC Projection Materials — 2026-06-17', type: 'projections', url: 'https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl20260617.pdf' },
  ],
  meta: { provider: 'fred+nyfed+federalreserve.gov', asOf: '2026-06-10T13:30:00.000Z' },
}

const demoShipping: ShippingBoard = {
  curves: [
    shippingCurve('suez', 'Suez Canal', 1.6e6, 40),
    shippingCurve('panama', 'Panama Canal', 0.7e6, 30),
    shippingCurve('hormuz', 'Strait of Hormuz', 0.9e6, 25),
    shippingCurve('malacca', 'Malacca Strait', 7.2e6, 185),
    shippingCurve('bab el-mandeb', 'Bab el-Mandeb Strait', 1.3e6, 35),
    shippingCurve('cape of good hope', 'Cape of Good Hope', 5.9e6, 95),
  ],
  meta: { provider: 'imf-portwatch', asOf: '2026-06-10T13:30:00.000Z' },
}
