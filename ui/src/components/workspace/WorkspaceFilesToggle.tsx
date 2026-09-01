import type { ReactElement } from 'react'
import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useIsDesktop } from '../../live/use-is-desktop'
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels'
import { Button } from '../ui/button'

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
    <Button
      variant="ghost"
      size="sm"
      onClick={usesMobileOverlay ? toggleMobileFiles : toggleFiles}
      aria-pressed={filesVisible}
      className={`workspace-files-toggle text-[11px] ${
        filesVisible
          ? 'text-foreground bg-muted'
          : 'text-muted-foreground'
      }`}
    >
      <PanelRight size={13} strokeWidth={1.8} aria-hidden />
      {t('workspace.files')}
    </Button>
  )
}
