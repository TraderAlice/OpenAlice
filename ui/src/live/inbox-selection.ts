import { create } from 'zustand'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/inbox-selection')

/**
 * Client-side selection state for the Inbox. Lives outside `ViewSpec` so
 * that selecting a different entry from the sidebar doesn't churn tab
 * identity (one Inbox tab, selection mutates inside it — Linear-style).
 *
 * Selection is a single **entry id** (one push). The sidebar clusters
 * pushes by workspace for visual kinship, but each push is selected and
 * viewed on its own — a workspace's pushes are usually unrelated topics,
 * so they aren't merged into one combined view.
 *
 * Not persisted: selection is ephemeral UI state, no value to remember
 * across reloads.
 */

interface InboxSelectionState {
  selectedEntryId: string | null
}

interface InboxSelectionActions {
  select: (id: string | null) => void
}

export const useInboxSelection = create<InboxSelectionState & InboxSelectionActions>()((set) => ({
  selectedEntryId: null,
  select: (id) => set({ selectedEntryId: id }),
}))
