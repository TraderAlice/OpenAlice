import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/workspace-side-panels')

/**
 * View state for the workspace right-pane Files panel.
 *
 * Shared at runtime (not per-workspace) — every workspace has the same Files
 * panel, so a per-workspace toggle would be friction for no payoff. Toggled
 * from the Files button in the workspace header; when off, the right column
 * collapses entirely and the terminal gets full width.
 *
 * Files always starts collapsed when the UI loads. Opening a temporary tool
 * panel must not turn it into the default layout for later visits, so `files`
 * is deliberately excluded from persisted state.
 *
 * `autoHideMobile` gives sub-md viewports their own transient Files state.
 * Default true: a desktop preference must not make a 360px panel appear when
 * a phone first opens a Workspace. Mobile users can still open Files
 * explicitly; that choice is intentionally reset on reload.
 *
 * (The Git panel was removed — nobody reads workspace git by hand anymore,
 * the agent does. So this is Files-only now.)
 */

interface WorkspaceSidePanelsState {
  files: boolean
  autoHideMobile: boolean
  mobileFilesOpen: boolean
}

interface WorkspaceSidePanelsActions {
  setFiles: (enabled: boolean) => void
  toggleFiles: () => void
  setAutoHideMobile: (enabled: boolean) => void
  setMobileFilesOpen: (enabled: boolean) => void
  toggleMobileFiles: () => void
}

export const useWorkspaceSidePanels = create<WorkspaceSidePanelsState & WorkspaceSidePanelsActions>()(
  persist(
    (set) => ({
      files: false,
      autoHideMobile: true,
      mobileFilesOpen: false,
      setFiles: (enabled) => set({ files: enabled }),
      toggleFiles: () => set((s) => ({ files: !s.files })),
      setAutoHideMobile: (enabled) => set({ autoHideMobile: enabled }),
      setMobileFilesOpen: (enabled) => set({ mobileFilesOpen: enabled }),
      toggleMobileFiles: () => set((s) => ({ mobileFilesOpen: !s.mobileFilesOpen })),
    }),
    {
      name: 'openalice.workspace.side-panels.v1',
      // Version 4 retires the persisted desktop Files toggle. The migration
      // keeps the responsive preference while discarding any legacy
      // `files: true` value.
      version: 4,
      migrate: (persistedState) => {
        const previous = persistedState as Partial<WorkspaceSidePanelsState> | undefined
        return {
          autoHideMobile: previous?.autoHideMobile ?? true,
        }
      },
      partialize: ({ autoHideMobile }) => ({ autoHideMobile }),
    },
  ),
)
