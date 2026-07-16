import { http, HttpResponse } from 'msw'

const demoCredentialPresets = [
  {
    id: 'codex-api',
    label: 'OpenAI (API Key)',
    description: 'Pay per token via OpenAI API',
    category: 'official',
    defaultName: 'OpenAI (API Key)',
    setup: {
      apiKeyLabel: 'OpenAI API key',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHelp: 'Use an OpenAI Platform API key. A ChatGPT subscription is a separate Codex CLI login.',
      modelHelp: 'Choose a model enabled for this API project.',
    },
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
        model: { type: 'string', default: 'gpt-5.5', oneOf: [{ const: 'gpt-5.5', title: 'GPT 5.5' }] },
      },
    },
    regions: [{ id: 'official', label: 'OpenAI (api.openai.com)', wires: { 'openai-responses': '', 'openai-chat': '' } }],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Google AI via API key',
    category: 'third-party',
    defaultName: 'Google Gemini',
    hint: 'OpenAlice uses Google’s native Gemini API. AQ and AIza credentials work with Pi and opencode.',
    setup: {
      apiKeyLabel: 'Google AI API key',
      apiKeyPlaceholder: 'AQ... or AIza...',
      apiKeyHelp: 'Use a Gemini API key from Google AI Studio. AQ and AIza keys are supported.',
      modelHelp: 'Choose a Gemini model exposed by Google’s native API.',
    },
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
        model: {
          type: 'string',
          default: 'gemini-3.1-flash-lite',
          oneOf: [
            { const: 'gemini-3.5-flash', title: 'Gemini 3.5 Flash (Stable)' },
            { const: 'gemini-3.1-pro-preview', title: 'Gemini 3.1 Pro (Preview, paid)' },
            { const: 'gemini-3.1-flash-lite', title: 'Gemini 3.1 Flash-Lite (Stable)' },
            { const: 'gemini-2.5-pro', title: 'Gemini 2.5 Pro (Previous generation)' },
            { const: 'gemini-2.5-flash', title: 'Gemini 2.5 Flash (Previous generation)' },
            { const: 'gemini-2.5-flash-lite', title: 'Gemini 2.5 Flash-Lite (Previous generation)' },
          ],
        },
      },
    },
    regions: [{ id: 'default', label: 'Google', wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' } }],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Full control — any compatible provider, model, and endpoint',
    category: 'custom',
    defaultName: '',
    setup: {
      apiKeyLabel: 'Endpoint API key',
      apiKeyHelp: 'Use a key accepted by this endpoint.',
      modelHelp: 'Enter the exact model ID exposed by the endpoint.',
    },
    schema: { type: 'object', properties: { apiKey: { type: 'string' }, model: { type: 'string' } } },
  },
]

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

  http.get('/api/config/presets', () => HttpResponse.json({ presets: demoCredentialPresets })),

  // Credential vault (AI Provider page) — a small representative set so the
  // page (and the per-agent default pickers) render with content in the demo.
  http.get('/api/config/credentials', () =>
    HttpResponse.json({
      credentials: [
        { slug: 'anthropic-1', vendor: 'anthropic', label: 'Anthropic', authType: 'api-key', wires: { anthropic: '' }, apiKey: null, hasApiKey: true, lastModel: 'claude-opus-4-8' },
        { slug: 'openai-1', vendor: 'openai', label: 'OpenAI', authType: 'api-key', wires: { 'openai-responses': '', 'openai-chat': '' }, apiKey: null, hasApiKey: true, lastModel: 'gpt-5.5' },
      ],
    }),
  ),
  http.post('/api/config/credentials', () =>
    HttpResponse.json({ slug: 'custom-1', vendor: 'custom' }, { status: 201 }),
  ),
  http.put('/api/config/credentials/:slug', () => HttpResponse.json({ slug: 'custom-1' })),
  http.delete('/api/config/credentials/:slug', () => HttpResponse.json({ success: true })),
  http.post('/api/config/credentials/test', () => HttpResponse.json({ ok: true, response: 'Hi!' })),

  // Per-agent default workspace credentials (AI Provider page)
  http.get('/api/config/workspace-credential-defaults', () =>
    HttpResponse.json({
      defaults: { opencode: { credentialSlug: 'openai-1', wireShape: 'openai-chat' } },
      compatibleByAgent: {
        claude: ['anthropic-1'],
        codex: ['openai-1'],
        opencode: ['anthropic-1', 'openai-1'],
        pi: ['anthropic-1', 'openai-1'],
      },
      contextWindow: 256_000,
    }),
  ),
  http.put('/api/config/workspace-credential-defaults', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { defaults?: unknown; contextWindow?: unknown }
    return HttpResponse.json({
      defaults: body.defaults ?? {},
      contextWindow: typeof body.contextWindow === 'number' ? body.contextWindow : 256_000,
    })
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
