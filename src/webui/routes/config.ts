import { Hono } from 'hono'
import {
  loadConfig, writeConfigSection, validSections,
  readCredentials, addCredential, deleteCredential, writeCredential, resolveCredential,
  credentialWires,
  readWorkspaceCredentialDefaults, writeWorkspaceCredentialDefaults,
  readWorkspaceDefaultAgent, writeWorkspaceDefaultAgent,
  credentialVendorEnum, credentialWireShapeEnum,
  type ConfigSection, type Credential, type CredentialWireShape,
  type WorkspaceCredentialDefault,
} from '../../core/config.js'
import { compatibleCredentials } from '../../workspaces/credential-injection.js'

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
import { triggerUTARestart } from '../../services/uta-supervisor/restart-trigger.js'
import { BUILTIN_PRESETS } from '../../ai-providers/presets.js'
import type { WireShape } from '../../ai-providers/preset-catalog.js'
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

  // ==================== Presets ====================

  /** GET /presets — built-in preset suggestions for the credential vault form */
  app.get('/presets', (c) => c.json({ presets: BUILTIN_PRESETS }))

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

  // ============ Default Workspace Credentials (per-agent) ============
  //
  // The user-level "inject my usual key on every new workspace" setting. A
  // per-agent map of {credentialSlug, model?} that the workspace creator seeds
  // into each new workspace's file-based AI config at create time — sparing the
  // user the per-workspace AI-config modal. References the vault above.

  const DEFAULTABLE_AGENTS = ['claude', 'codex', 'opencode', 'pi'] as const

  /**
   * GET /workspace-credential-defaults — the current per-agent defaults plus,
   * for the picker, the vault slugs each agent can actually be driven by (the
   * wire-shape funnel computed server-side, so the UI stays dumb).
   */
  app.get('/workspace-credential-defaults', async (c) => {
    try {
      const [defaults, creds] = await Promise.all([
        readWorkspaceCredentialDefaults(),
        readCredentials(),
      ])
      const compatibleByAgent: Record<string, string[]> = {}
      for (const agent of DEFAULTABLE_AGENTS) {
        compatibleByAgent[agent] = compatibleCredentials(creds, agent).map(([slug]) => slug)
      }
      return c.json({ defaults, compatibleByAgent })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * PUT /workspace-credential-defaults — replace the whole per-agent map. Body:
   * `{ defaults: { [agentId]: { credentialSlug, model? } } }`. An empty/absent
   * `credentialSlug` for an agent clears its default (handled in the writer).
   */
  app.put('/workspace-credential-defaults', async (c) => {
    try {
      const body = await c.req.json<{ defaults?: Record<string, WorkspaceCredentialDefault> }>()
      const incoming = body.defaults ?? {}
      const next: Record<string, WorkspaceCredentialDefault> = {}
      for (const agent of DEFAULTABLE_AGENTS) {
        const def = incoming[agent]
        if (def && typeof def.credentialSlug === 'string' && def.credentialSlug) {
          next[agent] = {
            credentialSlug: def.credentialSlug,
            ...(typeof def.model === 'string' && def.model ? { model: def.model } : {}),
          }
        }
      }
      await writeWorkspaceCredentialDefaults(next)
      return c.json({ defaults: next })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  app.get('/workspace-default-agent', async (c) => {
    try {
      return c.json({ agent: await readWorkspaceDefaultAgent() })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/workspace-default-agent', async (c) => {
    try {
      const body = await c.req.json<{ agent?: string | null }>()
      const agent = typeof body.agent === 'string' && DEFAULTABLE_AGENTS.includes(body.agent as typeof DEFAULTABLE_AGENTS[number])
        ? body.agent
        : null
      await writeWorkspaceDefaultAgent(agent)
      return c.json({ agent })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
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
      // trading.json is consumed by the UTA process at boot (order-sync
      // poller cadence) — bounce UTA via the Guardian flag protocol, same
      // as broker config edits. Fire-and-forget: progress is visible
      // through the health badges.
      if (section === 'trading') {
        triggerUTARestart().catch(() => { /* surfaced via health badges */ })
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

/** Market data routes: POST /test-provider, GET /hub-status */
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

  // Liveness ping for the settings page's hub status dot. Hits the hub's
  // cheapest parameterless endpoint (fx-rates, Redis-cached hourly) and
  // shape-checks the envelope — mirrors the trust boundary in
  // domain/market-data/reference/hub.ts: hub responses are data, never
  // configuration. `baseUrl` query override lets the UI probe an edited
  // URL before the debounced config save lands.
  app.get('/hub-status', async (c) => {
    const hub = ctx.config.marketData.hub
    const baseUrl = (c.req.query('baseUrl') || hub.baseUrl).replace(/\/+$/, '')
    if (!hub.enabled) return c.json({ enabled: false, baseUrl, reachable: false })
    try {
      const res = await fetch(`${baseUrl}/api/data/fx-rates`, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return c.json({ enabled: true, baseUrl, reachable: false })
      const data: unknown = await res.json().catch(() => null)
      const reachable = typeof data === 'object' && data !== null && 'meta' in data
      return c.json({ enabled: true, baseUrl, reachable })
    } catch {
      return c.json({ enabled: true, baseUrl, reachable: false })
    }
  })

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
