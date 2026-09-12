import { Hono } from 'hono'
import { z } from 'zod'
import type { EngineContext } from '../../core/types.js'
import { createMarketMonitorService, type MarketMonitorService } from '../../domain/market-monitor/service.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, MARKET_MONITOR_ASSETS, type MarketMonitorAsset } from '../../domain/market-monitor/types.js'

const assetSchema = z.enum(MARKET_MONITOR_ASSETS)
const settingsSchema = z.object({
  enabledAssets: z.array(assetSchema).min(1),
  strategyId: z.string().trim().min(1).default(DEFAULT_MARKET_MONITOR_SETTINGS.strategyId),
  intervalMinutes: z.number().int().min(1).max(1440),
  notifications: z.boolean(),
  alertConfidence: z.number().int().min(50).max(95),
  abnormalVolumeRatio: z.number().min(1).max(10),
  abnormalMovePercent: z.number().min(0.1).max(25),
})

function limitFrom(raw: string | undefined): number {
  const value = Number(raw ?? 100)
  return Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.trunc(value))) : 100
}

function assetFrom(raw: string | undefined): MarketMonitorAsset | undefined {
  const parsed = assetSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export function createMarketMonitorRoutes(ctx: EngineContext, provided?: MarketMonitorService): Hono {
  const app = new Hono()
  const service = provided ?? createMarketMonitorService({
    barService: ctx.barService,
    equityClient: ctx.equityClient,
    reference: ctx.reference,
    ...(ctx.newsProvider ? { newsProvider: ctx.newsProvider } : {}),
  })

  app.get('/settings', async (c) => c.json(await service.settings()))

  app.get('/strategies', (c) => c.json({ strategies: service.strategies() }))

  app.get('/context-providers', (c) => c.json({ providers: service.contextProviders() }))

  app.put('/settings', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = settingsSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'Invalid monitor settings', issues: parsed.error.issues }, 400)
    if (!service.strategies().some((strategy) => strategy.id === parsed.data.strategyId)) {
      return c.json({ error: 'Unknown monitor strategy' }, 400)
    }
    await service.saveSettings(parsed.data)
    return c.json(parsed.data)
  })

  app.post('/scan', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = z.object({ asset: assetSchema, trigger: z.enum(['manual', 'scheduled']).default('manual') }).safeParse(body)
    if (!parsed.success) return c.json({ error: 'asset must be BTC or TSLA' }, 400)
    try {
      return c.json(await service.scan(parsed.data.asset, parsed.data.trigger))
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
  })

  app.get('/snapshots', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: 'asset must be BTC or TSLA' }, 400)
    const strategyId = c.req.query('strategyId')
    if (strategyId && !service.strategies().some((strategy) => strategy.id === strategyId)) {
      return c.json({ error: 'Unknown monitor strategy' }, 400)
    }
    const snapshots = await service.snapshots(asset, limitFrom(c.req.query('limit')), strategyId)
    return c.json({ snapshots, count: snapshots.length })
  })

  app.get('/alerts', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: 'asset must be BTC or TSLA' }, 400)
    const alerts = await service.alerts(asset, limitFrom(c.req.query('limit')))
    return c.json({ alerts, count: alerts.length })
  })

  app.get('/receipts', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: 'asset must be BTC or TSLA' }, 400)
    const receipts = await service.receipts(asset, limitFrom(c.req.query('limit')))
    return c.json({ receipts, count: receipts.length })
  })

  app.get('/evaluation', async (c) => {
    const asset = assetFrom(c.req.query('asset'))
    if (!asset) return c.json({ error: 'asset must be BTC or TSLA' }, 400)
    return c.json(await service.evaluation(asset))
  })

  app.get('/defaults', (c) => c.json(DEFAULT_MARKET_MONITOR_SETTINGS))

  return app
}
