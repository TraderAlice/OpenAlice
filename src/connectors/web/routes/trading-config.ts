import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'
import {
  readPlatformsConfig, writePlatformsConfig,
  readAccountsConfig, writeAccountsConfig,
  platformConfigSchema, accountConfigSchema,
} from '../../../core/config.js'
import { createPlatformFromConfig, createBrokerFromConfig } from '../../../domain/trading/brokers/factory.js'

/** Mask a secret string: show last 4 chars, prefix with "****" */
function mask(value: string | undefined): string | undefined {
  if (!value) return value
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

/** Trading config CRUD routes: platforms + accounts */
export function createTradingConfigRoutes(ctx: EngineContext) {
  const app = new Hono()

  // ==================== Read all ====================

  app.get('/', async (c) => {
    try {
      const [platforms, accounts] = await Promise.all([
        readPlatformsConfig(),
        readAccountsConfig(),
      ])
      // Mask credentials in response
      const maskedAccounts = accounts.map((a) => ({
        ...a,
        apiKey: mask(a.apiKey),
        apiSecret: mask(a.apiSecret),
        password: mask(a.password),
      }))
      return c.json({ platforms, accounts: maskedAccounts })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Platforms CRUD ====================

  app.put('/platforms/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json()
      if (body.id !== id) {
        return c.json({ error: 'Body id must match URL id' }, 400)
      }
      const validated = platformConfigSchema.parse(body)
      const platforms = await readPlatformsConfig()
      const idx = platforms.findIndex((p) => p.id === id)
      if (idx >= 0) {
        platforms[idx] = validated
      } else {
        platforms.push(validated)
      }
      await writePlatformsConfig(platforms)
      return c.json(validated)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.delete('/platforms/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const [platforms, accounts] = await Promise.all([
        readPlatformsConfig(),
        readAccountsConfig(),
      ])
      const refs = accounts.filter((a) => a.platformId === id)
      if (refs.length > 0) {
        return c.json({
          error: `Platform "${id}" is referenced by ${refs.length} account(s): ${refs.map((a) => a.id).join(', ')}. Remove them first.`,
        }, 400)
      }
      const filtered = platforms.filter((p) => p.id !== id)
      if (filtered.length === platforms.length) {
        return c.json({ error: `Platform "${id}" not found` }, 404)
      }
      await writePlatformsConfig(filtered)
      return c.json({ success: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Accounts CRUD ====================

  app.put('/accounts/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json()
      if (body.id !== id) {
        return c.json({ error: 'Body id must match URL id' }, 400)
      }

      // Resolve masked credentials: if value is masked, keep the existing value
      const accounts = await readAccountsConfig()
      const existing = accounts.find((a) => a.id === id)
      if (existing) {
        if (body.apiKey && body.apiKey.startsWith('****')) body.apiKey = existing.apiKey
        if (body.apiSecret && body.apiSecret.startsWith('****')) body.apiSecret = existing.apiSecret
        if (body.password && body.password.startsWith('****')) body.password = existing.password
      }

      const validated = accountConfigSchema.parse(body)

      // Validate platformId reference
      const platforms = await readPlatformsConfig()
      if (!platforms.some((p) => p.id === validated.platformId)) {
        return c.json({ error: `Platform "${validated.platformId}" not found` }, 400)
      }

      const idx = accounts.findIndex((a) => a.id === id)
      if (idx >= 0) {
        accounts[idx] = validated
      } else {
        accounts.push(validated)
      }
      await writeAccountsConfig(accounts)
      return c.json(validated)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.delete('/accounts/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const accounts = await readAccountsConfig()
      const filtered = accounts.filter((a) => a.id !== id)
      if (filtered.length === accounts.length) {
        return c.json({ error: `Account "${id}" not found` }, 404)
      }
      await writeAccountsConfig(filtered)
      // Close running account instance if any
      if (ctx.accountManager.has(id)) {
        const uta = ctx.accountManager.get(id)
        ctx.accountManager.remove(id)
        try { await uta?.close() } catch { /* best effort */ }
      }
      return c.json({ success: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Test Connection ====================

  app.post('/test-connection', async (c) => {
    let broker: { init: () => Promise<void>; getAccount: () => Promise<unknown>; close: () => Promise<void> } | null = null
    try {
      const body = await c.req.json()
      const platformConfig = platformConfigSchema.parse(body.platform)
      const { apiKey, apiSecret, password } = body.credentials ?? {}

      if (!apiKey || !apiSecret) {
        return c.json({ success: false, error: 'API key and secret are required' }, 400)
      }

      const platform = createPlatformFromConfig(platformConfig)
      broker = createBrokerFromConfig(platform, {
        id: '__test__',
        platformId: platformConfig.id,
        apiKey,
        apiSecret,
        password,
        guards: [],
      })

      await broker.init()
      const account = await broker.getAccount()
      return c.json({ success: true, account })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ success: false, error: msg }, 400)
    } finally {
      try { await broker?.close() } catch { /* best effort */ }
    }
  })

  return app
}
