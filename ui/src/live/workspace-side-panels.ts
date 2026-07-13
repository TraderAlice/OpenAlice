import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/workspace-side-panels')

/**
 * User preference for the workspace right-pane Files panel.
 *
 * Stored at the user level (not per-workspace) — every workspace has the
 * same Files panel, so a per-workspace toggle would be friction for no
 * payoff. Toggled from the Files button in the workspace header; when off,
 * the right column collapses entirely and the terminal gets full width.
 *
 * Defaults to collapsed: in day-to-day chat-workspace use almost nobody
 * reads the raw files tree, so the terminal getting full width is the
 * better resting state. Users who do want it flip the Files button once
 * and the preference sticks.
 *
 * `autoHideMobile` hides the panel at sub-md viewports regardless. Default
 * true: on a phone, the right column eating 360px is worse than not seeing
 * files at all.
 *
 * (The Git panel was removed — nobody reads workspace git by hand anymore,
 * the agent does. So this is Files-only now.)
 */

interface WorkspaceSidePanelsState {
  files: boolean
  autoHideMobile: boolean
}

interface WorkspaceSidePanelsActions {
  setFiles: (enabled: boolean) => void
  toggleFiles: () => void
  setAutoHideMobile: (enabled: boolean) => void
}

export const useWorkspaceSidePanels = create<WorkspaceSidePanelsState & WorkspaceSidePanelsActions>()(
  persist(
    (set) => ({
      files: false,
      autoHideMobile: true,
      setFiles: (enabled) => set({ files: enabled }),
      toggleFiles: () => set((s) => ({ files: !s.files })),
      setAutoHideMobile: (enabled) => set({ autoHideMobile: enabled }),
    }),
    // version bumped 2 → 3 to reset the old `files: true` default for
    // existing users (no migrate → persisted state is discarded, falling
    // back to the new collapsed default).
    { name: 'openalice.workspace.side-panels.v1', version: 3 },
  ),
)
