import { Hono } from 'hono'
import { z } from 'zod'

import type { EngineContext } from '../../core/types.js'
import type { GetNewsV2Options, NewsItem } from '../../domain/news/types.js'
import { artifactSchema, NEWS_MODULE_LIMITS } from '../../domain/news/modules/contract.js'

const VALID_LOOKBACKS = new Set(['1h', '2h', '12h', '24h', '1d', '2d', '7d', '30d'])
const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_MODULE_IMPORT_REQUEST_BYTES = NEWS_MODULE_LIMITS.artifact * 6 + 1024 * 1024

/** News routes: GET / */
export function createNewsRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/collector', (c) => c.json({ feeds: ctx.newsCollector?.getStatus() ?? [] }))
  app.get('/modules', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    try { return c.json({ modules: await ctx.newsCollector.getModules() }) }
    catch { return c.json({ error: 'Module list unavailable' }, 500) }
  })

  app.post('/modules', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    const body = await readBoundedJson(c.req.raw, MAX_MODULE_IMPORT_REQUEST_BYTES)
    if (!body.ok) return c.json({ error: body.tooLarge ? 'Module import request too large' : 'Invalid module artifact' }, body.tooLarge ? 413 : 400)
    const parsed = z.object({ artifact: artifactSchema }).strict().safeParse(body.value)
    if (!parsed.success) return c.json({ error: 'Invalid module artifact' }, 400)
    try {
      return c.json(await ctx.newsCollector.importModule(parsed.data.artifact))
    } catch {
      return c.json({ error: 'Module import failed' }, 500)
    }
  })

  app.post('/modules/:hash/approve', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    const hash = z.string().regex(/^[a-f0-9]{64}$/).safeParse(c.req.param('hash'))
    if (!hash.success) return c.json({ error: 'Invalid module identity' }, 400)
    try {
      return c.json(await ctx.newsCollector.approveModule(hash.data))
    } catch {
      return c.json({ error: 'Module approval failed' }, 500)
    }
  })

  app.post('/modules/:hash/retry', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    const hash = z.string().regex(/^[a-f0-9]{64}$/).safeParse(c.req.param('hash'))
    if (!hash.success) return c.json({ error: 'Invalid module identity' }, 400)
    try {
      return c.json({ modules: await ctx.newsCollector.retryModule(hash.data) })
    } catch {
      return c.json({ error: 'Module retry failed' }, 500)
    }
  })

  app.delete('/modules/:hash', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    const hash = z.string().regex(/^[a-f0-9]{64}$/).safeParse(c.req.param('hash'))
    if (!hash.success) return c.json({ error: 'Invalid module identity' }, 400)
    try {
      await ctx.newsCollector.uninstallModule(hash.data)
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Module uninstall failed' }, 500)
    }
  })

  app.get('/rsshub-key', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    try { return c.json(await ctx.newsCollector.getRssHubKeyStatus()) }
    catch { return c.json({ error: 'RSSHub credential status unavailable' }, 500) }
  })

  app.put('/rsshub-key', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    const parsed = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('set'), key: z.string().min(1).max(4096).regex(/^[^\r\n\0]+$/) }).strict(),
      z.object({ operation: z.literal('clear') }).strict(),
    ]).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid RSSHub credential request' }, 400)
    try {
      return c.json(await ctx.newsCollector.updateRssHubKey(parsed.data.operation, parsed.data.operation === 'set' ? parsed.data.key : undefined))
    } catch {
      return c.json({ error: 'RSSHub credential update failed' }, 500)
    }
  })

  app.post('/collect', async (c) => {
    if (!ctx.newsCollector || !ctx.config.news.enabled) return c.json({ error: 'News collection is disabled' }, 409)
    return c.json(await ctx.newsCollector.fetchAll())
  })

  app.get('/', async (c) => {
    if (!ctx.newsProvider) {
      return c.json({ error: 'News provider not available' }, 503)
    }

    const startRaw = c.req.query('startTime')
    const endRaw = c.req.query('endTime')
    const startTime = parseQueryTime(startRaw)
    const parsedEndTime = parseQueryTime(endRaw)
    const endTime = parsedEndTime ?? new Date()
    if (startRaw !== undefined && !startTime) {
      return c.json({ error: 'Invalid startTime; expected an ISO timestamp' }, 400)
    }
    if (endRaw !== undefined && !parsedEndTime) {
      return c.json({ error: 'Invalid endTime; expected an ISO timestamp' }, 400)
    }
    if (startTime && startTime.getTime() >= endTime.getTime()) {
      return c.json({ error: 'startTime must be before endTime' }, 400)
    }

    const lookback = c.req.query('lookback') || DEFAULT_LOOKBACK
    if (!startTime && !VALID_LOOKBACKS.has(lookback)) {
      return c.json({
        error: `Invalid lookback "${lookback}". Valid: ${[...VALID_LOOKBACKS].join(', ')}`,
      }, 400)
    }

    const limit = parseLimit(c.req.query('limit'))
    const sourceFilter = c.req.query('source')
    const sourceValues = sourceFilter?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) ?? []
    const sources = sourceValues.length > 0 ? new Set(sourceValues) : undefined
    const keyword = normalizedTerm(c.req.query('keyword'))
    const symbol = normalizedTerm(c.req.query('symbol'))
    const hasFilters = Boolean(sources || keyword || symbol)
    const options: GetNewsV2Options = {
      endTime,
      ...(startTime ? { startTime } : { lookback }),
      ...(hasFilters ? {} : { limit }),
    }

    let items = await ctx.newsProvider.getNewsV2(options)
    items = items.filter((item) => matchesNewsFilters(item, sources, keyword, symbol))
    items.sort(compareNewsItems)
    if (items.length > limit) items = items.slice(-limit)

    const shaped = items.map((item) => ({
      time: item.time.toISOString(),
      title: item.title,
      content: item.content,
      source: item.metadata.source ?? null,
      link: item.metadata.link ?? null,
      categories: item.metadata.categories ?? null,
      image: safeHttpImageUrl(item.metadata.image),
    }))

    return c.json({ items: shaped, count: shaped.length, lookback: startTime ? null : lookback })
  })

  return app
}

function parseQueryTime(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = new Date(raw)
  return Number.isNaN(value.getTime()) ? undefined : value
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
}

function normalizedTerm(value: string | undefined): string | undefined {
  const term = value?.trim().toLowerCase()
  return term || undefined
}

function matchesNewsFilters(
  item: NewsItem,
  sources: Set<string> | undefined,
  keyword: string | undefined,
  symbol: string | undefined,
): boolean {
  if (sources) {
    const source = item.metadata.source?.toLowerCase()
    if (!source || !sources.has(source)) return false
  }

  const searchable = [
    item.title,
    item.content,
    item.metadata.categories ?? '',
  ].join('\n').toLowerCase()
  return (!keyword || searchable.includes(keyword)) && (!symbol || searchable.includes(symbol))
}

function compareNewsItems(a: NewsItem, b: NewsItem): number {
  const timeDelta = a.time.getTime() - b.time.getTime()
  if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta
  if (a.id !== b.id) return a.id - b.id
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
}

function safeHttpImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return raw.trim()
  } catch {
    return null
  }
}

async function readBoundedJson(request: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await request.body?.cancel().catch(() => {})
    return { ok: false, tooLarge: true }
  }
  if (!request.body) return { ok: false, tooLarge: false }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, tooLarge: false }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) } }
  catch { return { ok: false, tooLarge: false } }
}
