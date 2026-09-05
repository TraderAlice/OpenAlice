import { http, HttpResponse } from 'msw'

import type { NewsListResponse } from '../../api/types'
import { demoNewsArticles } from '../fixtures/news'

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

/** Mirrors the production News list contract, including range and text filters. */
export const newsListHandlers = [
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
]

function compareNewsArticles(a: { time: string; title: string }, b: { time: string; title: string }): number {
  const aTime = Date.parse(a.time)
  const bTime = Date.parse(b.time)
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
}
