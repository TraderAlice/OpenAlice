import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/editor-tabs-pref')

/**
 * Whether the editor-area tab strip (TabStrip) is shown.
 *
 * Default **off**: navigation is driven entirely by the left ActivityBar
 * + per-activity sidebars (singletons land on their nav item; workspaces
 * are picked from the Workspaces sidebar, which already shows which one
 * is active — tmux-style). The top tab row turned out to be low-use and
 * just accumulated forgotten tabs. Users who want VS-Code-style tabs
 * (visible open set, ×/middle-click close, right-click menu) flip this on
 * in Settings › Appearance.
 *
 * Client-side preference (localStorage), like `useActivityBarCollapse` —
 * it's pure chrome layout, nothing the server needs to know about.
 */

interface EditorTabsPrefState {
  showEditorTabs: boolean
}

interface EditorTabsPrefActions {
  setShowEditorTabs: (show: boolean) => void
}

export const useEditorTabsPref = create<EditorTabsPrefState & EditorTabsPrefActions>()(
  persist(
    (set) => ({
      showEditorTabs: false,
      setShowEditorTabs: (show) => set({ showEditorTabs: show }),
    }),
    { name: 'openalice.editor-tabs.v1', version: 1 },
  ),
)
