import { http, HttpResponse } from 'msw'

export const configKeysHandlers = [
  http.get('/api/config/api-keys/status', () => HttpResponse.json({})),
  http.put('/api/config/apiKeys', () => new HttpResponse(null, { status: 204 })),
  // Echo the body back — the real route returns the validated section,
  // and useConfigPage adopts the echo, so `{}` here would wipe the page.
  http.put('/api/config/marketData', async ({ request }) => HttpResponse.json(await request.json())),
  http.put('/api/config/trading', async ({ request }) => HttpResponse.json(await request.json())),
  http.put('/api/config/snapshot', async ({ request }) => HttpResponse.json(await request.json())),

  http.get('/api/config', () =>
    HttpResponse.json({
      aiProvider: { apiKeys: {}, profiles: {}, activeProfile: '' },
      engine: {},
      agent: { allowAiTrading: false, claudeCode: {} },
      compaction: { maxContextTokens: 0, maxOutputTokens: 0 },
      snapshot: { enabled: false, every: '1h' },
      trading: { observeExternalOrdersEvery: '15m' },
      mcp: { enabled: false, port: 47332 },
      marketData: {
        enabled: true,
        providers: { equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', commodity: 'yfinance' },
        extraVendors: [],
        providerKeys: {},
        hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      },
      ports: { web: 47331 },
    }),
  ),

  http.get('/api/config/presets', () => HttpResponse.json({ presets: [] })),

  // Credential vault (AI Provider page) — a small representative set so the
  // page (and the per-agent default pickers) render with content in the demo.
  http.get('/api/config/credentials', () =>
    HttpResponse.json({
      credentials: [
        { slug: 'anthropic-1', vendor: 'anthropic', label: 'Anthropic', authType: 'api-key', wires: { anthropic: '' }, apiKey: null, hasApiKey: true },
        { slug: 'openai-1', vendor: 'openai', label: 'OpenAI', authType: 'api-key', wires: { 'openai-responses': '', 'openai-chat': '' }, apiKey: null, hasApiKey: true },
      ],
    }),
  ),
  http.post('/api/config/credentials', () =>
    HttpResponse.json({ slug: 'custom-1', vendor: 'custom' }, { status: 201 }),
  ),
  http.put('/api/config/credentials/:slug', () => HttpResponse.json({ slug: 'custom-1' })),
  http.delete('/api/config/credentials/:slug', () => HttpResponse.json({ success: true })),
  http.post('/api/config/credentials/test', () => HttpResponse.json({ ok: true, response: 'Hi!' })),

  // Per-agent new Workspace provider defaults (AI Provider page)
  http.get('/api/config/workspace-credential-defaults', () =>
    HttpResponse.json({
      defaults: { opencode: { credentialSlug: 'openai-1', contextWindow: 256_000 } },
      compatibleByAgent: {
        claude: ['anthropic-1'],
        codex: ['openai-1'],
        opencode: ['anthropic-1', 'openai-1'],
        pi: ['anthropic-1', 'openai-1'],
      },
    }),
  ),
  http.put('/api/config/workspace-credential-defaults', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { defaults?: unknown }
    return HttpResponse.json({ defaults: body.defaults ?? {} })
  }),

  http.get('/api/config/workspace-default-agent', () => HttpResponse.json({ agent: 'claude' })),
  http.put('/api/config/workspace-default-agent', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { agent?: unknown }
    return HttpResponse.json({ agent: typeof body.agent === 'string' ? body.agent : null })
  }),
  http.get('/api/config/issue-default-agent', () => HttpResponse.json({ agent: 'pi' })),
  http.put('/api/config/issue-default-agent', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { agent?: unknown }
    return HttpResponse.json({ agent: typeof body.agent === 'string' ? body.agent : null })
  }),
]
