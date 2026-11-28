import { api } from '../api'
import type { InboxEntry } from '../api/inbox'
import { createLiveStore } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'
import { prefetchScheduler } from '../lib/prefetch-scheduler'
import { reconcileJsonCollection } from '../lib/reconcile-json-state'
import { warmTopInboxEntries } from './inbox-cache'

reloadOnHotUpdate('live/inbox')

/**
 * Live inbox feed with two-stage progressive hydration and conditional ETag/304
 * polling against `/api/inbox/history`.
 *
 * - Stage 1 (fast cold paint): fetches the newest `INITIAL_PAGE_SIZE` (20)
 *   entries immediately so the sidebar, unread badge, and first item render
 *   without blocking on 100 full Markdown bodies over remote links.
 * - Stage 2 (background backfill): low-priority prefetch appends the next 80
 *   entries (`before=<oldest>`, total 100) and warms detail resources for the
 *   top 5 entries.
 * - Periodic 20s refresh sends `If-None-Match` so unchanged polls return 0-byte
 *   `304 Not Modified`, while preserving any deeper pages loaded via
 *   `loadOlderInbox()`.
 */

export const INITIAL_INBOX_PAGE_SIZE = 20
export const STAGE2_BACKFILL_CHUNK_SIZE = 40
export const HEAD_INBOX_PAGE_SIZE = 100
export const LOAD_OLDER_INBOX_PAGE_SIZE = 50

export interface InboxState {
  entries: InboxEntry[]
  /** Global server count, including rows outside the loaded page. */
  unreadCount?: number
  /** True when the server still has older entries beyond the loaded tail. */
  hasMore?: boolean
  /** True while an explicit "Load older" page request is in flight. */
  loadingMore?: boolean
  /** True until the initial history fetch resolves. UI shows a skeleton. */
  loading: boolean
}

export function reconcileInboxHistoryState(
  current: InboxState,
  incomingEntries: InboxEntry[],
  unreadCount = current.unreadCount,
  hasMore = current.hasMore,
): InboxState {
  const entries = reconcileJsonCollection(current.entries, incomingEntries, (entry) => entry.id)
  if (
    entries === current.entries
    && !current.loading
    && unreadCount === current.unreadCount
    && hasMore === current.hasMore
  ) {
    return current
  }
  return {
    ...current,
    entries,
    loading: false,
    ...(unreadCount === undefined ? {} : { unreadCount }),
    ...(hasMore === undefined ? {} : { hasMore }),
  }
}

/**
 * Merge a freshly polled head window (up to 100 newest entries) with any older
 * tail pages previously loaded via `loadOlderInbox()`.
 */
export function mergeHeadWithLoadedTail(
  previousEntries: readonly InboxEntry[],
  incomingHead: readonly InboxEntry[],
  incomingHasMore: boolean,
  previousHasMore: boolean | undefined,
): { entries: InboxEntry[]; hasMore: boolean } {
  if (!incomingHasMore || incomingHead.length === 0 || previousEntries.length <= incomingHead.length) {
    return { entries: [...incomingHead], hasMore: incomingHasMore }
  }
  const headIds = new Set(incomingHead.map((e) => e.id))
  const oldestHeadId = incomingHead[incomingHead.length - 1]!.id
  const tailStartIdx = previousEntries.findIndex((e) => e.id === oldestHeadId)
  if (tailStartIdx < 0) {
    return { entries: [...incomingHead], hasMore: incomingHasMore }
  }
  const preservedTail = previousEntries
    .slice(tailStartIdx + 1)
    .filter((entry) => !headIds.has(entry.id))
  if (preservedTail.length === 0) {
    return { entries: [...incomingHead], hasMore: incomingHasMore }
  }
  return {
    entries: [...incomingHead, ...preservedTail],
    hasMore: previousHasMore ?? incomingHasMore,
  }
}

const POLL_INTERVAL_MS = 20_000

let applyState: ((next: InboxState | ((prev: InboxState) => InboxState)) => void) | null = null
let revision = 0
let bulkWriteRevision = 0
let bulkWritePending = false
let triggerRefresh: ((opts?: { force?: boolean }) => void) | null = null
let triggerLoadOlder: (() => Promise<void>) | null = null

