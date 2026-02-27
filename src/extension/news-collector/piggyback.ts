/**
 * News Collector — OpenBB piggyback
 *
 * Wraps the existing newsGetWorld / newsGetCompany tool execute functions
 * to capture API results and ingest them into the persistent store.
 * Results are returned to the agent unchanged; ingestion is fire-and-forget.
 */

import type { Tool } from 'ai'
import { computeDedupKey, type NewsCollectorStore } from './store.js'

/**
 * Wrap news tools to piggyback results into the collector store.
 * Accepts and returns the same shape as createNewsTools() output.
 */
export function wrapNewsToolsForPiggyback<T extends Record<string, Tool>>(
  originalTools: T,
  store: NewsCollectorStore,
): T {
  const wrapped = { ...originalTools }

  if (originalTools.newsGetWorld) {
    ;(wrapped as Record<string, Tool>).newsGetWorld = wrapTool(originalTools.newsGetWorld, (result) => {
      ingestOpenBBResults(store, result, 'openbb-world').catch(() => {})
    })
  }

  if (originalTools.newsGetCompany) {
    ;(wrapped as Record<string, Tool>).newsGetCompany = wrapTool(originalTools.newsGetCompany, (result, args) => {
      const symbol = args && typeof args === 'object' && 'symbol' in args ? String(args.symbol) : undefined
      ingestOpenBBResults(store, result, 'openbb-company', symbol).catch(() => {})
    })
  }

  return wrapped
}

// ==================== Helpers ====================

function wrapTool(
  original: Tool,
  onResult: (result: unknown, args: unknown) => void,
): Tool {
  if (!original.execute) return original

  const origExecute = original.execute
  return {
    ...original,
    execute: async (args: unknown, opts: unknown) => {
      const result = await (origExecute as (args: unknown, opts: unknown) => Promise<unknown>)(args, opts)
      onResult(result, args)
      return result
    },
  } as Tool
}

async function ingestOpenBBResults(
  store: NewsCollectorStore,
  result: unknown,
  ingestSource: string,
  symbol?: string,
): Promise<void> {
  // OpenBB returns an array of article objects
  const items = Array.isArray(result) ? result : []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue

    const title = String((item as Record<string, unknown>).title ?? '')
    if (!title) continue

    const raw = item as Record<string, unknown>
    const content = String(raw.text ?? raw.summary ?? raw.content ?? raw.description ?? '')
    const link = raw.url ? String(raw.url) : null
    const dateStr = raw.date ?? raw.published_utc ?? raw.datetime ?? raw.pubDate
    const pubTime = dateStr ? new Date(String(dateStr)) : new Date()
    const id = raw.id ? String(raw.id) : undefined

    const dedupKey = computeDedupKey({
      guid: id,
      link: link ?? undefined,
      title,
      content,
    })

    await store.ingest({
      title,
      content,
      pubTime: isNaN(pubTime.getTime()) ? new Date() : pubTime,
      dedupKey,
      metadata: {
        source: ingestSource,
        link,
        ingestSource,
        dedupKey,
        ...(symbol ? { symbol } : {}),
      },
    })
  }
}
