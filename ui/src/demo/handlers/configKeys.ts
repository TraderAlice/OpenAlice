import { http, HttpResponse } from 'msw'
import type { Preset } from '../../api/types'

const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')
  ?? (request.referrer ? new URL(request.referrer).searchParams.get('themeAuditFixture') : null)
const auditCredentialPreset: Preset = {
  id: 'audit-openai', label: 'Audit OpenAI', description: 'Typed audit credential fixture', category: 'official',
  defaultName: 'Audit OpenAI', schema: { type: 'object', properties: {
    apiKey: { type: 'string', writeOnly: true },
    model: { type: 'string', oneOf: [{ const: 'gpt-audit', title: 'GPT Audit' }] },
  } },
  regions: [{ id: 'official', label: 'Official', wires: { 'openai-responses': '' } }],
}

export const configKeysHandlers = [
  http.get('/api/config/api-keys/status', () => HttpResponse.json({})),
  http.put('/api/config/apiKeys', () => new HttpResponse(null, { status: 204 })),
  // Echo the body back — the real route returns the validated section,
  // and useConfigPage adopts the echo, so `{}` here would wipe the page.
  http.put('/api/config/marketData', async ({ request }) => HttpResponse.json(await request.json())),
  http.put('/api/config/trading', async ({ request }) => {
    const body = await request.json()
    if (auditFixture(request) === 'first-run-no-uta') await new Promise((resolve) => setTimeout(resolve, 2_000))
    return HttpResponse.json(body)
  }),
  http.put('/api/config/snapshot', async ({ request }) => HttpResponse.json(await request.json())),

  http.get('/api/config', ({ request }) =>
    HttpResponse.json({
      aiProvider: { apiKeys: {}, profiles: {}, activeProfile: '' },
      engine: {},
      agent: { allowAiTrading: auditFixture(request) === 'agent-permissions-warning', claudeCode: {} },
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

  http.get('/api/config/presets', ({ request }) => HttpResponse.json({ presets: auditFixture(request) === 'credential-test' ? [auditCredentialPreset] : [] })),

  // Credential vault (AI Provider page) — a small representative set so the
  // page (and the per-agent default pickers) render with content in the demo.
  http.get('/api/config/credentials', ({ request }) =>
    HttpResponse.json({
      credentials: auditFixture(request) === 'first-run-incomplete' ? [] : [
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

  // Per-agent default workspace credentials (AI Provider page)
  http.get('/api/config/workspace-credential-defaults', () =>
    HttpResponse.json({
      defaults: { opencode: { credentialSlug: 'openai-1' } },
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

  http.get('/api/config/workspace-default-agent', ({ request }) => HttpResponse.json({ agent: auditFixture(request) === 'chat-no-creds' ? 'opencode' : 'claude' })),
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
