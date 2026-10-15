/**
 * Best-effort direct client for Gelonghui's live news API.
 *
 * This endpoint is undocumented and returns only the latest items; it can
 * change without notice. Other news sources continue to use RSS/Atom.
 */

import type { ParsedFeedItem } from './rss-parser.js'

export const GELONGHUI_API_URL = 'https://www.gelonghui.com/api/live-channels/all/lives/v4'
export const GELONGHUI_SOURCE_PAGE_URL = 'https://www.gelonghui.com/live'

/** Convert the observed Gelonghui response envelope into collector items. */
export function parseGelonghuiResponse(payload: unknown): ParsedFeedItem[] {
  if (!payload || typeof payload !== 'object') return []
  const response = payload as { statusCode?: unknown; result?: unknown }
  if (response.statusCode !== 200 || !Array.isArray(response.result)) return []

  const items: ParsedFeedItem[] = []
  for (const value of response.result) {
    if (!value || typeof value !== 'object') continue
    const entry = value as {
      id?: unknown
      title?: unknown
      content?: unknown
      createTimestamp?: unknown
      route?: unknown
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : entry.id
    if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) continue
    if (id === '') continue
    if (typeof entry.content !== 'string' || !entry.content.trim()) continue

    const guid = String(id)
    const content = entry.content.trim()
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : content
    const link = typeof entry.route === 'string' && entry.route.trim() ? entry.route.trim() : null
    const timestamp = typeof entry.createTimestamp === 'number' && Number.isFinite(entry.createTimestamp)
      ? new Date(entry.createTimestamp * 1000)
      : null

    items.push({
      title,
      content,
      link,
      guid,
      pubDate: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null,
    })
  }
  return items
}

/** Fetch the current page of live items; pagination is not exposed here. */
export async function fetchGelonghuiLives(): Promise<ParsedFeedItem[]> {
  const response = await fetch(GELONGHUI_API_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', 'User-Agent': 'OpenAlice/1.0 NewsCollector' },
  })
  if (!response.ok) throw new Error('Gelonghui fetch failed: ' + response.status + ' ' + response.statusText)
  const payload: unknown = await response.json()
  return parseGelonghuiResponse(payload)
}
