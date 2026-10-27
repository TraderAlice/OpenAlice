import { http, HttpResponse } from 'msw'
import { z } from 'zod'

import { resolveNewsFeedUrl } from '../../../../src/domain/news/config'
import { artifactSchema, NEWS_MODULE_LIMITS } from '../../../../src/domain/news/modules/contract'
import { newsPublisher } from '../../../../src/domain/news/heat'
import { newsReaderPatchSchema, newsReadStatusSchema, newsStorySchema, type NewsReaderState } from '../../../../src/domain/news/reading-contract'
import { newsStoryRelation } from '../../../../src/domain/news/relations'

import { demoNewsArticles, demoNewsStories, demoNewsStoryPreviews } from '../fixtures/news'
import { demoNewsCredentialFlags, demoNewsInstalledModules, getDemoNewsConfig } from './configKeys'

import type { NewsListResponse } from '../../api/types'
import type { ModuleStatus, NewsModuleArtifact } from '../../../../src/domain/news/modules/contract'

const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const demoReaderState = new Map<string, NewsReaderState>()
const demoFollowedTopics = new Set<string>()
export function resetDemoNewsReadingState() { demoReaderState.clear(); demoFollowedTopics.clear() }
const LOOKBACK_MS: Record<string, number> = {
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '2d': 2 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
}

function parseLookback(value: string): number | null {
  return Object.hasOwn(LOOKBACK_MS, value) ? LOOKBACK_MS[value] : null
}

