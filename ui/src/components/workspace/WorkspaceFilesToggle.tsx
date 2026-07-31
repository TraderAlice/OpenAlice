import type { ReactElement } from 'react'
import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useIsDesktop } from '../../live/use-is-desktop'
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels'

/**
 * Top-bar toggle for the workspace right pane (the Files panel). One click
 * folds the whole column away so the terminal gets full width, instead of
 * leaving a narrow always-on column. Lives next to "Settings" in
 * WorkspacePage's header; replaces the old Layout popover.
 *
 * Desktop state is runtime-only so a new UI load starts collapsed. Auto-hidden
 * mobile layouts use a separate transient overlay state so the control never
 * claims a hidden panel is open.
 */
export function WorkspaceFilesToggle(): ReactElement {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const { files, autoHideMobile, mobileFilesOpen, toggleFiles, toggleMobileFiles } =
    useWorkspaceSidePanels()
  const usesMobileOverlay = !isDesktop && autoHideMobile
  const filesVisible = usesMobileOverlay ? mobileFilesOpen : files
  return (
    <button
      type="button"
      onClick={usesMobileOverlay ? toggleMobileFiles : toggleFiles}
      aria-pressed={filesVisible}
      title={filesVisible ? t('workspace.hideFilesTitle') : t('workspace.showFilesTitle')}
      className={`workspace-files-toggle flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors ${
        filesVisible
          ? 'text-foreground bg-muted'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      <PanelRight size={13} strokeWidth={1.8} aria-hidden />
      {t('workspace.files')}
    </button>
  )
}
