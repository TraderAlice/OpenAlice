import { Hono } from 'hono'
import {
  loadConfig,
  writeConfigSection,
  readAIProviderConfig,
  readOpenbbConfig,
  validSections,
  type Config,
  type ConfigSection,
} from '../../../core/config.js'
import { readAIConfig, writeAIConfig, type AIBackend } from '../../../core/ai-config.js'
import { normalizeGovernanceRouteRequest } from '../../../upstream-adapters/web/upstream-config-route-adapter.js'

interface ConfigRouteOpts {
  onConnectorsChange?: () => Promise<void>
}

function normalizeGovernanceAliasPayload(
  normalizedConfig: NonNullable<ReturnType<typeof normalizeGovernanceRouteRequest>>['config'],
  baseConfig: Config['governance'],
): Config['governance'] {
  return {
    ...baseConfig,
    enabled: normalizedConfig.enabled,
    fallbackConfigId: normalizedConfig.fallbackConfigId,
    releaseGate: {
      ...baseConfig.releaseGate,
      enabled: normalizedConfig.liveGate.enabled,
      maxStatusAgeHours: normalizedConfig.liveGate.releaseGateStatusAgeHoursMax,
    },
    liveGate: {
      ...baseConfig.liveGate,
      enabled: normalizedConfig.liveGate.enabled,
      quoteAgeP95MsMax: normalizedConfig.liveGate.metrics.quoteAgeP95MsMax,
      decisionToSubmitP95MsMax: normalizedConfig.liveGate.metrics.decisionToSubmitP95MsMax,
      decisionToFirstFillP95MsMax: normalizedConfig.liveGate.metrics.decisionToFirstFillP95MsMax,
    },
    statsGate: {
      ...baseConfig.statsGate,
      fdrQMax: normalizedConfig.liveGate.metrics.fdrQMax,
    },
  }
}

/** Config routes: GET /, PUT /ai-provider, PUT /:section, GET /api-keys/status */
export function createConfigRoutes(opts?: ConfigRouteOpts) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const config = await loadConfig()
      return c.json(config)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/ai-provider', async (c) => {
    try {
      const body = await c.req.json<{ backend?: string }>()
      const backend = body.backend
      if (backend !== 'claude-code' && backend !== 'vercel-ai-sdk') {
        return c.json({ error: 'Invalid backend. Must be "claude-code" or "vercel-ai-sdk".' }, 400)
      }
      await writeAIConfig(backend as AIBackend)
      return c.json({ backend })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/:section', async (c) => {
    try {
      const rawSection = c.req.param('section')
      let section = rawSection as ConfigSection
      const body = await c.req.json()
      let payload: unknown = body

      const isCanonicalGovernanceSection = rawSection.trim().toLowerCase() === 'governance'
      const normalizedGovernanceRequest = normalizeGovernanceRouteRequest({
        section: rawSection,
        body,
      })
      if (!isCanonicalGovernanceSection && normalizedGovernanceRequest) {
        const currentConfig = await loadConfig()
        section = 'governance'
        payload = normalizeGovernanceAliasPayload(
          normalizedGovernanceRequest.config,
          currentConfig.governance,
        )
      }

      if (!validSections.includes(section)) {
        return c.json({ error: `Invalid section "${rawSection}". Valid: ${validSections.join(', ')}` }, 400)
      }

      const validated = await writeConfigSection(section, payload)
      // Hot-reload connectors when their config changes
      if (section === 'connectors') {
        await opts?.onConnectorsChange?.()
      }
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
      const config = await readAIProviderConfig()
      return c.json({
        anthropic: !!config.apiKeys.anthropic,
        openai: !!config.apiKeys.openai,
        google: !!config.apiKeys.google,
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