function parseTime(value: string | null): number | null {
  if (!value?.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function parseLimit(value: string | null): number {
  if (!value?.trim()) return DEFAULT_LIMIT
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
}

function includesText(article: { title: string; content: string; categories: string | null; symbols?: string[] }, value: string): boolean {
  const haystack = [article.title, article.content, article.categories ?? '', ...(article.symbols ?? [])].join('\n').toLowerCase()
  return haystack.includes(value)
}

function badRequest(message: string) {
  return HttpResponse.json({ error: message }, { status: 400 })
}

function isSafeDemoArtifactPath(path: string): boolean {
  return path.length <= 200
    && /^[a-zA-Z0-9_.\/-]+$/.test(path)
    && !['artifact.json', 'manifest.json', 'approval.json'].includes(path.toLowerCase())
    && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}

function parseDemoNewsArtifact(value: unknown): NewsModuleArtifact | null {
  const parsed = artifactSchema.safeParse(value)
  if (!parsed.success) return null
  const artifact = parsed.data
  const paths = Object.keys(artifact.files)
  if (
    new TextEncoder().encode(JSON.stringify(artifact)).byteLength > NEWS_MODULE_LIMITS.artifact
    || paths.length > 128
    || !paths.every(isSafeDemoArtifactPath)
    || !artifact.files[artifact.manifest.entry]
    || !/\.m?js$/.test(artifact.manifest.entry)
  ) return null
  return artifact
}

async function hashDemoNewsArtifact(artifact: NewsModuleArtifact): Promise<string> {
  const files = Object.entries(artifact.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([artifact.manifest, files])),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function getDemoNewsModuleStatuses(): ModuleStatus[] {
  const config = getDemoNewsConfig()
  return [...demoNewsInstalledModules.values()]
    .sort((a, b) => a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0)
    .map((module) => {
      const selection = config.modules.find((item) => item.moduleId === module.manifest.moduleId && item.contentHash === module.contentHash)
      const desiredEnabled = selection?.enabled ?? false
      const state: ModuleStatus['state'] = !module.approved ? 'unapproved' : desiredEnabled ? 'failed' : 'disabled'
      return {
        ...module, moduleId: module.manifest.moduleId, installed: true,
        desiredEnabled, loaded: false, loadedHash: null, state,
        lastError: desiredEnabled ? 'Demo mode does not execute external module artifacts' : null,
      }
    })
}

function demoCredentialStatus(hash: string) {
  const installed = demoNewsInstalledModules.get(hash)
  if (!installed?.approved || installed.manifest.abiVersion !== 2) return null
  return installed.manifest.credentials.map(credential => ({ ...credential, configured: demoNewsCredentialFlags.get(hash)?.has(credential.key) ?? false, available: true }))
}

/** Mirrors News management and reading without executing external producers. */
export const newsListHandlers = [
  http.get('/api/news/automation', () => HttpResponse.json({ workspaces: [], automations: [] })),
  http.put('/api/news/automation', () => HttpResponse.json({ error: 'Demo mode does not run native Agents' }, { status: 501 })),
  http.get('/api/news/processing', () => HttpResponse.json({ items: [], counts: { pending: 0, review: 0, failed: 0, ready: 0 }, nextOffset: null })),
  http.get('/api/news/following/topics', () => HttpResponse.json({ topics: [...demoFollowedTopics].sort() })),
  http.put('/api/news/following/topics', async ({ request }) => {
    const parsed = z.object({ topic: z.string().trim().min(1).max(80), following: z.boolean() }).strict().safeParse(await request.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid topic follow')
    const topic = parsed.data.topic.toLowerCase()
    if (parsed.data.following && !demoNewsStories.some(story => story.topics.some(label => label.toLowerCase() === topic))) return badRequest('Unknown stored topic')
    if (parsed.data.following) demoFollowedTopics.add(topic)
    else demoFollowedTopics.delete(topic)
    return HttpResponse.json({ topics: [...demoFollowedTopics].sort() })
  }),
  http.patch('/api/news/stories/:id/reader', async ({ params, request }) => {
    const story = demoNewsStories.find(story => story.id === params.id)
    if (!story) return HttpResponse.json({ error: 'Event unavailable' }, { status: 404 })
    const patch = newsReaderPatchSchema.safeParse(await request.json().catch(() => null))
    if (!patch.success) return badRequest('Invalid reader change')
    const { readRevision, ...flags } = patch.data
    if (readRevision != null && readRevision !== story.revision) return HttpResponse.json({ error: 'Event revision changed; refresh before marking read' }, { status: 409 })
    const value = { ...demoReaderState.get(String(params.id)), ...flags,
      ...(readRevision === undefined ? {} : { readProgress: readRevision === null ? null : { revision: story.revision, developmentIds: story.developments.map(value => value.id) } }),
    }
    demoReaderState.set(String(params.id), value)
    return HttpResponse.json(value)
  }),
  http.get('/api/news/stories', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (params.has('readStatus') && !newsReadStatusSchema.safeParse(params.get('readStatus')).success) return badRequest('Invalid reading filter')
    if (params.has('eventId') && !newsStorySchema.shape.id.safeParse(params.get('eventId')).success) return badRequest('Invalid event identity')
    if (params.has('relatedTo') && !newsStorySchema.shape.id.safeParse(params.get('relatedTo')).success) return badRequest('Invalid event identity')
    return params.has('important') && !['true', 'false'].includes(params.get('important')!) ? badRequest('Invalid importance filter') : HttpResponse.json(demoStoryPage(params))
  }),
  http.get('/api/news/stories/:id', ({ params }) => {
    const story = demoNewsStories.find(story => story.id === params.id)
    return story ? HttpResponse.json(story) : HttpResponse.json({ error: 'Event details unavailable' }, { status: 404 })
  }),
  http.get('/api/news/modules', () => HttpResponse.json({ modules: getDemoNewsModuleStatuses() })),
  // Demo validates and hashes artifacts but never loads or executes their source.
  http.post('/api/news/modules', async ({ request }) => {
    const body = await request.json().catch(() => null) as unknown
    if (
      !body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'artifact')
    ) return badRequest('Invalid module artifact')
    const artifact = parseDemoNewsArtifact((body as { artifact: unknown }).artifact)
    if (!artifact) return badRequest('Invalid or oversized module artifact')
    const contentHash = await hashDemoNewsArtifact(artifact)
    const installed = demoNewsInstalledModules.get(contentHash)
      ?? { manifest: artifact.manifest, contentHash, approved: false }
    demoNewsInstalledModules.set(contentHash, installed)
    return HttpResponse.json(installed)
  }),
  http.post('/api/news/modules/:hash/approve', ({ params }) => {
    const hash = String(params.hash)
    if (!/^[a-f0-9]{64}$/.test(hash)) return badRequest('Invalid module identity')
    const installed = demoNewsInstalledModules.get(hash)
    if (!installed) return HttpResponse.json({ error: 'Module not found' }, { status: 404 })
    const approved = { ...installed, approved: true }
    demoNewsInstalledModules.set(hash, approved)
    return HttpResponse.json(approved)
  }),
  http.get('/api/news/modules/:hash/credentials', ({ params }) => {
    const credentials = demoCredentialStatus(String(params.hash))
    return credentials ? HttpResponse.json({ credentials }) : badRequest('Approve the v2 artifact first')
  }),
  http.put('/api/news/modules/:hash/credentials', async ({ params, request }) => {
    const hash = String(params.hash), credentials = demoCredentialStatus(hash)
    const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/)
    const parsed = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('set'), key, value: z.string().min(1).max(4096).regex(/^[^\r\n\0]+$/) }).strict(),
      z.object({ operation: z.literal('clear'), key }).strict(),
    ]).safeParse(await request.json().catch(() => null))
    if (!parsed.success || !credentials?.some(credential => credential.key === parsed.data.key)) return badRequest('Invalid module credential request')
    // Demo stores configured flags, never credential values and never calls a provider.
    const flags = demoNewsCredentialFlags.get(hash) ?? new Set<string>()
    if (parsed.data.operation === 'set') flags.add(parsed.data.key)
    else flags.delete(parsed.data.key)
    demoNewsCredentialFlags.set(hash, flags)
    return HttpResponse.json({ credentials: demoCredentialStatus(hash) })
  }),
  http.post('/api/news/modules/:hash/retry', ({ params }) => {
    const hash = String(params.hash)
    if (!/^[a-f0-9]{64}$/.test(hash)) return badRequest('Invalid module identity')
    const installed = demoNewsInstalledModules.get(hash)
    if (!installed) return HttpResponse.json({ error: 'Module not found' }, { status: 404 })
    const selection = getDemoNewsConfig().modules.find((item) => item.contentHash === hash && item.moduleId === installed.manifest.moduleId)
    if (!selection?.enabled) return HttpResponse.json({ error: 'Enable the module before retrying' }, { status: 409 })
    if (!installed.approved) return HttpResponse.json({ error: 'Module not approved' }, { status: 409 })
    return HttpResponse.json({ modules: getDemoNewsModuleStatuses() })
  }),
  http.delete('/api/news/modules/:hash', ({ params }) => {
    const hash = String(params.hash)
    if (!/^[a-f0-9]{64}$/.test(hash)) return badRequest('Invalid module identity')
    if (getDemoNewsConfig().modules.some((item) => item.contentHash === hash)) {
      return HttpResponse.json({ error: 'Remove the selected module version before uninstalling' }, { status: 409 })
    }
    demoNewsInstalledModules.delete(hash)
    demoNewsCredentialFlags.delete(hash)
    return HttpResponse.json({ ok: true })
  }),
  http.get('/api/news', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (params.get('includeStories') === 'true' && params.has('readStatus') && !newsReadStatusSchema.safeParse(params.get('readStatus')).success) return badRequest('Invalid reading filter')
    if (params.get('includeStories') === 'true' && params.has('eventId') && !newsStorySchema.shape.id.safeParse(params.get('eventId')).success) return badRequest('Invalid event identity')
    const lookback = params.get('lookback') || DEFAULT_LOOKBACK
    const startText = params.get('startTime')
    const hasStart = startText !== null
    const lookbackMs = hasStart ? null : parseLookback(lookback)
    if (!hasStart && lookbackMs == null) return badRequest(`Invalid lookback "${lookback}"`)

    const endText = params.get('endTime')
    const parsedEnd = parseTime(endText)
    if (endText !== null && parsedEnd == null) return badRequest(`Invalid endTime "${endText}"`)
    const endTime = parsedEnd ?? Date.now()
    const parsedStart = parseTime(startText)
    if (hasStart && parsedStart == null) return badRequest(`Invalid startTime "${startText}"`)
    const startTime = parsedStart ?? endTime - (lookbackMs ?? 0)
    if (startTime >= endTime) return badRequest('startTime must be before endTime')

    const source = params.get('source')
    const sourceFilters = params.has('sourceExact') ? [params.get('sourceExact')!.toLowerCase()] : source
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    const keyword = params.get('keyword')?.trim().toLowerCase() ?? ''
    const symbol = params.get('symbol')?.trim().toLowerCase() ?? ''
    const categories = params.get('categories')?.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean)
    const limit = parseLimit(params.get('limit'))
    if (params.has('important') && !['true', 'false'].includes(params.get('important')!)) return badRequest('Invalid importance filter')

    const filtered = demoNewsArticles.filter((article) => {
      if (params.get('important') === 'true' && !isImportantArticle(article)) return false
      if (!article.title.trim() && !article.content.trim()) return false
      const articleTime = Date.parse(article.time)
      if (!(articleTime > startTime && articleTime <= endTime)) return false
      if (sourceFilters?.length && !sourceFilters.includes((article.source ?? '').toLowerCase())) return false
      if (keyword && !includesText(article, keyword)) return false
      if (symbol && !includesText(article, symbol)) return false
      if (categories?.length && !(article.categories ?? '').split(/[;,]/).some(tag => categories.includes(tag.trim().toLowerCase()))) return false
      return true
    })
    const items = filtered
      .sort(compareNewsArticles)
      .slice(-limit)
      .map((article) => ({ ...article, ...(isImportantArticle(article) ? { important: true as const } : {}), image: article.image ?? null }))
    const body: NewsListResponse = {
      items,
      count: items.length,
      lookback: startText ? null : lookback,
      ...(params.get('includeStories') === 'true' ? (() => { const page = demoStoryPage(params); return { stories: page.stories, storySources: page.sources, storyTopics: page.topics, storyNextOffset: page.nextOffset } })() : {}),
    }
    return HttpResponse.json(body)
  }),
  http.get('/api/news/collector', () => {
    const config = getDemoNewsConfig()
    return HttpResponse.json({
      feeds: config.feeds.map((feed) => ({
        id: feed.id,
        source: feed.source,
        url: feed.rsshubRoute ? resolveNewsFeedUrl(feed, config.rsshubBaseUrl) : feed.url,
        name: feed.name,
        state: !config.enabled || feed.enabled === false ? 'disabled' : 'never_attempted',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastItemCount: null,
        lastNewItemCount: null,
        lastPublishedAt: null,
        lastUndatedItemCount: null,
        lastEmptyContentCount: null,
        lastEmptyItemCount: null,
        lastDurationMs: null,
        lastError: null,
      })),
    })
  }),
  http.post('/api/news/collect', () => {
    if (!getDemoNewsConfig().enabled) {
      return HttpResponse.json({ error: 'News collection is disabled' }, { status: 409 })
    }
    return HttpResponse.json({ error: 'Demo mode does not fetch external news' }, { status: 501 })
  }),
]