export const inboxLive = createLiveStore<InboxState>({
  name: 'inbox',
  initialState: { entries: [], loading: true, hasMore: false, loadingMore: false },
  subscribe: ({ apply }) => {
    let disposed = false
    let request = 0
    let headEtag: string | undefined
    let stage2Scheduled = false
    let loadingOlderInFlight: Promise<void> | null = null
    let warmedInitial = false

    async function runStage2Backfill(initialOldestId: string, totalRemaining: number) {
      let cursor: string | undefined = initialOldestId
      let remaining = totalRemaining
      while (!disposed && remaining > 0 && cursor) {
        const chunkLimit = Math.min(STAGE2_BACKFILL_CHUNK_SIZE, remaining)
        const startedBulkRevision = bulkWriteRevision
        const pageCursor: string = cursor
        try {
          const res = await prefetchScheduler.schedule(
            'inbox:stage2-backfill',
            () => api.inbox.history({ before: pageCursor, limit: chunkLimit, priority: 'low' }),
            'low',
            { front: true },
          )
          if (disposed || bulkWritePending || startedBulkRevision !== bulkWriteRevision) return
          if (res.notModified || res.entries.length === 0) return
          headEtag = undefined
          apply((prev) => {
            const existingIds = new Set(prev.entries.map((e) => e.id))
            const appended = res.entries.filter((e) => !existingIds.has(e.id))
            if (appended.length === 0 && prev.hasMore === res.hasMore) return prev
            const merged = appended.length > 0 ? [...prev.entries, ...appended] : prev.entries
            return {
              ...prev,
              entries: merged,
              hasMore: res.hasMore,
            }
          })
          if (!res.hasMore) return
          remaining -= res.entries.length
          cursor = res.entries[res.entries.length - 1]?.id
        } catch {
          // Background backfill failure is non-fatal; next head poll will recover.
          return
        }
      }
    }

    async function refresh(opts: { force?: boolean; initial?: boolean } = {}) {
      const startedRequest = ++request
      const startedRevision = revision
      const currentState = inboxLive.getState()
      const isInitialCold = opts.initial === true && currentState.entries.length === 0
      const limit = isInitialCold ? INITIAL_INBOX_PAGE_SIZE : HEAD_INBOX_PAGE_SIZE
      const ifNoneMatch = opts.force || isInitialCold ? undefined : headEtag
      const priority = opts.force || isInitialCold ? 'high' : 'low'

      try {
        const res = await api.inbox.history({ limit, ifNoneMatch, priority })
        if (disposed || bulkWritePending || startedRequest !== request || startedRevision !== revision) return
        if (res.notModified) {
          if (res.etag) headEtag = res.etag
          return
        }
        if (limit === HEAD_INBOX_PAGE_SIZE) {
          headEtag = res.etag
        }

        apply((prev) => {
          const merged = isInitialCold
            ? { entries: res.entries, hasMore: res.hasMore }
            : mergeHeadWithLoadedTail(prev.entries, res.entries, res.hasMore, prev.hasMore)
          return reconcileInboxHistoryState(prev, merged.entries, res.unreadCount, merged.hasMore)
        })

        if (
          isInitialCold
          && !stage2Scheduled
          && res.hasMore
          && res.entries.length >= INITIAL_INBOX_PAGE_SIZE
        ) {
          stage2Scheduled = true
          const oldest = res.entries[res.entries.length - 1]
          if (oldest) {
            void runStage2Backfill(oldest.id, HEAD_INBOX_PAGE_SIZE - res.entries.length)
          }
        }

        if (!warmedInitial && res.entries.length > 0) {
          warmedInitial = true
          warmTopInboxEntries(res.entries, 5)
        }
      } catch {
        if (disposed) return
        apply((prev) => (prev.loading ? { ...prev, loading: false } : prev))
      }
    }

    async function loadOlder(): Promise<void> {
      if (disposed) return
      if (loadingOlderInFlight) return loadingOlderInFlight
      prefetchScheduler.cancel('inbox:stage2-backfill')
      const state = inboxLive.getState()
      if (!state.hasMore || state.entries.length === 0) return
      const oldest = state.entries[state.entries.length - 1]
      if (!oldest) return

      const startedBulkRevision = bulkWriteRevision
      apply((prev) => ({ ...prev, loadingMore: true }))

      const run = (async () => {
        try {
          const res = await api.inbox.history({
            before: oldest.id,
            limit: LOAD_OLDER_INBOX_PAGE_SIZE,
            priority: 'high',
          })
          if (disposed || bulkWritePending || startedBulkRevision !== bulkWriteRevision) {
            if (!disposed) apply((prev) => ({ ...prev, loadingMore: false }))
            return
          }
          apply((prev) => {
            const existingIds = new Set(prev.entries.map((e) => e.id))
            const appended = res.entries.filter((e) => !existingIds.has(e.id))
            const merged = appended.length > 0 ? [...prev.entries, ...appended] : prev.entries
            return {
              ...prev,
              entries: merged,
              hasMore: res.hasMore,
              loadingMore: false,
            }
          })
        } catch {
          if (!disposed) {
            apply((prev) => ({ ...prev, loadingMore: false }))
          }
        } finally {
          loadingOlderInFlight = null
        }
      })()

      loadingOlderInFlight = run
      return run
    }

    applyState = apply
    triggerRefresh = (opts) => { void refresh({ force: opts?.force ?? true }) }
    triggerLoadOlder = loadOlder

    void refresh({ initial: true })
    const intervalId = setInterval(() => { void refresh() }, POLL_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(intervalId)
      applyState = null
      triggerRefresh = null
      triggerLoadOlder = null
    }
  },
})

