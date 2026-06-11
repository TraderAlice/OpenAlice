import { http, HttpResponse } from 'msw'
import {
  demoTradingAccounts,
  demoUTASummaries,
  demoAccountByUTA,
  demoAccountInfo,
  demoPositionsByUTA,
  demoUTAConfigs,
  demoUTAConfig,
  demoEquityCurve,
  demoEquityCurveByUTA,
  demoSnapshotsByUTA,
  demoOrderHistoryByUTA,
  demoTradeHistoryByUTA,
} from '../fixtures/trading'

function totals() {
  const accounts = demoTradingAccounts.map((a) => ({
    id: a.id,
    label: a.label,
    equity: demoAccountByUTA[a.id]!.netLiquidation,
    cash: demoAccountByUTA[a.id]!.totalCashValue,
  }))
  const sum = (key: 'netLiquidation' | 'totalCashValue' | 'unrealizedPnL' | 'realizedPnL') =>
    demoTradingAccounts
      .reduce((acc, a) => acc + Number(demoAccountByUTA[a.id]![key] ?? 0), 0)
      .toFixed(2)
  return {
    totalEquity: sum('netLiquidation'),
    totalCash: sum('totalCashValue'),
    totalUnrealizedPnL: sum('unrealizedPnL'),
    totalRealizedPnL: sum('realizedPnL'),
    accounts,
  }
}

function utaId(params: { id?: string | readonly string[] }): string {
  const v = params.id
  return Array.isArray(v) ? v[0] ?? '' : String(v ?? '')
}

export const tradingHandlers = [
  http.get('/api/trading/uta', () =>
    HttpResponse.json({ utas: demoTradingAccounts, summaries: demoUTASummaries }),
  ),
  http.get('/api/trading/equity', () => HttpResponse.json(totals())),
  http.get('/api/trading/fx-rates', () =>
    HttpResponse.json({
      rates: [
        { currency: 'USDT', rate: 1.0, source: 'demo', updatedAt: new Date().toISOString() },
        { currency: 'EUR', rate: 1.08, source: 'demo', updatedAt: new Date().toISOString() },
      ],
    }),
  ),

  http.post('/api/trading/uta/:id/reconnect', () =>
    HttpResponse.json({ success: true, message: 'Demo mode — reconnect is a no-op.' }),
  ),

  http.get('/api/trading/uta/:id/account', ({ params }) =>
    HttpResponse.json(demoAccountByUTA[utaId(params)] ?? demoAccountInfo),
  ),
  http.get('/api/trading/uta/:id/positions', ({ params }) =>
    HttpResponse.json({ positions: demoPositionsByUTA[utaId(params)] ?? [] }),
  ),
  http.get('/api/trading/uta/:id/orders', () => HttpResponse.json({ orders: [] })),
  http.get('/api/trading/uta/:id/order-history', ({ params }) =>
    HttpResponse.json({ orders: demoOrderHistoryByUTA[utaId(params)] ?? [] }),
  ),
  http.get('/api/trading/uta/:id/trade-history', ({ params }) =>
    HttpResponse.json({ trades: demoTradeHistoryByUTA[utaId(params)] ?? [] }),
  ),
  http.get('/api/trading/uta/:id/market-clock', () =>
    HttpResponse.json({
      isOpen: false,
      nextOpen: new Date(Date.now() + 3600_000).toISOString(),
      nextClose: new Date(Date.now() + 7 * 3600_000).toISOString(),
    }),
  ),

  http.get('/api/trading/uta/:id/wallet/status', () =>
    HttpResponse.json({ staged: [], pendingMessage: null, head: null, commitCount: 0 }),
  ),
  http.get('/api/trading/uta/:id/wallet/log', () => HttpResponse.json({ commits: [] })),
  http.get('/api/trading/uta/:id/wallet/show/:hash', () =>
    HttpResponse.json({ error: 'not found' }, { status: 404 }),
  ),
  http.post('/api/trading/uta/:id/wallet/reject', () =>
    HttpResponse.json({ hash: 'demo', message: 'rejected', operationCount: 0 }),
  ),
  http.post('/api/trading/uta/:id/wallet/push', () =>
    HttpResponse.json({
      hash: 'demo',
      message: 'demo push',
      operationCount: 0,
      submitted: [],
      rejected: [],
    }),
  ),
  http.post('/api/trading/uta/:id/wallet/place-order', () =>
    HttpResponse.json(
      { error: 'Demo mode — orders are read-only.', phase: 'validate' },
      { status: 400 },
    ),
  ),
  http.post('/api/trading/uta/:id/wallet/close-position', () =>
    HttpResponse.json(
      { error: 'Demo mode — orders are read-only.', phase: 'validate' },
      { status: 400 },
    ),
  ),
  http.post('/api/trading/uta/:id/wallet/cancel-order', () =>
    HttpResponse.json(
      { error: 'Demo mode — orders are read-only.', phase: 'validate' },
      { status: 400 },
    ),
  ),

  http.get('/api/trading/config/broker-presets', () => HttpResponse.json({ presets: [] })),
  http.get('/api/trading/config', () => HttpResponse.json({ utas: demoUTAConfigs })),
  http.post('/api/trading/config/uta', () => HttpResponse.json(demoUTAConfig, { status: 201 })),
  http.put('/api/trading/config/uta/:id', () => HttpResponse.json(demoUTAConfig)),
  http.delete('/api/trading/config/uta/:id', () => HttpResponse.json({ ok: true })),
  http.post('/api/trading/config/test-connection', () =>
    HttpResponse.json({ success: true, account: demoAccountInfo }),
  ),

  http.get('/api/trading/uta/:id/snapshots', ({ params }) =>
    HttpResponse.json({ snapshots: demoSnapshotsByUTA[utaId(params)] ?? [] }),
  ),
  http.delete('/api/trading/uta/:id/snapshots/:timestamp', () =>
    HttpResponse.json({ success: true }),
  ),
  http.get('/api/trading/snapshots/equity-curve', ({ request }) => {
    const id = new URL(request.url).searchParams.get('utaId')
    const points = id ? demoEquityCurveByUTA[id] ?? [] : demoEquityCurve
    return HttpResponse.json({ points })
  }),

  http.get('/api/trading/contracts/search', () =>
    HttpResponse.json({ results: [], count: 0, utasConfigured: demoTradingAccounts.length }),
  ),
]
