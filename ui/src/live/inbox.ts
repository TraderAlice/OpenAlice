import { api } from '../api'
import type { InboxEntry } from '../api/inbox'
import { createLiveStore } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/inbox')

/**
 * Live inbox feed. 20s polling against `/api/inbox/history`. Mirrors the
 * notifications live store — same rationale: passive feed, SSE not worth
 * the kept-open-connection cost.
 *
 * Single shared connection via LiveStore refcount; multiple subscribers
 * (sidebar list, detail page, Activity bar unread badge) share one timer.
 *
 * Two side-channel helpers (`refreshInbox` / `removeInboxOptimistically`)
 * are exported alongside for the delete flow: optimistic removal flips
 * the entry out of state immediately so the UI doesn't lag the
 * DELETE round-trip, then a refresh confirms truth from the server.
 */

export interface InboxState {
  entries: InboxEntry[]
  /** True until the initial history fetch resolves. UI shows a skeleton. */
  loading: boolean
}

const POLL_INTERVAL_MS = 20_000

/** Module-level setter populated by the subscribe callback so external
 *  callers can mutate state through the same `apply` channel. Null when
 *  no subscriber is mounted; calls become no-ops in that window which
 *  is harmless (delete actions originate from mounted UI). */
let applyState: ((next: InboxState | ((prev: InboxState) => InboxState)) => void) | null = null
let triggerRefresh: (() => void) | null = null

export const inboxLive = createLiveStore<InboxState>({
  name: 'inbox',
  initialState: { entries: [], loading: true },
  subscribe: ({ apply }) => {
    let disposed = false

    async function refresh() {
      try {
        const { entries } = await api.inbox.history({ limit: 100 })
        if (disposed) return
        apply((prev) => ({ ...prev, entries, loading: false }))
      } catch {
        if (disposed) return
        apply((prev) => ({ ...prev, loading: false }))
      }
    }

    applyState = apply
    triggerRefresh = refresh

    void refresh()
    const intervalId = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(intervalId)
      applyState = null
      triggerRefresh = null
    }
  },
})

/** Force an immediate refresh from /api/inbox/history. Used after
 *  a DELETE to reconcile state with the server. Safe to call even
 *  with no subscriber mounted (no-op). */
export function refreshInbox(): void {
  triggerRefresh?.()
}

/** Optimistically remove an entry from the in-memory list before the
 *  DELETE round-trip completes. Pairs with `refreshInbox()` after the
 *  request lands so server state is the source of truth either way. */
export function removeInboxOptimistically(id: string): void {
  applyState?.((prev) => ({
    ...prev,
    entries: prev.entries.filter((e) => e.id !== id),
  }))
}

/** Optimistically mirror server-side read-state writes in the loaded feed.
 *  The next /history poll remains authoritative and will reconcile drift. */
export function setInboxReadAtOptimistically(id: string, readAt: number | null): void {
  applyState?.((prev) => ({
    ...prev,
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
