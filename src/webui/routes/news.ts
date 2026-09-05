import { Hono } from 'hono'

import type { EngineContext } from '../../core/types.js'
import type { GetNewsV2Options, NewsItem } from '../../domain/news/types.js'
const VALID_LOOKBACKS = new Set(['1h', '2h', '12h', '24h', '1d', '2d', '7d', '30d'])
const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** News routes: GET / */
export function createNewsRoutes(ctx: EngineContext) {
  const app = new Hono()

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
