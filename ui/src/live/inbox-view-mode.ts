import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/inbox-view-mode')

/**
 * Inbox sidebar view mode.
 *
 * - `time`      — flat chronological feed of every push, newest-first,
 *                 date-bucketed. The "what happened recently across
 *                 everything" notification view.
 * - `workspace` — pushes clustered under their workspace; each cluster
 *                 ordered by its latest push, so a workspace bubbles to
 *                 the top whenever it sends a new message. The "catch up
 *                 per agent" view.
 *
 * Either way selection + detail stay per-push (a workspace's pushes are
 * usually unrelated topics; clustering is a sidebar affordance, not a
 * merge). Persisted so the choice survives reloads.
 */

export type InboxViewMode = 'time' | 'workspace'

interface InboxViewModeState {
  mode: InboxViewMode
}

interface InboxViewModeActions {
  setMode: (mode: InboxViewMode) => void
}

export const useInboxViewMode = create<InboxViewModeState & InboxViewModeActions>()(
  persist(
    (set) => ({
      mode: 'workspace',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'openalice.inbox-view-mode.v1', version: 1 },
  ),
)
