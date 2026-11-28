/**
 * Inbox detail resource cache & greedy warming helpers.
 *
 * Keeps per-entry `files` metadata, `inquiries` threads, and small text/Markdown
 * attachment previews (< 128 KB) in the shared pure-memory `resourceCache`,
 * warmed via `prefetchScheduler` at `low` priority so switching entries or
 * opening inline `[[report.md]]` previews is instant over remote links.
 */
import { inboxFiles } from '@traderalice/connector-protocol'
import { api } from '../api'
import type { FetchRequestInit } from '../api/client'
import type { InboxEntry, InboxFile } from '../api/inbox'
import type { InquiryRecord } from '../api/inquiries'
import type { ReadFileResult } from '../components/workspace/api'
import type { PrefetchPriority } from '../lib/prefetch-scheduler'
import { resourceCache } from '../lib/resource-cache'

export const PREVIEWABLE_TEXT_RE = /\.(md|markdown|html?|txt|json|csv|log)$/i
export const MAX_PREFETCH_TEXT_BYTES = 128 * 1024 // 128 KB
const MAX_PREFETCH_FILES_PER_ENTRY = 2
const FILES_STALE_MS = 60_000
const PREVIEW_STALE_MS = 60_000
const INQUIRIES_STALE_MS = 30_000

export function inboxFilesCacheKey(entryId: string): string {
  return `inbox:files:${entryId}`
}

export function inboxFilePreviewCacheKey(href: string): string {
  return `inbox:file-text:${href}`
}

export function inboxInquiriesCacheKey(entryId: string): string {
  return `inquiries:inbox:${entryId}`
}

export function isPreviewableTextFile(path: string): boolean {
  return PREVIEWABLE_TEXT_RE.test(path)
}

export function fetchInboxFilesCached(
  entryId: string,
  opts: { priority?: PrefetchPriority; force?: boolean } = {},
): Promise<InboxFile[]> {
  const priority = opts.priority ?? 'high'
  return resourceCache.fetch<InboxFile[]>(
    inboxFilesCacheKey(entryId),
    async ({ etag, priority: effectivePriority }) => {
      const res = await api.inbox.files(entryId, {
        ifNoneMatch: etag,
        priority: effectivePriority,
      })
      if (res.notModified) {
        return { notModified: true, etag: res.etag }
      }
      return { data: res.files, etag: res.etag }
    },
    {
      priority,
      staleTimeMs: FILES_STALE_MS,
      force: opts.force,
    },
  )
}

export function fetchInboxFilePreviewCached(
  href: string,
  opts: { priority?: PrefetchPriority; force?: boolean; maxBytes?: number } = {},
): Promise<ReadFileResult> {
  const priority = opts.priority ?? 'high'
  return resourceCache.fetch<ReadFileResult>(
    inboxFilePreviewCacheKey(href),
    async ({ etag, priority: effectivePriority }) => {
      const reqHeaders: Record<string, string> = {}
      if (etag) reqHeaders['If-None-Match'] = etag
      const init: FetchRequestInit = {
        ...(etag ? { headers: reqHeaders } : {}),
        priority: effectivePriority,
      }
      const response = await fetch(href, init)
      const nextEtag = response.headers.get('etag') ?? etag
      if (response.status === 304) {
        return { notModified: true, etag: nextEtag }
      }
      if (response.status === 404) {
        return { data: { kind: 'file_missing' }, etag: nextEtag }
      }
      if (!response.ok) {
        return { data: { kind: 'error', message: `HTTP ${response.status}` }, etag: nextEtag }
      }
      if (opts.maxBytes !== undefined) {
        const lenHeader = response.headers.get('content-length')
        const contentLen = lenHeader ? Number(lenHeader) : NaN
        if (Number.isFinite(contentLen) && contentLen > opts.maxBytes) {
          throw new Error('prefetch_file_too_large')
        }
      }
      const content = await response.text()
      if (opts.maxBytes !== undefined && content.length > opts.maxBytes) {
        throw new Error('prefetch_file_too_large')
      }
      return { data: { kind: 'ok', content }, etag: nextEtag }
    },
    {
      priority,
      staleTimeMs: PREVIEW_STALE_MS,
      force: opts.force,
      estimateBytes: (result) => (result.kind === 'ok' ? result.content.length * 2 : 64),
    },
  )
}

export function fetchInboxInquiriesCached(
  entryId: string,
  opts: { priority?: PrefetchPriority; force?: boolean } = {},
): Promise<InquiryRecord[]> {
  const priority = opts.priority ?? 'high'
  return resourceCache.fetch<InquiryRecord[]>(
    inboxInquiriesCacheKey(entryId),
    async ({ priority: effectivePriority }) => (
      api.inquiries.forInbox(entryId, { priority: effectivePriority })
    ),
    {
      priority,
      staleTimeMs: INQUIRIES_STALE_MS,
      force: opts.force,
    },
  )
}

/**
 * Greedily warm one Inbox entry's detail resources (`files`, `inquiries`,
 * and up to 2 small text/Markdown previews < 128 KB) at low priority.
 * Never throws; failures are silently ignored so background warming never
 * surfaces noise.
 */
export function warmInboxEntry(entry: InboxEntry, priority: PrefetchPriority = 'low'): void {
  if (!entry?.id) return

  // 1. Warm inquiries thread.
  void fetchInboxInquiriesCached(entry.id, { priority }).catch(() => {})

  // 2. Warm files metadata + small text previews if the entry references files.
  const referenced = inboxFiles(entry)
  if (referenced.length === 0) return

  void fetchInboxFilesCached(entry.id, { priority })
    .then((files) => {
      let warmed = 0
      for (const file of files) {
        if (warmed >= MAX_PREFETCH_FILES_PER_ENTRY) break
        if (!file.available || !isPreviewableTextFile(file.path)) continue
        if (typeof file.size === 'number' && file.size > MAX_PREFETCH_TEXT_BYTES) continue
        warmed++
        void fetchInboxFilePreviewCached(file.href, {
          priority,
          maxBytes: MAX_PREFETCH_TEXT_BYTES,
        }).catch(() => {})
      }
    })
    .catch(() => {})
}

/** Warm the top N Inbox entries (default 5) in background. */
export function warmTopInboxEntries(entries: readonly InboxEntry[], count = 5): void {
  const limit = Math.min(count, entries.length)
  for (let i = 0; i < limit; i++) {
    const entry = entries[i]
    if (entry) warmInboxEntry(entry, 'low')
  }
}

/** Warm the entries immediately adjacent (`±1`) to the active selection. */
export function warmAdjacentInboxEntries(entries: readonly InboxEntry[], selectedId: string | null): void {
  if (!selectedId || entries.length <= 1) return
  const idx = entries.findIndex((e) => e.id === selectedId)
  if (idx < 0) return
  if (idx > 0 && entries[idx - 1]) warmInboxEntry(entries[idx - 1]!, 'low')
  if (idx + 1 < entries.length && entries[idx + 1]) warmInboxEntry(entries[idx + 1]!, 'low')
}
