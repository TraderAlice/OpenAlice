import type { ReactElement } from 'react'
import { useHarnessWorkbenchContext } from '../harness/context'
import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useIsDesktop } from '../../live/use-is-desktop'
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { Button } from '../ui/button'

/** Harness header: one icon disclosure with an accessible name and tooltip.
 * Standalone workspace views retain their existing Files control. */
export function WorkspaceFilesToggle(): ReactElement {
  const { t } = useTranslation()
  const workbench = useHarnessWorkbenchContext()
  const isDesktop = useIsDesktop()
  const { files, autoHideMobile, mobileFilesOpen, toggleFiles, toggleMobileFiles } =
    useWorkspaceSidePanels()
  const usesMobileOverlay = !isDesktop && autoHideMobile
  const filesVisible = workbench ? workbench.open : usesMobileOverlay ? mobileFilesOpen : files
  const label = workbench ? t('workbench.title') : t('workspace.files')
  const button = (
    <Button
      variant="ghost"
      size={workbench ? "icon" : "sm"}
      onClick={workbench ? workbench.toggle : usesMobileOverlay ? toggleMobileFiles : toggleFiles}
      aria-pressed={filesVisible}
      aria-label={label}
      aria-expanded={filesVisible}
      className={`workspace-files-toggle text-[11px] ${
        filesVisible
          ? 'text-foreground bg-muted'
          : 'text-muted-foreground'
      }`}
    >
      <PanelRight size={workbench ? 17 : 13} strokeWidth={1.8} aria-hidden />
      {!workbench && label}
    </Button>
  )
  return <Tooltip><TooltipTrigger render={button} /><TooltipContent>{label}</TooltipContent></Tooltip>
}
