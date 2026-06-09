import { Hono } from 'hono'
import {
  loadConfig, writeConfigSection, readAIProviderConfig, validSections,
  writeProfile, deleteProfile, setActiveProfile,
  readCredentials, addCredential, deleteCredential, writeCredential, resolveCredential,
  credentialWires,
  profileSchema, credentialVendorEnum, credentialWireShapeEnum,
  type ConfigSection, type Profile, type Credential, type CredentialWireShape,
} from '../../core/config.js'

/** Validate a `{ [wireShape]: baseUrl }` body into a typed wires map. */
function parseWires(raw: unknown): Partial<Record<CredentialWireShape, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<CredentialWireShape, string>> = {}
  for (const [shape, url] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = credentialWireShapeEnum.safeParse(shape)
    if (parsed.success && typeof url === 'string') out[parsed.data] = url.trim()
  }
  return out
}
import type { EngineContext } from '../../core/types.js'
import { BUILTIN_PRESETS } from '../../ai-providers/presets.js'
import type { WireShape } from '../../ai-providers/preset-catalog.js'
import { getSdkAdapterInfo } from '../../ai-providers/sdk-adapters.js'
import { testWithProfile } from '../../core/ai-config.js'
import { resolveAnthropicAuthMode } from '../../core/credential-inference.js'
import { probeByWireShape } from '../../workspaces/agent-probe.js'

interface ConfigRouteOpts {
  ctx?: EngineContext
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

  /** GET /profiles — list profiles + credentials map + active profile slug */
  app.get('/profiles', async (c) => {
    try {
      const config = await readAIProviderConfig()
      return c.json({
        profiles: config.profiles,
        credentials: config.credentials,
        activeProfile: config.activeProfile,
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** GET /sdk-adapters — list SDK adapters with their preset associations */
  app.get('/sdk-adapters', (c) => c.json({ adapters: getSdkAdapterInfo() }))

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
      const result = await testWithProfile(opts.ctx.router, validated, 'Hi')
      return c.json({ ok: true, response: result.text })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ==================== Credential Vault ====================
  //
  // Alice's central api-key credentials — the set injected into workspaces.
  // Subscription logins (claude login / codex login) are NOT stored here; they
  // live in the CLI's own auth. The list never returns the raw key (only
  // whether one is set); Test runs the lightweight probe, not the in-process
  // provider stack.

  /**
   * GET /credentials — list central credentials. Returns the apiKey so the edit
   * form can round-trip it (same exposure as /api/workspaces/credentials and the
   * legacy agent-profiles route; all behind the admin-token gate). `hasApiKey`
   * kept for callers that only need presence.
   */
  app.get('/credentials', async (c) => {
    try {
      const creds = await readCredentials()
      const list = Object.entries(creds).map(([slug, cred]) => ({
        slug,
        vendor: cred.vendor,
        authType: cred.authType,
        wires: credentialWires(cred), // derives from legacy {baseUrl,wireShape} too
        apiKey: cred.apiKey ?? null,
        hasApiKey: !!cred.apiKey,
      }))
      return c.json({ credentials: list })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** POST /credentials — add an api-key credential (deduped by key). Returns slug. */
  app.post('/credentials', async (c) => {
    try {
      const body = await c.req.json<{ vendor?: string; wires?: unknown; apiKey?: string }>()
      const apiKey = body.apiKey?.trim()
      if (!apiKey) return c.json({ error: 'apiKey is required' }, 400)
      const vendorParse = credentialVendorEnum.safeParse(body.vendor)
      const wires = parseWires(body.wires)
      const cred: Credential = {
        vendor: vendorParse.success ? vendorParse.data : 'custom',
        authType: 'api-key',
        apiKey,
        ...(Object.keys(wires).length ? { wires } : {}),
      }
      const slug = await addCredential(cred)
      return c.json({ slug, vendor: cred.vendor }, 201)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** PUT /credentials/:slug — update a credential. Empty apiKey keeps the existing key. */
  app.put('/credentials/:slug', async (c) => {
    try {
      const slug = c.req.param('slug')
      const body = await c.req.json<{ vendor?: string; wires?: unknown; apiKey?: string }>()
      const existing = await resolveCredential(slug)
      const apiKey = body.apiKey?.trim() || existing.apiKey
      const vendorParse = credentialVendorEnum.safeParse(body.vendor)
      const wires = parseWires(body.wires)
      const cred: Credential = {
        vendor: vendorParse.success ? vendorParse.data : existing.vendor,
        authType: 'api-key',
        ...(apiKey ? { apiKey } : {}),
        ...(Object.keys(wires).length ? { wires } : { ...(existing.wires ? { wires: existing.wires } : {}) }),
      }
      await writeCredential(slug, cred)
      return c.json({ slug })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  /** DELETE /credentials/:slug — remove (errors if a profile still references it). */
  app.delete('/credentials/:slug', async (c) => {
    try {
      await deleteCredential(c.req.param('slug'))
      return c.json({ success: true })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  /**
   * POST /credentials/test — probe a credential via the shared
   * `probeByWireShape` dispatcher (same logic as the per-workspace test). For
   * the anthropic shape the auth header is auto-resolved from the baseUrl.
   */
  app.post('/credentials/test', async (c) => {
    try {
      const body = await c.req.json<{
        wireShape: WireShape
        baseUrl?: string
        apiKey: string
        model: string
        authMode?: 'x-api-key' | 'bearer'
      }>()
      if (!body.apiKey || !body.model) {
        return c.json({ ok: false, error: 'apiKey and model are required' })
      }
      const authMode = resolveAnthropicAuthMode({ authMode: body.authMode, baseUrl: body.baseUrl })
      const r = await probeByWireShape(body.wireShape, {
        baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model, authMode,
      })
      return c.json({ ok: true, response: r.text })
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
      // marketData edits are picked up lazily by the opentypebb resolver
      // (it reads ctx.config per request), so no explicit hot-reload hook
      // is needed. The old connector hot-reload path was removed with the
      // legacy connector cluster.
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
    fred:             { credField: 'federal_reserve_api_key',  provider: 'federal_reserve', model: 'FredSearch',              params: { query: 'GDP' } },
    bls:              { credField: 'bls_api_key',              provider: 'bls',              model: 'BlsSearch',               params: { query: 'unemployment' } },
    eia:              { credField: 'eia_api_key',              provider: 'eia',              model: 'ShortTermEnergyOutlook',  params: {} },
    econdb:           { credField: 'econdb_api_key',           provider: 'econdb',           model: 'AvailableIndicators',     params: {} },
    fmp:              { credField: 'fmp_api_key',              provider: 'fmp',              model: 'EquityScreener',          params: { limit: 1 } },
    intrinio:         { credField: 'intrinio_api_key',         provider: 'intrinio',         model: 'EquitySearch',            params: { query: 'AAPL', limit: 1 } },
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
