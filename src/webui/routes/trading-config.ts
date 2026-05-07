import { Hono } from 'hono'
import type { EngineContext } from '../../core/types.js'
import {
  readUTAsConfig, writeUTAsConfig,
  utaConfigSchema, wipeUTATradingData,
} from '../../core/config.js'
import { createBroker } from '../../domain/trading/brokers/factory.js'
import { BUILTIN_BROKER_PRESETS } from '../../domain/trading/brokers/presets.js'
import { deriveUtaId, getBrokerPreset, mintInstanceId } from '../../domain/trading/brokers/preset-catalog.js'

// ==================== Credential helpers ====================

/** Mask a secret string: show last 4 chars, prefix with "****" */
function mask(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

/** Field names that contain sensitive values. Convention-based, not hardcoded per broker. */
const SENSITIVE = /key|secret|password|token/i

/** Mask all sensitive string fields in a config object (recurses into nested objects). */
function maskSecrets<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj }
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'string' && v.length > 0 && SENSITIVE.test(k)) {
      ;(result as Record<string, unknown>)[k] = mask(v)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      ;(result as Record<string, unknown>)[k] = maskSecrets(v as Record<string, unknown>)
    }
  }
  return result
}

/** Restore masked values (****...) from existing config (recurses into nested objects). */
function unmaskSecrets(
  body: Record<string, unknown>,
  existing: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && v.startsWith('****') && typeof existing[k] === 'string') {
      body[k] = existing[k]
    } else if (v && typeof v === 'object' && !Array.isArray(v) && existing[k] && typeof existing[k] === 'object') {
      unmaskSecrets(v as Record<string, unknown>, existing[k] as Record<string, unknown>)
    }
  }
}

// ==================== Routes ====================

/** Trading config CRUD routes: accounts */
export function createTradingConfigRoutes(ctx: EngineContext) {
  const app = new Hono()

  // ==================== Broker presets (for the wizard) ====================

  app.get('/broker-presets', (c) => {
    return c.json({ presets: BUILTIN_BROKER_PRESETS })
  })

  // ==================== Read all ====================

  app.get('/', async (c) => {
    try {
      const utas = await readUTAsConfig()
      const maskedUTAs = utas.map((a) => maskSecrets({ ...a }))
      return c.json({ utas: maskedUTAs })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== UTA CRUD ====================

  /**
   * POST /uta — create a new UTA. Client supplies presetId + presetConfig
   * (+ optional label/guards). The id is derived from the preset's
   * fingerprintFields (deterministic broker identity) and assigned by
   * the server. Mock presets get a freshly-minted `_instanceId` if the
   * client didn't include one. 409 if an existing UTA already derives
   * to the same id (so re-adding the same broker doesn't silently fork).
   */
  app.post('/uta', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>
      if (!body.presetId || typeof body.presetId !== 'string') {
        return c.json({ error: 'presetId is required' }, 400)
      }

      let preset
      try {
        preset = getBrokerPreset(body.presetId)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
      }

      // Mint _instanceId for Mock presets so each sim has a unique fingerprint.
      const presetConfig = { ...(body.presetConfig as Record<string, unknown> | undefined ?? {}) }
      if (preset.engine === 'mock' && !presetConfig._instanceId) {
        presetConfig._instanceId = mintInstanceId()
      }

      const id = deriveUtaId(preset, presetConfig)
      const accounts = await readUTAsConfig()
      const existing = accounts.find((a) => a.id === id)
      if (existing) {
        return c.json({
          error: 'A UTA already exists for this broker identity',
          existing: {
            id: existing.id,
            label: existing.label ?? existing.id,
            presetId: existing.presetId,
          },
        }, 409)
      }

      const candidate = {
        id,
        label: typeof body.label === 'string' && body.label ? body.label : id,
        presetId: preset.id,
        enabled: body.enabled !== false,
        guards: Array.isArray(body.guards) ? body.guards : [],
        presetConfig,
        ...(body.ephemeral === true ? { ephemeral: true as const } : {}),
      }
      const validated = utaConfigSchema.parse(candidate)
      accounts.push(validated)
      await writeUTAsConfig(accounts)

      ctx.utaManager.reconnectUTA(id).catch(() => {})
      return c.json(validated, 201)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * PUT /uta/:id — edit an existing UTA. Will NOT create a new one; new
   * UTAs go through POST /uta which derives the id from credentials.
   * Edits keep the original id even when credentials change (rotation
   * is a normal user action; id is set at origin and immutable).
   */
  app.put('/uta/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json()
      if (body.id !== id) {
        return c.json({ error: 'Body id must match URL id' }, 400)
      }

      const accounts = await readUTAsConfig()
      const existing = accounts.find((a) => a.id === id)
      if (!existing) {
        return c.json({
          error: `UTA "${id}" not found. Use POST /uta to create a new account.`,
        }, 422)
      }

      // Restore masked credentials from existing config
      unmaskSecrets(body, existing as unknown as Record<string, unknown>)

      const validated = utaConfigSchema.parse(body)
      const idx = accounts.findIndex((a) => a.id === id)
      accounts[idx] = validated
      await writeUTAsConfig(accounts)

      // Handle enabled state changes at runtime
      const wasEnabled = existing.enabled !== false
      const nowEnabled = validated.enabled !== false
      if (wasEnabled && !nowEnabled) {
        await ctx.utaManager.removeUTA(id)
      } else if (!wasEnabled && nowEnabled) {
        ctx.utaManager.reconnectUTA(id).catch(() => {})
      } else if (wasEnabled && nowEnabled) {
        // Same enabled state but credentials may have changed (rotation) —
        // bounce the account so the new credentials take effect.
        ctx.utaManager.reconnectUTA(id).catch(() => {})
      }

      return c.json(validated)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.delete('/uta/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const accounts = await readUTAsConfig()
      const target = accounts.find((a) => a.id === id)
      if (!target) {
        return c.json({ error: `Account "${id}" not found` }, 404)
      }
      const filtered = accounts.filter((a) => a.id !== id)
      await writeUTAsConfig(filtered)
      // Close and deregister running account instance if any
      await ctx.utaManager.removeUTA(id)
      // Ephemeral UTAs also have their persistent trading state wiped — the
      // whole point of `ephemeral: true` is that nothing about the test
      // account survives its destruction. Real broker UTAs keep their
      // commit history (delete-from-config means "stop trading from here",
      // not "erase what already happened").
      if (target.ephemeral) {
        await wipeUTATradingData(id)
      }
      return c.json({ success: true, ephemeral: target.ephemeral === true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Test Connection ====================

  app.post('/test-connection', async (c) => {
    let broker: {
      init: () => Promise<void>
      getAccount: () => Promise<unknown>
      getPositions: () => Promise<unknown>
      close: () => Promise<void>
    } | null = null
    try {
      const body = await c.req.json()
      const utaConfig = utaConfigSchema.parse({ ...body, id: body.id ?? '__test__' })

      broker = createBroker(utaConfig)
      await broker.init()
      // Run both calls in parallel — getAccount proves auth, getPositions
      // exercises the data path the user actually cares about (e.g. for OKX
      // UTA, this is what surfaces spot holdings via fetchSpotHoldings).
      const [account, positions] = await Promise.all([
        broker.getAccount(),
        broker.getPositions(),
      ])
      return c.json({ success: true, account, positions })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ success: false, error: msg }, 400)
    } finally {
      try { await broker?.close() } catch { /* best effort */ }
    }
  })

  return app
}
