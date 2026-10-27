import { Hono } from 'hono'
import { z } from 'zod'

import type { EngineContext } from '../../core/types.js'
import type { GetNewsV2Options, NewsItem } from '../../domain/news/types.js'
import { artifactSchema, NEWS_MODULE_LIMITS } from '../../domain/news/modules/contract.js'
import { isImportantReport, newsReport } from '../../domain/news/report.js'
import { NewsStoryStore, type ReportOccurrence, type StoryQuery } from '../../domain/news/stories.js'
import { newsReaderPatchSchema, newsReadStatusSchema, newsStorySchema } from '../../domain/news/reading-contract.js'
import { newsCountrySchema, newsIndustrySchema } from '../../domain/news/association-contract.js'
import { createNewsAutomationRoutes } from './news-automation.js'
import type { WorkspaceService } from '../../workspaces/service.js'

const VALID_LOOKBACKS = new Set(['1h', '2h', '12h', '24h', '1d', '2d', '7d', '30d'])
const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_MODULE_IMPORT_REQUEST_BYTES = NEWS_MODULE_LIMITS.artifact * 6 + 1024 * 1024

/** News routes: GET / */
export function createNewsRoutes(ctx: EngineContext, options?: { storyDirectory?: string; getWorkspaceService?: () => WorkspaceService | null }) {
  const app = new Hono()
  const stories = ctx.newsStories ?? (ctx.newsProvider ? new NewsStoryStore(ctx.newsProvider, options?.storyDirectory) : null)
  app.route('/automation', createNewsAutomationRoutes(options?.getWorkspaceService ?? (() => null)))
  app.get('/following/topics', async c => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    try { return c.json({ topics: await stories.followedTopics() }) }
    catch { return c.json({ error: 'News following unavailable' }, 503) }
  })
  app.put('/following/topics', async c => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const body = await readBoundedJson(c.req.raw, 4096)
    const parsed = body.ok ? z.object({ topic: z.string().trim().min(1).max(80), following: z.boolean() }).strict().safeParse(body.value) : null
    if (!parsed?.success) return c.json({ error: 'Invalid topic follow' }, 400)
    try { return c.json({ topics: await stories.setTopicFollow(parsed.data.topic, parsed.data.following) }) }
    catch { return c.json({ error: 'Stored topic following unavailable' }, 400) }
  })
  app.get('/processing', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const parsed = z.object({ status: z.enum(['pending', 'review', 'failed']).optional(), limit: z.coerce.number().int().min(1).max(40).default(40), offset: z.coerce.number().int().min(0).max(1_000_000).optional(), order: z.enum(['oldest', 'recent']).optional() }).refine(query => query.order !== 'recent' || !query.offset).safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'Invalid processing query' }, 400)
    try { return c.json(await stories.pending(parsed.data)) }
    catch { return c.json({ error: 'News processing state unavailable' }, 503) }
  })
  app.get('/processing/:id', async c => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const id = z.coerce.number().int().nonnegative().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Invalid report identity' }, 400)
    try { return c.json(await stories.original(id.data)) }
    catch { return c.json({ error: 'Original report unavailable' }, 404) }
  })
  app.post('/processing/:id/retry', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const id = z.coerce.number().int().nonnegative().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Invalid report identity' }, 400)
    const body = c.req.raw.body ? await readBoundedJson(c.req.raw, 4096) : { ok: true as const, value: {} }
    if (!body.ok) return c.json({ error: 'Invalid review feedback' }, body.tooLarge ? 413 : 400)
    const feedback = z.object({ note: z.string().max(1000).default('') }).strict().safeParse(body.value)
    if (!feedback.success) return c.json({ error: 'Invalid review feedback' }, 400)
    try { return c.json(await stories.disposition([id.data], 'retry', feedback.data.note)) }
    catch { return c.json({ error: 'Original report unavailable' }, 400) }
  })
  app.patch('/stories/:id/reader', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const body = await readBoundedJson(c.req.raw, 4096)
    const parsed = body.ok ? newsReaderPatchSchema.safeParse(body.value) : null
    if (!parsed?.success) return c.json({ error: 'Invalid reader change' }, 400)
    try { return c.json(await stories.setReader(c.req.param('id'), parsed.data)) }
    catch (error) {
      const stale = error instanceof Error && error.message === 'Event revision changed'
      return c.json({ error: stale ? 'Event revision changed; refresh before marking read' : 'Event reader state unavailable' }, stale ? 409 : 400)
    }
  })

  app.get('/stories', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const query = parseStoryQuery(c.req.query())
    if (!query) return c.json({ error: 'Invalid event query' }, 400)
    try { return c.json(await stories.list(query)) }
    catch { return c.json({ error: 'Event reading unavailable; original reports remain available' }, 500) }
  })
  app.get('/stories/:id/associations', async c => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    try { return c.json(await stories.getAssociations(c.req.param('id'))) }
    catch { return c.json({ error: 'Event associations unavailable; original reports remain available' }, 503) }
  })
  app.put('/stories/:id/associations', async c => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const body = await readBoundedJson(c.req.raw, 1024 * 1024)
    if (!body.ok) return c.json({ error: 'Invalid association artifact' }, body.tooLarge ? 413 : 400)
    try { return c.json(await stories.publishAssociations(c.req.param('id'), body.value)) }
    catch (error) { return c.json({ error: error instanceof Error && /revision.*conflict/.test(error.message) ? 'Association revision conflict' : 'Association publication failed; check current revisions, protection and exact evidence' }, error instanceof Error && /revision.*conflict/.test(error.message) ? 409 : 400) }
  })
  app.get('/stories/:id', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    try { return c.json(await stories.get(c.req.param('id'))) }
    catch { return c.json({ error: 'Event details unavailable' }, 404) }
  })
  app.put('/stories/:id', async (c) => {
    if (!stories) return c.json({ error: 'News provider unavailable' }, 503)
    const body = await readBoundedJson(c.req.raw, 1024 * 1024)
    if (!body.ok) return c.json({ error: 'Invalid event reading result' }, body.tooLarge ? 413 : 400)
    const parsed = newsStorySchema.safeParse(body.value)
    if (!parsed.success || parsed.data.id !== c.req.param('id')) return c.json({ error: 'Invalid event reading result or identity' }, 400)
    try {
      const result = await stories.publish(parsed.data)
      return c.json({ id: result.id, revision: result.revision })
    }
    catch (error) {
      if (error instanceof Error && /revision.*conflict/i.test(error.message)) return c.json({ error: 'Event revision conflict; read the current event before updating' }, 409)
      return c.json({ error: 'Event publication failed; check original report IDs and stored result' }, 400)
    }
  })

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

  app.get('/modules/:hash/credentials', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    if (!/^[a-f0-9]{64}$/.test(c.req.param('hash'))) return c.json({ error: 'Invalid module identity' }, 400)
    try { return c.json({ credentials: await ctx.newsCollector.getModuleCredentials(c.req.param('hash')) }) }
    catch { return c.json({ error: 'Credential status requires an approved v2 artifact' }, 400) }
  })
  app.put('/modules/:hash/credentials', async (c) => {
    if (!ctx.newsCollector) return c.json({ error: 'News collector unavailable' }, 409)
    if (!/^[a-f0-9]{64}$/.test(c.req.param('hash'))) return c.json({ error: 'Invalid module identity' }, 400)
    const body = await readBoundedJson(c.req.raw, 32768)
    if (!body.ok) return c.json({ error: 'Invalid credential request' }, body.tooLarge ? 413 : 400)
    const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/)
    const parsed = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('set'), key, value: z.string().min(1).max(4096).regex(/^[^\r\n\0]+$/) }).strict(),
      z.object({ operation: z.literal('clear'), key }).strict(),
    ]).safeParse(body.value)
    if (!parsed.success) return c.json({ error: 'Invalid credential request' }, 400)
    try {
      return c.json({ credentials: await ctx.newsCollector.updateModuleCredential(c.req.param('hash'), parsed.data.key, parsed.data.operation, parsed.data.operation === 'set' ? parsed.data.value : undefined) })
    } catch { return c.json({ error: 'Credential update failed; approve the artifact and check the credential name' }, 400) }
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

    const importance = c.req.query('important')
    if (importance !== undefined && !['true', 'false'].includes(importance)) return c.json({ error: 'Invalid importance filter' }, 400)
    const important = importance === 'true'
    const limit = parseLimit(c.req.query('limit'))
    const sourceFilter = c.req.query('source')
    const exactSource = c.req.query('sourceExact')
    const sourceValues = exactSource ? [exactSource.toLowerCase()] : sourceFilter?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) ?? []
    const sources = sourceValues.length > 0 ? new Set(sourceValues) : undefined
    const keyword = normalizedTerm(c.req.query('keyword'))
    const symbol = normalizedTerm(c.req.query('symbol'))
    const categoryTags = c.req.query('categories')?.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean)
    const categories = categoryTags?.length ? new Set(categoryTags) : undefined
    const hasFilters = Boolean(sources || keyword || symbol || categories || important)
    const options: GetNewsV2Options = {
      endTime,
      ...(startTime ? { startTime } : { lookback }),
      ...(hasFilters ? {} : { limit }),
    }

    let items = await ctx.newsProvider.getNewsV2(options)
    items = items.filter((item) => matchesNewsFilters(item, sources, keyword, symbol, categories) && (!important || isImportantReport(item)))
    items.sort(compareNewsItems)
    if (items.length > limit) items = items.slice(-limit)

    let occurrences = new Map<number, ReportOccurrence | null>()
    let reading = {}
    try { occurrences = await stories!.reportOccurrences(items.map(item => item.id)) }
    catch { reading = { storyError: true } }
    const shaped = items.map(item => ({ ...newsReport(item), ...(occurrences.has(item.id) ? { eventRef: occurrences.get(item.id) } : {}) }))

    // Event context is independent of the raw-report query window and its cap.
    if (c.req.query('includeStories') === 'true') {
      const query = parseStoryQuery(c.req.query())
      if (!query) return c.json({ error: 'Invalid event query' }, 400)
      try {
        const page = await stories!.list(query)
        reading = { ...reading, stories: page.stories, storySources: page.sources, storyTopics: page.topics, storyNextOffset: page.nextOffset }
      }
      catch { reading = { storyError: true } }
    }
    return c.json({ items: shaped, count: shaped.length, lookback: startTime ? null : lookback, ...reading })
  })

  return app
}

