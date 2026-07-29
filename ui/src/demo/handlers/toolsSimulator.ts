import { http, HttpResponse } from 'msw'

import {
  demoToolDetails,
  demoToolInventory,
  demoToolResults,
  type DemoToolName,
} from '../fixtures/tools'

let disabledTools = new Set<DemoToolName>()

export function resetDemoToolsState(): void {
  disabledTools = new Set()
}

function isDemoToolName(name: string): name is DemoToolName {
  return name in demoToolDetails
}

export const toolsSimulatorHandlers = [
  http.get('/api/tools', () =>
    HttpResponse.json({
      inventory: demoToolInventory,
      disabled: [...disabledTools],
    }),
  ),
  http.put('/api/tools', async ({ request }) => {
    const body = await request.json() as { disabled?: unknown }
    const disabled = Array.isArray(body.disabled)
      ? body.disabled.filter(
          (name): name is DemoToolName => typeof name === 'string' && isDemoToolName(name),
        )
      : []
    disabledTools = new Set(disabled)
    return HttpResponse.json({ disabled: [...disabledTools] })
  }),
  http.get('/api/tools/:name', ({ params }) => {
    const name = String(params.name)
    if (!isDemoToolName(name)) {
      return HttpResponse.json({ error: `Tool not found: ${name}` }, { status: 404 })
    }
    return HttpResponse.json(demoToolDetails[name])
  }),
  http.post('/api/tools/:name/execute', async ({ params, request }) => {
    const name = String(params.name)
    if (!isDemoToolName(name)) {
      return HttpResponse.json({ error: `Tool not found: ${name}` }, { status: 404 })
    }
    const input = await request.json().catch(() => ({}))
    return HttpResponse.json({
      content: [{
        type: 'text',
        text: JSON.stringify({
          demo: true,
          note: 'Recorded result for the prefilled example; submitted input is echoed for UI testing.',
          input,
          result: demoToolResults[name],
        }, null, 2),
      }],
    })
  }),

  http.get('/api/simulator/utas', () => HttpResponse.json({ utas: [] })),
  http.get('/api/simulator/uta/:id/state', () =>
    HttpResponse.json({ positions: [], orders: [], cash: '0' }),
  ),
  http.post('/api/simulator/uta/:id/mark-price', () => HttpResponse.json({ filled: [] })),
  http.post('/api/simulator/uta/:id/tick-price', () => HttpResponse.json({ filled: [] })),
  http.post('/api/simulator/uta/:id/orders/:orderId/fill', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/orders/:orderId/cancel', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-deposit', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-withdraw', () => HttpResponse.json({ ok: true })),
  http.post('/api/simulator/uta/:id/external-trade', () => HttpResponse.json({ ok: true })),
]
