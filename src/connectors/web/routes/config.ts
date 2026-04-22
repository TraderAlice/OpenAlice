import { Hono } from 'hono'
import {
  loadConfig, writeConfigSection, readAIProviderConfig, validSections,
  writeProfile, deleteProfile, setActiveProfile,
  profileSchema, type ConfigSection, type Profile,
} from '../../../core/config.js'
import type { EngineContext } from '../../../core/types.js'
import { BUILTIN_PRESETS } from '../../../ai-providers/presets.js'

interface ConfigRouteOpts {
  ctx?: EngineContext
  onConnectorsChange?: () => Promise<void>
}

/** Config routes: GET /, PUT /:section, profile CRUD, presets, test */
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

  // ==================== Profile CRUD ====================

  /** GET /profiles — list all profiles */
  app.get('/profiles', async (c) => {
    try {
      const config = await readAIProviderConfig()
      return c.json({ profiles: config.profiles, activeProfile: config.activeProfile })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** POST /profiles — create a new profile */
  app.post('/profiles', async (c) => {
    try {
      const body = await c.req.json<{ slug: string; profile: Profile }>()
      if (!body.slug?.trim()) {
        return c.json({ error: 'Profile name is required' }, 400)
      }
      const config = await readAIProviderConfig()
      if (config.profiles[body.slug]) {
        return c.json({ error: 'profile slug already exists' }, 409)
      }
      const validated = profileSchema.parse(body.profile)
      await writeProfile(body.slug, validated)
      return c.json({ slug: body.slug, profile: validated }, 201)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  /** PUT /profiles/:slug — update a profile */
  app.put('/profiles/:slug', async (c) => {
    try {
      const slug = c.req.param('slug')
      const body = await c.req.json<Profile>()
      const validated = profileSchema.parse(body)
      await writeProfile(slug, validated)
      return c.json({ slug, profile: validated })
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  /** DELETE /profiles/:slug — delete a profile */
  app.delete('/profiles/:slug', async (c) => {
    try {
      const slug = c.req.param('slug')
      await deleteProfile(slug)
      return c.json({ success: true })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  /** PUT /active-profile — set the active profile */
  app.put('/active-profile', async (c) => {
    try {
      const { slug } = await c.req.json<{ slug: string }>()
      await setActiveProfile(slug)
      return c.json({ activeProfile: slug })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  // ==================== Presets ====================

  /** GET /presets — built-in preset templates for profile creation */
  app.get('/presets', (c) => c.json({ presets: BUILTIN_PRESETS }))

  // ==================== Profile Test ====================

  /** POST /profiles/test — test profile config by sending "Hi" (without saving) */
  app.post('/profiles/test', async (c) => {
    if (!opts?.ctx) return c.json({ ok: false, error: 'Test not available' }, 500)
    try {
      const profileData = await c.req.json<Profile>()
      const validated = profileSchema.parse(profileData)
      const result = await opts.ctx.agentCenter.testWithProfile(validated, 'Hi')
      return c.json({ ok: true, response: result.text })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ==================== Generic Section Writer ====================

  app.put('/:section', async (c) => {
    try {
      const section = c.req.param('section') as ConfigSection
      if (!validSections.includes(section)) {
        return c.json({ error: `Invalid section "${section}". Valid: ${validSections.join(', ')}` }, 400)
      }
      const body = await c.req.json()
      const validated = await writeConfigSection(section, body)
      // Keep the in-memory ctx.config in sync with disk so any code path
      // reading it (opentypebb resolver, market-data helpers, …) picks up
      // edits without a restart. Object.assign preserves ctx.config's
      // object identity — we just swap its contents.
      if (opts?.ctx) {
        const fresh = await loadConfig()
        Object.assign(opts.ctx.config, fresh)
      }
      // Hot-reload connectors / OpenBB server when their config changes
      if (section === 'connectors' || section === 'marketData') {
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

  return app
}

/** Market data routes: POST /test-provider */
export function createMarketDataRoutes(ctx: EngineContext) {
  const TEST_ENDPOINTS: Record<string, { credField: string; provider: string; model: string; params: Record<string, unknown> }> = {
    fred:             { credField: 'federal_reserve_api_key', provider: 'federal_reserve',  model: 'FredSearch',              params: { query: 'GDP' } },
    bls:              { credField: 'bls_api_key',              provider: 'bls',              model: 'BlsSearch',               params: { query: 'unemployment' } },
    eia:              { credField: 'eia_api_key',              provider: 'eia',              model: 'ShortTermEnergyOutlook',  params: {} },
    econdb:           { credField: 'econdb_api_key',           provider: 'econdb',           model: 'AvailableIndicators',     params: {} },
    fmp:              { credField: 'fmp_api_key',              provider: 'fmp',              model: 'EquitySearch',           params: { query: 'AAPL', is_symbol: true, limit: 1 } },
    nasdaq:           { credField: 'nasdaq_api_key',           provider: 'nasdaq',           model: 'EquitySearch',            params: { query: 'AAPL', is_symbol: true } },
    intrinio:         { credField: 'intrinio_api_key',         provider: 'intrinio',         model: 'EquitySearch',            params: { query: 'AAPL', limit: 1 } },
    tradingeconomics: { credField: 'tradingeconomics_api_key', provider: 'tradingeconomics', model: 'EconomicCalendar',        params: {} },
  }

  const app = new Hono()

  app.post('/test-provider', async (c) => {
    try {
      const { provider, key } = await c.req.json<{ provider: string; key: string }>()
      const endpoint = TEST_ENDPOINTS[provider]
      if (!endpoint) return c.json({ ok: false, error: `Unknown provider: ${provider}` }, 400)
      if (!key) return c.json({ ok: false, error: 'No API key provided' }, 400)

      const result = await ctx.bbEngine.execute(
        endpoint.provider, endpoint.model, endpoint.params,
        { [endpoint.credField]: key },
      )
      const data = result as unknown[]
      if (data && data.length > 0) return c.json({ ok: true })
      return c.json({ ok: false, error: 'API returned empty data — key may be invalid or endpoint restricted' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ ok: false, error: msg })
    }
  })

  return app
}