/** Force an immediate authoritative refresh from /api/inbox/history. Used after
 *  a DELETE to reconcile state with the server. Safe to call even with no
 *  subscriber mounted (no-op). */
export function refreshInbox(): void {
  triggerRefresh?.({ force: true })
}

/** Load the next page of older Inbox entries beyond the currently loaded tail. */
export function loadOlderInbox(): Promise<void> {
  return triggerLoadOlder?.() ?? Promise.resolve()
}

/** Remove a server-confirmed deletion from the in-memory list immediately.
 *  Pairs with `refreshInbox()` so server state remains authoritative. */
export function removeInboxAfterDelete(id: string): void {
  revision++
  applyState?.((prev) => ({
    ...prev,
    unreadCount: prev.unreadCount === undefined ? undefined : Math.max(0, prev.unreadCount - (prev.entries.some((e) => e.id === id && !e.readAt) ? 1 : 0)),
    entries: prev.entries.filter((e) => e.id !== id),
  }))
}

/** Optimistically mirror server-side read-state writes in the loaded feed.
 *  The next /history poll remains authoritative and will reconcile drift. */
export function setInboxReadAtOptimistically(id: string, readAt: number | null): void {
  revision++
  applyState?.((prev) => ({
    ...prev,
    unreadCount: prev.unreadCount === undefined ? undefined : Math.max(0, prev.unreadCount + (prev.entries.some((e) => e.id === id && Boolean(e.readAt) !== Boolean(readAt)) ? (readAt ? -1 : 1) : 0)),
    entries: prev.entries.map((entry) => {
      if (entry.id !== id) return entry
      if (readAt == null) {
        const next = { ...entry }
        delete next.readAt
        return next
      }
      return { ...entry, readAt }
    }),
  }))
}

/** Apply only server-confirmed IDs, retaining selection, ordering and new arrivals. */
export function applyInboxBulkRead(ids: string[], readAt: number, unreadCount: number): void {
  revision++
  bulkWriteRevision++
  const marked = new Set(ids)
  applyState?.((prev) => ({
    ...prev,
    unreadCount,
    entries: prev.entries.map((entry) => marked.has(entry.id) ? { ...entry, readAt } : entry),
  }))
}

/** Discard polls spanning a bulk write so counts cannot be decremented twice. */
export function setInboxBulkWritePending(pending: boolean): void {
  bulkWritePending = pending
  revision++
  bulkWriteRevision++
}
