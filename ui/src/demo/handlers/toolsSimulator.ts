import { http, HttpResponse } from 'msw'

import type { SimulatorState, SimulatorUTAEntry } from '../../api/simulator'

const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')
  ?? (request.referrer ? new URL(request.referrer).searchParams.get('themeAuditFixture') : null)

const auditSimulatorUtas: SimulatorUTAEntry[] = [
  { id: 'audit-sim-primary', label: 'Audit primary' },
  { id: 'audit-sim-secondary', label: 'Audit secondary' },
]

const auditSimulatorState: SimulatorState = {
  cash: '10000',
  markPrices: [{ nativeKey: 'AAPL', price: '100.50' }],
  positions: [],
  pendingOrders: [{
    orderId: 'audit-near-trigger',
    nativeKey: 'AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: '1',
    lmtPrice: '100.00',
  }],
}

export const toolsSimulatorHandlers = [
  http.get('/api/tools', () => HttpResponse.json({ inventory: [], disabled: [] })),
  http.put('/api/tools', () => HttpResponse.json({ disabled: [] })),
  http.get('/api/tools/:name', () =>
    HttpResponse.json({ error: 'not found' }, { status: 404 }),
  ),
  http.post('/api/tools/:name/execute', () =>
    HttpResponse.json({ content: [{ type: 'text', text: 'Demo mode — tool execution is disabled.' }], isError: true }),
  ),

  http.get('/api/simulator/utas', ({ request }) => HttpResponse.json({
    utas: auditFixture(request) === 'simulator-audit' ? auditSimulatorUtas : [],
  })),
  http.get('/api/simulator/uta/:id/state', ({ request }) =>
    HttpResponse.json(auditFixture(request) === 'simulator-audit'
      ? auditSimulatorState
      : { cash: '0', markPrices: [], positions: [], pendingOrders: [] })),
  http.post('/api/simulator/uta/:id/mark-price', () => HttpResponse.json({ filled: [] })),
  http.post('/api/simulator/uta/:id/tick-price', () => HttpResponse.json({ filled: [] })),
  http.post('/api/simulator/uta/:id/orders/:orderId/fill', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/orders/:orderId/cancel', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-deposit', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-withdraw', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-trade', () => HttpResponse.json({ ok: true })),
]
