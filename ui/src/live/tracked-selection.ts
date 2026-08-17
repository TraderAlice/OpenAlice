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

export interface TrackedIssueSelection {
  workspaceId: string
  issueId: string
}

interface TrackedSelectionState {
  selectedName: string | null
  selectedIssue: TrackedIssueSelection | null
}

interface TrackedSelectionActions {
  select: (name: string | null) => void
  selectIssue: (issue: TrackedIssueSelection) => void
}

export const useTrackedSelection = create<TrackedSelectionState & TrackedSelectionActions>()(
  (set) => ({
    selectedName: null,
    selectedIssue: null,
    select: (name) => set({ selectedName: name, selectedIssue: null }),
    selectIssue: (issue) => set({ selectedName: null, selectedIssue: issue }),
  }),
)
