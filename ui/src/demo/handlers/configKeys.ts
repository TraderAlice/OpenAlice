import { http, HttpResponse } from 'msw'

export const configKeysHandlers = [
  http.get('/api/config/api-keys/status', () => HttpResponse.json({})),
  http.put('/api/config/apiKeys', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/config', () =>
    HttpResponse.json({
      aiProvider: { apiKeys: {}, profiles: {}, activeProfile: '' },
      engine: {},
      agent: { evolutionMode: false, claudeCode: {} },
      compaction: { maxContextTokens: 0, maxOutputTokens: 0 },
      heartbeat: { enabled: false, every: '1h', prompt: '', activeHours: null },
      snapshot: { enabled: false, every: '1h' },
      mcp: { port: 47332 },
      connectors: {
        web: { port: 47331 },
        mcpAsk: { enabled: false },
        telegram: { enabled: false, chatIds: [] },
      },
    }),
  ),

  http.get('/api/config/profiles', () =>
    HttpResponse.json({ profiles: {}, credentials: {}, activeProfile: '' }),
  ),
  http.post('/api/config/profiles', () =>
    HttpResponse.json({ slug: 'demo', profile: { backend: 'mock', model: 'demo' } }, { status: 201 }),
  ),
  http.put('/api/config/profiles/:slug', () =>
    HttpResponse.json({ slug: 'demo', profile: { backend: 'mock', model: 'demo' } }),
  ),
  http.delete('/api/config/profiles/:slug', () => HttpResponse.json({ success: true })),
  http.post('/api/config/profiles/test', () => HttpResponse.json({ ok: true })),
  http.put('/api/config/active-profile', () => HttpResponse.json({ ok: true })),

  http.get('/api/config/presets', () => HttpResponse.json({ presets: [] })),
  http.get('/api/config/sdk-adapters', () => HttpResponse.json({ adapters: [] })),

  // Credential vault (AI Provider page)
  http.get('/api/config/credentials', () => HttpResponse.json({ credentials: [] })),
  http.post('/api/config/credentials', () =>
    HttpResponse.json({ slug: 'custom-1', vendor: 'custom' }, { status: 201 }),
  ),
  http.put('/api/config/credentials/:slug', () => HttpResponse.json({ slug: 'custom-1' })),
  http.delete('/api/config/credentials/:slug', () => HttpResponse.json({ success: true })),
  http.post('/api/config/credentials/test', () => HttpResponse.json({ ok: true, response: 'Hi!' })),
]
