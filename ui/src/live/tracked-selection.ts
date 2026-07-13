import { create } from 'zustand'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/tracked-selection')

/**
 * Client-side selection state for the Tracked tab. Lives outside `ViewSpec`
 * so picking a different entity from the sidebar doesn't churn tab identity
 * (one Tracked tab, selection mutates inside it — same model as the Inbox).
 *
 * Not persisted: ephemeral UI state, no value across reloads.
 */

interface TrackedSelectionState {
  selectedName: string | null
}

interface TrackedSelectionActions {
  select: (name: string | null) => void
}

export const useTrackedSelection = create<TrackedSelectionState & TrackedSelectionActions>()(
  (set) => ({
    selectedName: null,
    select: (name) => set({ selectedName: name }),
  }),
)