function compareNewsArticles(a: { time: string; title: string }, b: { time: string; title: string }): number {
  const aTime = Date.parse(a.time)
  const bTime = Date.parse(b.time)
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
}

function isImportantArticle(article: { categories?: string | null; important?: boolean }) {
  return article.important ?? (article.categories ?? '').split(/[;,]/).some(tag => ['important', 'breaking', 'urgent', 'top'].includes(tag.trim().toLowerCase()))
}

function demoStoryPage(params: URLSearchParams) {
  const related = demoNewsStories.find(story => story.id === params.get('relatedTo'))
  const relations = new Map(demoNewsStories.map(story => [story.id, related ? newsStoryRelation(related, story) : { topics: [], symbols: [] }]))
  const important = (story: typeof demoNewsStories[number]) => demoReaderState.get(story.id)?.important ?? (story.importance?.level === 'important' || story.reports.some(isImportantArticle))
  const source = (params.get('sourceExact') ?? params.get('source'))?.toLowerCase()
  const keyword = params.get('keyword')?.trim().toLowerCase()
  const symbol = params.get('symbol')?.trim().toLowerCase()
  const topics = params.get('storyTopics')?.toLowerCase().split(',').filter(Boolean)
  const start = params.get('startTime'), end = params.get('endTime')
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(params.get('storyOffset')) || 0)))
  const filtered = demoNewsStories.filter(story => {
    const associations = story.associations?.status === 'current' ? story.associations.current?.relations.filter(relation => relation.status === 'active') ?? [] : []
    if (params.get('country') && !associations.some(relation => relation.country === params.get('country'))) return false
    if (params.get('industry') && !associations.some(relation => relation.industry === params.get('industry'))) return false
    if (params.get('asset') && !associations.some(relation => relation.asset?.barId === params.get('asset'))) return false
    if (params.has('eventId') && story.id !== params.get('eventId')) return false
    const read = demoReaderState.get(story.id)?.readProgress
    if (params.get('readStatus') === 'unread' && read) return false
    if (params.get('readStatus') === 'updated' && (!read || read.revision >= story.revision)) return false
    if (params.has('relatedTo') && (story.id === params.get('relatedTo') || !relations.get(story.id)!.topics.length && !relations.get(story.id)!.symbols.length)) return false
    if (params.get('important') === 'true' && !important(story)) return false
    if (params.get('bookmarked') === 'true' && !demoReaderState.get(story.id)?.bookmarked) return false
    if (params.get('readingView') === 'selected' && !story.selected) return false
    if (topics?.length && !story.topics.some(topic => topics.includes(topic.toLowerCase()))) return false
    if (source && !story.reports.some(report => report.source?.toLowerCase() === source)) return false
    if (symbol && !story.symbols.some(value => value.toLowerCase() === symbol || value.split(':').pop()?.toLowerCase() === symbol)) return false
    const text = [story.title, story.summary, story.reason, ...(story.transmission?.steps ?? []), story.transmission?.condition ?? '', ...story.topics, ...story.symbols, ...story.developments.flatMap(fact => [fact.title, fact.summary]), ...story.reports.flatMap(report => [report.title, report.content, report.author ?? ''])].join(' ').toLowerCase()
    if (keyword && !text.includes(keyword)) return false
    const latest = Math.max(...story.developments.map(fact => Date.parse(fact.time)))
    return (!start || latest > Date.parse(start)) && (!end || latest <= Date.parse(end))
  }).sort((a, b) => {
    const left = relations.get(a.id)!, right = relations.get(b.id)!
    return (params.has('relatedTo') ? right.symbols.length - left.symbols.length || right.topics.length - left.topics.length : 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
  })
  const previews = new Map(demoNewsStoryPreviews.map(story => [story.id, story]))
  const topicCounts = new Map<string, number>()
  for (const story of demoNewsStories) for (const topic of new Set(story.topics)) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
  return { topics: [...topicCounts].map(([topic, count]) => ({ topic, count })),
    stories: filtered.slice(offset, offset + 50).map(story => {
      const publishers = new Set(story.reports.map(report => newsPublisher({ metadata: { publisher: report.publisher ?? null, link: report.link, role: report.role ?? null, author: report.author ?? null } })).filter(Boolean)).size
      return { ...previews.get(story.id)!, transmission: story.transmission, reading: { heat: 0, participants: 0, publishers, trend: 'unknown' as const, isNew: false, hasUpdate: false, bookmarked: false, locked: false, readProgress: null, ...demoReaderState.get(story.id), important: important(story) } }
    }),
    sources: [...new Set(demoNewsStories.flatMap(story => story.reports.flatMap(report => report.source ? [report.source] : [])))], nextOffset: filtered.length > offset + 50 ? offset + 50 : null }
}
