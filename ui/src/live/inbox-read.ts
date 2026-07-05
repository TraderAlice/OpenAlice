import { create } from 'zustand'
import { api } from '../api'
import {
  inboxLive,
  refreshInbox,
  setInboxReadAtOptimistically,
} from './inbox'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/inbox-read')

/**
 * Per-entry read tracking for the Inbox — Linear-style.
 *
 * Why per-entry, not a timestamp watermark: in an inbox-flow product,
 * "read" and "unread" are state-machine categories of attention, not
 * cosmetic indicators. Bulk-marking everything read on page visit (the
 * watermark approach) destroys the user's ability to triage — open inbox
 * with 10 unread items, look at one, all 10 silently become read. Per-entry
 * tracking preserves the "you've actively touched this one" semantic.
 *
 * Read state is server-side file state (`data/inbox/read-state.json`). The
 * frontend only applies optimistic `readAt` updates into the loaded feed; the
 * next `/api/inbox/history` poll remains authoritative. This matters for the
 * desktop app: Electron, browser dev, and Docker/self-hosted clients should all
 * see the same attention state when they share the same OpenAlice data root.
 */

interface InboxReadActions {
  /** Mark a single entry as read. Called by the sidebar when an entry
   *  becomes selected (click, j/k nav, default-select-latest). */
  markRead: (id: string) => void
  /** Mark a single entry as unread — reverses markRead. UI affordance
   *  to expose this (a context-menu "Mark unread" item, hover button,
   *  shift+u shortcut) is parked for v1; the action is here so it's
   *  trivial to wire when we decide to add it. */
  markUnread: (id: string) => void
  /** Mark every currently-loaded entry as read. Reserved for a future
   *  explicit "Mark all as read" button — not auto-fired anywhere. */
  markAllRead: () => void
}

export const useInboxRead = create<InboxReadActions>()(() => ({
  markRead: (id) => {
    const entry = inboxLive.getState().entries.find((e) => e.id === id)
    if (entry?.readAt) return
    const optimisticReadAt = Date.now()
    setInboxReadAtOptimistically(id, optimisticReadAt)
    void api.inbox.markRead(id)
      .then((res) => setInboxReadAtOptimistically(id, res.readAt))
      .catch(() => refreshInbox())
  },
  markUnread: (id) => {
    setInboxReadAtOptimistically(id, null)
    void api.inbox.markUnread(id)
      .catch(() => refreshInbox())
  },
  markAllRead: () => {
    const unread = inboxLive.getState().entries.filter((e) => !e.readAt)
    if (unread.length === 0) return
    const optimisticReadAt = Date.now()
    for (const entry of unread) {
      setInboxReadAtOptimistically(entry.id, optimisticReadAt)
    }
    void Promise.all(unread.map((entry) => api.inbox.markRead(entry.id)))
      .then((results) => {
        for (const result of results) {
          setInboxReadAtOptimistically(result.id, result.readAt)
        }
      })
      .catch(() => refreshInbox())
  },
}))

/** Activity-bar badge count: loaded entries without a server read marker. */
export function useUnreadInboxCount(): number {
  return inboxLive.useStore((s) =>
    s.entries.reduce((n, e) => (e.readAt ? n : n + 1), 0),
  )
}
