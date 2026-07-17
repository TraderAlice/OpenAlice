import { http, HttpResponse } from 'msw'
import {
  demoTradingAccounts,
  demoUTASummaries,
  demoAccountByUTA,
  demoAccountInfo,
  demoPositionsByUTA,
  demoSubAccountsByUTA,
  demoCryptoAccountBySub,
  demoCryptoPositionsBySub,
  DEMO_UTA_CRYPTO,
  demoUTAConfigs,
  demoUTAConfig,
  demoEquityCurve,
  demoEquityCurveByUTA,
  demoSnapshotsByUTA,
  demoOrderHistoryByUTA,
  demoTradeHistoryByUTA,
} from '../fixtures/trading'
import type { BrokerPreset, WalletCommitLog, WalletStatus } from '../../api/types'

const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')
  ?? (request.referrer ? new URL(request.referrer).searchParams.get('themeAuditFixture') : null)

const auditWalletStatus: WalletStatus = {
  staged: [
    { action: 'modifyOrder', orderId: 'audit-order', contract: { symbol: 'AAPL' } },
    { action: 'placeOrder', contract: { symbol: 'NVDA' }, order: { action: 'BUY', orderType: 'LMT', totalQuantity: 2, lmtPrice: 180 } },
  ],
  pendingMessage: 'Risk review required before broker submission', head: 'audit-head', commitCount: 3,
}
const auditStagedWalletStatus: WalletStatus = { ...auditWalletStatus, pendingMessage: null }

const auditWalletLog: WalletCommitLog[] = [
  { hash: 'audit-submitted', message: 'Submitted broker order', timestamp: new Date(Date.now() - 60_000).toISOString(), operations: [{ symbol: 'AAPL', action: 'placeOrder', change: 'BUY 1', status: 'submitted' }] },
  { hash: 'audit-rejected', message: 'User rejected broker order', timestamp: new Date(Date.now() - 120_000).toISOString(), operations: [{ symbol: 'TSLA', action: 'cancelOrder', change: 'cancel', status: 'user-rejected' }] },
]

const auditBrokerPreset: BrokerPreset = {
  id: 'audit-ibkr', label: 'Interactive Brokers', description: 'Typed audit broker fixture', category: 'recommended',
  defaultName: 'Audit IBKR', badge: 'IB', badgeColor: 'text-orange-400', engine: 'ibkr', guardCategory: 'securities',
  subtitleFields: [], schema: { type: 'object', properties: {} },
}

