import { http, HttpResponse } from 'msw'

export const demoCredentialPresets = [
  {
    id: 'claude-api',
    label: 'Claude (API Key)',
    description: 'Pay per token via Anthropic API',
    category: 'official',
    defaultName: 'Claude (API Key)',
    hint: 'Opus is the recommended complex-agent default; Sonnet balances capability and cost, while Fable is the highest-capability premium tier.',
    setup: {
      apiKeyLabel: 'Anthropic API key',
      apiKeyPlaceholder: 'sk-ant-...',
      apiKeyHelp: 'Use a key from Anthropic Console. Claude Pro/Max is a separate Claude Code login.',
      modelHelp: 'Choose an Anthropic API model ID, or paste another exact ID.',
    },
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5 (Highest capability)', semantics: { contextWindow: 1_000_000, reasoning: { mode: 'required', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' } } },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Complex agents)', semantics: { contextWindow: 1_000_000, reasoning: { mode: 'adaptive', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', interleaved: true } } },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (Balanced)', semantics: { contextWindow: 1_000_000, reasoning: { mode: 'adaptive', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', interleaved: true } } },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Fastest)', semantics: { contextWindow: 200_000, reasoning: { mode: 'optional', interleaved: true } } },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Previous generation)', semantics: { contextWindow: 1_000_000, reasoning: { mode: 'adaptive', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', interleaved: true } } },
    ],
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
        model: {
          type: 'string',
          default: 'claude-opus-4-8',
          oneOf: [
            { const: 'claude-fable-5', title: 'Claude Fable 5 (Highest capability)' },
            { const: 'claude-opus-4-8', title: 'Claude Opus 4.8 (Complex agents)' },
            { const: 'claude-sonnet-5', title: 'Claude Sonnet 5 (Balanced)' },
            { const: 'claude-haiku-4-5', title: 'Claude Haiku 4.5 (Fastest)' },
            { const: 'claude-sonnet-4-6', title: 'Claude Sonnet 4.6 (Previous generation)' },
          ],
        },
      },
    },
    regions: [{ id: 'official', label: 'Official (api.anthropic.com)', wires: { anthropic: '' } }],
  },
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
      modelHelp: 'Choose a model enabled for this API project, or paste another exact ID.',
    },
    models: [
      { id: 'gpt-5.6', label: 'GPT 5.6 (Sol alias)', semantics: { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: { mode: 'optional', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' } } },
      { id: 'gpt-5.6-terra', label: 'GPT 5.6 Terra (Balanced)', semantics: { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: { mode: 'optional', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' } } },
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna (Cost-efficient)', semantics: { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: { mode: 'optional', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' } } },
      { id: 'gpt-5.5', label: 'GPT 5.5 (Previous generation)', semantics: { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: { mode: 'optional', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' } } },
      { id: 'gpt-5.4', label: 'GPT 5.4 (Previous generation)', semantics: { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: { mode: 'optional', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'none' } } },
    ],
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
        model: {
          type: 'string',
          default: 'gpt-5.6',
          oneOf: [
            { const: 'gpt-5.6', title: 'GPT 5.6 (Sol alias)' },
            { const: 'gpt-5.6-terra', title: 'GPT 5.6 Terra (Balanced)' },
            { const: 'gpt-5.6-luna', title: 'GPT 5.6 Luna (Cost-efficient)' },
            { const: 'gpt-5.5', title: 'GPT 5.5 (Previous generation)' },
            { const: 'gpt-5.4', title: 'GPT 5.4 (Previous generation)' },
          ],
        },
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
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Stable)', semantics: { contextWindow: 1_048_576, maxOutputTokens: 65_536, reasoning: { mode: 'adaptive', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' } } },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview, paid)', semantics: { contextWindow: 1_048_576, maxOutputTokens: 65_536, reasoning: { mode: 'adaptive', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' } } },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Stable)', semantics: { contextWindow: 1_048_576, maxOutputTokens: 65_536, reasoning: { mode: 'adaptive', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'minimal' } } },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Previous generation)', semantics: { contextWindow: 1_048_576, reasoning: { mode: 'required' } } },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Previous generation)', semantics: { contextWindow: 1_048_576, reasoning: { mode: 'optional' } } },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Previous generation)', semantics: { contextWindow: 1_048_576, reasoning: { mode: 'optional' } } },
    ],
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
        { slug: 'openai-1', vendor: 'openai', label: 'OpenAI', authType: 'api-key', wires: { 'openai-responses': '', 'openai-chat': '' }, apiKey: null, hasApiKey: true, lastModel: 'gpt-5.6' },
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
    }),
  ),
  http.put('/api/config/workspace-credential-defaults', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { defaults?: unknown }
    return HttpResponse.json({
      defaults: body.defaults ?? {},
    })
  }),

  http.get('/api/config/workspace-default-agent', () => HttpResponse.json({ agent: 'pi' })),
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
