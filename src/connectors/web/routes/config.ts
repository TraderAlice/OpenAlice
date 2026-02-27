import { Hono } from 'hono'
import { loadConfig, writeConfigSection, readApiKeysConfig, readOpenbbConfig, type ConfigSection } from '../../../core/config.js'
import { readAIConfig, writeAIConfig, type AIProvider } from '../../../core/ai-config.js'

/** Config routes: GET /, PUT /ai-provider, PUT /:section, GET /api-keys/status */
export function createConfigRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const [config, aiConfig] = await Promise.all([loadConfig(), readAIConfig()])
      return c.json({ ...config, aiProvider: aiConfig.provider })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/ai-provider', async (c) => {
    try {
      const body = await c.req.json<{ provider?: string }>()
      const provider = body.provider
      if (provider !== 'claude-code' && provider !== 'vercel-ai-sdk') {
        return c.json({ error: 'Invalid provider. Must be "claude-code" or "vercel-ai-sdk".' }, 400)
      }
      await writeAIConfig(provider as AIProvider)
      return c.json({ provider })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/:section', async (c) => {
    try {
      const section = c.req.param('section') as ConfigSection
      const validSections: ConfigSection[] = ['engine', 'model', 'agent', 'crypto', 'securities', 'openbb', 'compaction', 'aiProvider', 'heartbeat', 'apiKeys', 'telegram']
      if (!validSections.includes(section)) {
        return c.json({ error: `Invalid section "${section}". Valid: ${validSections.join(', ')}` }, 400)
      }
      const body = await c.req.json()
      const validated = await writeConfigSection(section, body)
      return c.json(validated)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api-keys/status', async (c) => {
    try {
      const keys = await readApiKeysConfig()
      return c.json({
        anthropic: !!keys.anthropic,
        openai: !!keys.openai,
        google: !!keys.google,
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}

/** OpenBB routes: POST /test-provider */
export function createOpenbbRoutes() {
  const TEST_ENDPOINTS: Record<string, { credField: string; path: string }> = {
    fred:             { credField: 'fred_api_key',             path: '/api/v1/economy/fred_search?query=GDP&provider=fred' },
    bls:              { credField: 'bls_api_key',              path: '/api/v1/economy/survey/bls_search?query=unemployment&provider=bls' },
    eia:              { credField: 'eia_api_key',              path: '/api/v1/commodity/short_term_energy_outlook?provider=eia' },
    econdb:           { credField: 'econdb_api_key',           path: '/api/v1/economy/available_indicators?provider=econdb' },
    fmp:              { credField: 'fmp_api_key',              path: '/api/v1/equity/screener?provider=fmp&limit=1' },
    nasdaq:           { credField: 'nasdaq_api_key',           path: '/api/v1/equity/search?query=AAPL&provider=nasdaq&is_symbol=true' },
    intrinio:         { credField: 'intrinio_api_key',         path: '/api/v1/equity/search?query=AAPL&provider=intrinio&limit=1' },
    tradingeconomics: { credField: 'tradingeconomics_api_key', path: '/api/v1/economy/calendar?provider=tradingeconomics' },
  }

  const app = new Hono()

  app.post('/test-provider', async (c) => {
    try {
      const { provider, key } = await c.req.json<{ provider: string; key: string }>()
      const endpoint = TEST_ENDPOINTS[provider]
      if (!endpoint) return c.json({ ok: false, error: `Unknown provider: ${provider}` }, 400)
      if (!key) return c.json({ ok: false, error: 'No API key provided' }, 400)

      const openbbConfig = await readOpenbbConfig()
      const credHeader = JSON.stringify({ [endpoint.credField]: key })
      const url = `${openbbConfig.apiUrl}${endpoint.path}`

      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'X-OpenBB-Credentials': credHeader },
      })

      if (res.ok) return c.json({ ok: true })
      const body = await res.text().catch(() => '')
      return c.json({ ok: false, error: `OpenBB returned ${res.status}: ${body.slice(0, 200)}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ ok: false, error: msg.includes('timeout') ? 'Cannot reach OpenBB API' : msg })
    }
  })

  return app
}