function parseQueryTime(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = new Date(raw)
  return Number.isNaN(value.getTime()) ? undefined : value
}

const storyQuerySchema = z.object({
  industry: newsIndustrySchema.optional(), asset: z.string().min(3).max(500).optional(),
  country: newsCountrySchema.optional(),
  eventId: newsStorySchema.shape.id.optional(),
  readStatus: newsReadStatusSchema.optional(),
  relatedTo: newsStorySchema.shape.id.optional(),
  storyOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  readingView: z.enum(['selected', 'events']).optional(), storyTopics: z.string().max(2048).optional(),
  sourceExact: z.string().max(200).optional(), source: z.string().max(200).optional(),
  keyword: z.string().max(500).optional(), symbol: z.string().max(120).optional(),
  storyOrder: z.enum(['recent', 'heat', 'relevance']).optional(), bookmarked: z.enum(['true', 'false']).optional(),
  important: z.enum(['true', 'false']).optional(),
  startTime: z.iso.datetime({ offset: true }).optional(), endTime: z.iso.datetime({ offset: true }).optional(),
})
function parseStoryQuery(value: Record<string, string>): StoryQuery | null {
  const parsed = storyQuerySchema.safeParse(value)
  if (!parsed.success) return null
  const query = parsed.data
  if (query.startTime && query.endTime && Date.parse(query.startTime) >= Date.parse(query.endTime)) return null
  return { country: query.country, industry: query.industry, asset: query.asset, eventId: query.eventId, offset: query.storyOffset, selected: query.readingView === 'selected', topics: query.storyTopics?.split(',').map(topic => topic.trim().toLowerCase()).filter(Boolean),
    order: query.storyOrder, bookmarked: query.bookmarked === 'true', important: query.important === 'true', relatedTo: query.relatedTo, readStatus: query.readStatus,
    source: query.sourceExact ?? query.source, keyword: query.keyword?.trim() || undefined, symbol: query.symbol?.trim() || undefined,
    startTime: query.startTime, endTime: query.endTime }
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
  categories: Set<string> | undefined,
): boolean {
  if (!item.title.trim() && !item.content.trim()) return false
  if (categories && !(item.metadata.categories ?? '').split(/[;,]/).some(tag => categories.has(tag.trim().toLowerCase()))) return false
  if (sources) {
    if (![item.metadata.source, item.metadata.publisher].some(source => source && sources.has(source.toLowerCase()))) return false
  }

  const searchable = [
    item.title,
    item.content,
    item.metadata.categories ?? '',
    item.metadata.symbols ?? '',
    item.metadata.publisher ?? '',
    item.metadata.author ?? '',
  ].join('\n').toLowerCase()
  return (!keyword || searchable.includes(keyword)) && (!symbol || searchable.includes(symbol))
}

function compareNewsItems(a: NewsItem, b: NewsItem): number {
  const timeDelta = a.time.getTime() - b.time.getTime()
  if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta
  if (a.id !== b.id) return a.id - b.id
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
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