function totals(fixture?: string | null) {
  const accounts = demoTradingAccounts.map((a) => ({
    id: a.id,
    label: a.label,
    equity: demoAccountByUTA[a.id]!.netLiquidation,
    cash: demoAccountByUTA[a.id]!.totalCashValue,
    ...(fixture === 'portfolio-health-degraded' ? { health: 'degraded' as const } : {}),
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
  http.get('/api/trading/status', ({ request }) =>
    HttpResponse.json(auditFixture(request) === 'trading-degraded' ? {
      available: false, state: 'unavailable', mode: 'pro', modeSource: 'auto', envLocked: false,
      hasUTAConfig: true, hint: 'Audit trading service unavailable.', utas: demoUTASummaries.length,
    } : auditFixture(request) === 'agent-permissions-warning' ? {
      available: true, state: 'available', mode: 'readonly', modeSource: 'config', envLocked: false,
      hasUTAConfig: true, hint: 'Audit readonly mode.', utas: demoUTASummaries.length,
    } : auditFixture(request) === 'first-run-no-uta' ? {
      available: true, state: 'available', mode: 'readonly', modeSource: 'auto', envLocked: false,
      hasUTAConfig: false, hint: 'Audit onboarding without a broker.', utas: 0,
    } : ['first-run-incomplete', 'first-run-locked'].includes(auditFixture(request) ?? '') ? {
      available: true, state: 'available', mode: 'readonly', modeSource: 'env', envLocked: true,
      hasUTAConfig: true, hint: 'Audit onboarding mode lock.', utas: demoUTASummaries.length,
    } : {
      available: true,
      state: 'available',
      mode: 'pro',
      modeSource: 'auto',
      envLocked: false,
      hasUTAConfig: true,
      hint: 'Demo trading service is available.',
      utas: demoUTASummaries.length,
    }),
  ),
  http.get('/api/trading/uta', ({ request }) => {
    const summaries = ['trading-degraded', 'portfolio-health-degraded'].includes(auditFixture(request) ?? '')
      ? demoUTASummaries.map((uta) => ({ ...uta, health: { ...uta.health!, status: 'degraded' as const, reach: 'connected' as const, lastError: 'Audit account access unavailable' } }))
      : demoUTASummaries
    return HttpResponse.json({ utas: summaries, summaries })
  },
  ),
  http.get('/api/trading/equity', ({ request }) => HttpResponse.json(totals(auditFixture(request)))),
  http.get('/api/trading/fx-rates', ({ request }) =>
    HttpResponse.json({
      rates: [
        { currency: 'USDT', rate: 1.0, source: auditFixture(request) === 'portfolio-cached' ? 'cached' : 'demo', updatedAt: new Date().toISOString() },
        { currency: 'EUR', rate: 1.08, source: 'demo', updatedAt: new Date().toISOString() },
      ],
    }),
  ),

  http.post('/api/trading/uta/:id/reconnect', () =>
    HttpResponse.json({ success: true, message: 'Demo mode — reconnect is a no-op.' }),
  ),

  http.get('/api/trading/uta/:id/subaccounts', ({ params }) =>
    HttpResponse.json({ subAccounts: demoSubAccountsByUTA[utaId(params)] ?? [{ id: 'default', label: 'Account', kind: 'unified' }] }),
  ),
  http.get('/api/trading/uta/:id/account', ({ params, request }) => {
    const id = utaId(params)
    const sub = new URL(request.url).searchParams.get('subAccountId')
    if (id === DEMO_UTA_CRYPTO && sub && demoCryptoAccountBySub[sub]) {
      return HttpResponse.json(demoCryptoAccountBySub[sub])
    }
    return HttpResponse.json(demoAccountByUTA[id] ?? demoAccountInfo)
  }),
  http.get('/api/trading/uta/:id/positions', ({ params, request }) => {
    const id = utaId(params)
    const sub = new URL(request.url).searchParams.get('subAccountId')
    if (id === DEMO_UTA_CRYPTO && sub && demoCryptoPositionsBySub[sub]) {
      return HttpResponse.json({ positions: demoCryptoPositionsBySub[sub] })
    }
    return HttpResponse.json({ positions: demoPositionsByUTA[id] ?? [] })
  }),
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

  http.get('/api/trading/uta/:id/wallet/status', ({ request, params }) =>
    HttpResponse.json(auditFixture(request) === 'trading-approval'
      ? (String(params.id).includes('ibkr') ? auditStagedWalletStatus : auditWalletStatus)
      : { staged: [], pendingMessage: null, head: null, commitCount: 0 }),
  ),
  http.get('/api/trading/uta/:id/wallet/log', ({ request }) => HttpResponse.json({ commits: auditFixture(request) === 'trading-approval' ? auditWalletLog : [] })),
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
  http.post('/api/trading/uta/:id/wallet/place-order', ({ request }) =>
    auditFixture(request) === 'order-partial'
      ? HttpResponse.json({ hash: 'audit-partial', message: 'partial audit push', operationCount: 2, submitted: [{ action: 'place-order', success: true, orderId: 'audit-1', status: 'submitted' }], rejected: [{ action: 'place-order', success: false, error: 'risk rejected', status: 'rejected' }] })
      : HttpResponse.json(
      { error: 'Demo mode — orders are read-only.', phase: 'validate' },
      { status: 400 },
    )),
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

  http.get('/api/trading/config/broker-presets', ({ request }) => HttpResponse.json({ presets: ['broker-picker', 'broker-conflict', 'first-run-no-uta'].includes(auditFixture(request) ?? '') ? [auditBrokerPreset] : [] })),
  http.get('/api/trading/config', ({ request }) => HttpResponse.json({ utas: auditFixture(request) === 'first-run-no-uta' ? [] : demoUTAConfigs })),
  http.post('/api/trading/config/uta', ({ request }) => auditFixture(request) === 'broker-conflict'
    ? HttpResponse.json({ error: 'broker_already_exists', existing: { id: 'demo-ibkr', label: 'Demo IBKR', presetId: 'audit-ibkr' } }, { status: 409 })
    : HttpResponse.json(demoUTAConfig, { status: 201 })),
  http.put('/api/trading/config/uta/:id', () => HttpResponse.json(demoUTAConfig)),
  http.delete('/api/trading/config/uta/:id', () => HttpResponse.json({ ok: true })),
  http.post('/api/trading/config/test-connection', () =>
    HttpResponse.json({ success: true, account: demoAccountInfo }),
  ),

  http.get('/api/trading/uta/:id/snapshots', ({ params, request }) => {
    const snapshots = demoSnapshotsByUTA[utaId(params)] ?? []
    return HttpResponse.json({
      snapshots: auditFixture(request) === 'snapshot-degraded'
        ? snapshots.map((snapshot, index) => index === 0 ? { ...snapshot, health: 'degraded' } : snapshot)
        : snapshots,
    })
  }),
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
