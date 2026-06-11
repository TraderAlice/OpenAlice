import { http, HttpResponse } from 'msw'

export const configKeysHandlers = [
  http.get('/api/config/api-keys/status', () => HttpResponse.json({})),
  http.put('/api/config/apiKeys', () => new HttpResponse(null, { status: 204 })),
  // Echo the body back — the real route returns the validated section,
  // and useConfigPage adopts the echo, so `{}` here would wipe the page.
  http.put('/api/config/marketData', async ({ request }) => HttpResponse.json(await request.json())),
  http.put('/api/config/trading', async ({ request }) => HttpResponse.json(await request.json())),

  http.get('/api/config', () =>
    HttpResponse.json({
      aiProvider: { apiKeys: {}, profiles: {}, activeProfile: '' },
      engine: {},
      agent: { evolutionMode: false, claudeCode: {} },
      compaction: { maxContextTokens: 0, maxOutputTokens: 0 },
      snapshot: { enabled: false, every: '1h' },
      trading: { observeExternalOrdersEvery: '15m' },
      mcp: { port: 47332 },
      marketData: {
        enabled: true,
        providers: { equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', commodity: 'yfinance' },
        providerKeys: {},
        hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      },
      connectors: {
        web: { port: 47331 },
        mcpAsk: { enabled: false },
        telegram: { enabled: false, chatIds: [] },
      },
    }),
  ),

  http.get('/api/config/presets', () => HttpResponse.json({ presets: [] })),

  // Credential vault (AI Provider page)
  http.get('/api/config/credentials', () => HttpResponse.json({ credentials: [] })),
  http.post('/api/config/credentials', () =>
    HttpResponse.json({ slug: 'custom-1', vendor: 'custom' }, { status: 201 }),
  ),
  http.put('/api/config/credentials/:slug', () => HttpResponse.json({ slug: 'custom-1' })),
  http.delete('/api/config/credentials/:slug', () => HttpResponse.json({ success: true })),
  http.post('/api/config/credentials/test', () => HttpResponse.json({ ok: true, response: 'Hi!' })),
]
