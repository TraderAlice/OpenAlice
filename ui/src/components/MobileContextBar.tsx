import { PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import type { MobilePageNavigation } from '../contexts/MobilePageNavigationContext'
import { MobileRailMenuButton } from './MobileRailMenuButton'

interface MobileContextBarProps {
  railOpen: boolean
  railTriggerRef: RefObject<HTMLButtonElement | null>
  pageNavigation: MobilePageNavigation | null
  openRail: () => void
  closeRail: () => void
}

export function MobileContextBar({
  railOpen,
  railTriggerRef,
  pageNavigation,
  openRail,
  closeRail,
}: MobileContextBarProps) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="mobile-context-bar"
      className="flex h-12 shrink-0 items-center gap-1 border-b border-border/80 bg-secondary px-3 md:hidden"
    >
      <MobileRailMenuButton
        ref={railTriggerRef}
        open={railOpen}
        controlsId="activity-bar"
        onOpen={() => {
          pageNavigation?.close()
          openRail()
        }}
      />
      {pageNavigation ? (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <button
            ref={pageNavigation.triggerRef}
            type="button"
            onClick={() => {
              closeRail()
              pageNavigation.open()
            }}
            className="oa-icon-action flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('common.openPanel', { title: pageNavigation.title })}
            aria-expanded={pageNavigation.expanded}
            aria-controls={pageNavigation.controlsId}
            aria-haspopup="dialog"
            title={pageNavigation.title}
          >
            <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
          </button>
          <span className="min-w-0 truncate px-1 text-[13px] font-semibold text-foreground">
            {pageNavigation.title}
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate px-1 text-sm font-semibold text-foreground">OpenAlice</span>
      )}
    </div>
  )
}
