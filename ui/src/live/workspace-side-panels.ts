import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * User preference for the workspace right-pane Files panel.
 *
 * Stored at the user level (not per-workspace) — every workspace has the
 * same Files panel, so a per-workspace toggle would be friction for no
 * payoff. Toggled from the Files button in the workspace header; when off,
 * the right column collapses entirely and the terminal gets full width.
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
      files: true,
      autoHideMobile: true,
      setFiles: (enabled) => set({ files: enabled }),
      toggleFiles: () => set((s) => ({ files: !s.files })),
      setAutoHideMobile: (enabled) => set({ autoHideMobile: enabled }),
    }),
    { name: 'openalice.workspace.side-panels.v1', version: 2 },
  ),
)
