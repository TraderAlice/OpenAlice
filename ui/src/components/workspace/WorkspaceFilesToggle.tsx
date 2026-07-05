import type { ReactElement } from 'react'
import { PanelRight } from 'lucide-react'

import { useWorkspaceSidePanels } from '../../live/workspace-side-panels'

/**
 * Top-bar toggle for the workspace right pane (the Files panel). One click
 * folds the whole column away so the terminal gets full width, instead of
 * leaving a narrow always-on column. Lives next to "Settings" in
 * WorkspacePage's header; replaces the old Layout popover.
 *
 * State is user-level + persisted (fold it once, it stays folded) — see
 * `useWorkspaceSidePanels`.
 */
export function WorkspaceFilesToggle(): ReactElement {
  const files = useWorkspaceSidePanels((s) => s.files)
  const toggleFiles = useWorkspaceSidePanels((s) => s.toggleFiles)
  return (
    <button
      type="button"
      onClick={toggleFiles}
      aria-pressed={files}
      title={files ? 'Hide the files panel (full-width terminal)' : 'Show the files panel'}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors ${
        files
          ? 'text-text bg-bg-tertiary'
          : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
      }`}
    >
      <PanelRight size={13} strokeWidth={1.8} aria-hidden />
      Files
    </button>
  )
}
