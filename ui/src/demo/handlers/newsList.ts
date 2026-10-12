import { http, HttpResponse } from 'msw'

import { resolveNewsFeedUrl } from '../../../../src/domain/news/config'
import { artifactSchema, NEWS_MODULE_LIMITS } from '../../../../src/domain/news/modules/contract'

import { demoNewsArticles } from '../fixtures/news'
import { demoNewsInstalledModules, getDemoNewsConfig } from './configKeys'

import type { NewsListResponse } from '../../api/types'
import type { ModuleStatus, NewsModuleArtifact } from '../../../../src/domain/news/modules/contract'

const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
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

function includesText(article: { title: string; content: string; categories: string | null }, value: string): boolean {
  const haystack = [article.title, article.content, article.categories ?? ''].join('\n').toLowerCase()
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

/** Mirrors the production News list contract, including range and text filters. */
export const newsListHandlers = [
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
    return HttpResponse.json({ ok: true })
  }),
  http.get('/api/news', ({ request }) => {
    const params = new URL(request.url).searchParams
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
    const sourceFilters = source
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    const keyword = params.get('keyword')?.trim().toLowerCase() ?? ''
    const symbol = params.get('symbol')?.trim().toLowerCase() ?? ''
    const limit = parseLimit(params.get('limit'))

    const filtered = demoNewsArticles.filter((article) => {
      const articleTime = Date.parse(article.time)
      if (!(articleTime > startTime && articleTime <= endTime)) return false
      if (sourceFilters?.length && !sourceFilters.includes((article.source ?? '').toLowerCase())) return false
      if (keyword && !includesText(article, keyword)) return false
      if (symbol && !includesText(article, symbol)) return false
      return true
    })
    const items = filtered
      .sort(compareNewsArticles)
      .slice(-limit)
      .map((article) => ({ ...article, image: article.image ?? null }))
    const body: NewsListResponse = {
      items,
      count: items.length,
      lookback: startText ? null : lookback,
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
