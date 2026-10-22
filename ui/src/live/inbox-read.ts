import { create } from 'zustand'
import { api } from '../api'
import {
  inboxLive,
  applyInboxBulkRead,
  setInboxBulkWritePending,
  refreshInbox,
  setInboxReadAtOptimistically,
} from './inbox'
import { readOfficeInboxDutyExcursion } from '../office/inbox-duty-excursion'
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
  markingAllRead: boolean
  markAllRead: () => Promise<number | undefined>
}

export const useInboxRead = create<InboxReadActions>()((set, get) => ({
  markingAllRead: false,
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
  markAllRead: async () => {
    if (get().markingAllRead) return
    set({ markingAllRead: true })
    setInboxBulkWritePending(true)
    const target = readOfficeInboxDutyExcursion()?.duty.destination.inboxEntryId
    try {
      const result = await api.inbox.markAllRead(target ? [target] : [])
      applyInboxBulkRead(result.ids, result.readAt)
      return result.ids.length
    } finally {
      setInboxBulkWritePending(false)
      refreshInbox()
      set({ markingAllRead: false })
    }
  },
}))

/** Shared global count, including entries outside the loaded page. */
export function useUnreadInboxCount(): number {
  return inboxLive.useStore((s) =>
    s.unreadCount ?? s.entries.reduce((n, e) => (e.readAt ? n : n + 1), 0),
  )
}
