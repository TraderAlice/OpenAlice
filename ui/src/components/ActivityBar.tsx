import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { type Page } from '../App'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection } from '../tabs/types'
import { useUnreadInboxCount } from '../live/inbox-read'
import { usePendingPushCount } from '../live/trading-push'
import { useConnectorWarningCount } from '../live/connector-health'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from './ThemeToggle'
import { useAliceProject } from '../hooks/useAliceProject'
import { useBetaFeatures } from '../live/beta-features'
import { joinNavLayout, NAV_SECTIONS } from './activity-navigation'
import { useUiLayout } from '../hooks/useUiLayout'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SelectionIndicator } from './SelectionIndicator'
import { Button } from '@/components/ui/button'

/**
 * Map ActivityBar page enum (visual layout grouping) to the ActivitySection
 * used by the workspace store. Names are 1:1.
 */
function activitySectionFor(page: Page): ActivitySection {
  switch (page) {
    case 'chat':                 return 'chat'
    case 'auto-quant':           return 'auto-quant'
    case 'prediction':           return 'prediction'
    case 'inbox':                return 'inbox'
    case 'tracked':              return 'tracked'
    case 'workspaces':           return 'workspaces'
    case 'connectors':           return 'connectors'
    case 'settings':             return 'settings'
    case 'dev':                  return 'dev'
    case 'market':               return 'market'
    case 'portfolio':            return 'portfolio'
    case 'issue':                return 'issue'
    case 'automation':           return 'automation'
    case 'office':               return 'office'
  }
}

interface ActivityBarProps {
  open: boolean
  onClose: () => void
  /** True once the rail is static (>= md). The compact rail is desktop-only. */
  desktopStatic?: boolean
  /** Static desktop rail width chosen by App's shell breakpoints. */
  railMode?: 'compact' | 'narrow' | 'full'
  /** Force the static rail into icon-only mode for a compact workbench. */
  compactRailForced?: boolean
  /** Mobile drawer trigger that receives focus again when the drawer closes. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

// ==================== ActivityBar ====================

/**
 * Linear-style left nav. Mobile uses a drawer; desktop keeps a compact
 * text rail. The recessed-rail look comes from bg-tertiary
 * (one elevation step up from the secondary Sidebar and the base main
 * pane) — rail → sidebar → main read as three distinct tiers. Top
 * section (no header) is the pinned product-navigation block — Chat, Inbox,
 * Issues, etc. — always visible. Labeled sections (Beta, System)
 * get collapsible chevron headers; collapse state persists to
 * localStorage.
 *
 * The ActivityBar owns only top-level area selection. Business navigation
 * lives inside each page so surfaces can have their own layout and responsive
 * behavior.
 */
export function ActivityBar({
  open,
  onClose,
  desktopStatic = true,
  railMode = 'full',
  compactRailForced = false,
  returnFocusRef,
}: ActivityBarProps) {
  const { t } = useTranslation()
  const { project } = useAliceProject()
  const officeNav = useBetaFeatures((s) => s.office)
  const { layout } = useUiLayout()
  const navSections = useMemo(
    () => joinNavLayout(NAV_SECTIONS, layout, { product: project?.product, office: officeNav }),
    [layout, officeNav, project?.product],
  )
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const unreadInbox = useUnreadInboxCount()
  const pendingPush = usePendingPushCount()
  const connectorWarnings = useConnectorWarningCount()
  const collapsedSections = useActivityBarCollapse((s) => s.collapsedSections)
  const setCollapsed = useActivityBarCollapse((s) => s.setCollapsed)
  const railCollapsed = useActivityBarCollapse((s) => s.railCollapsed)
  const setRailCollapsed = useActivityBarCollapse((s) => s.setRailCollapsed)
  const shortRailHeight = useMediaQuery('(max-height: 700px)')
  const veryShortRailHeight = useMediaQuery('(max-height: 520px)')
  const [workbenchRailExpanded, setWorkbenchRailExpanded] = useState(false)
  const workbenchRail = selectedSidebar === 'chat' ||
    selectedSidebar === 'auto-quant' ||
    selectedSidebar === 'prediction'
  const constrainedCompactRail = desktopStatic && (
    compactRailForced || railMode === 'compact' || veryShortRailHeight
  )
  const forcedCompactRail = desktopStatic && (
    constrainedCompactRail || (workbenchRail && !workbenchRailExpanded)
  )
  const compactRail = desktopStatic && (
    forcedCompactRail || (railCollapsed && !(workbenchRail && workbenchRailExpanded))
  )
  const canExpandCompactRail = compactRail && !constrainedCompactRail
  const narrowRail = desktopStatic && railMode === 'narrow' && !compactRail
  const denseRail = desktopStatic && shortRailHeight
  const mobileDrawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!workbenchRail) setWorkbenchRailExpanded(false)
  }, [workbenchRail])

  const expandCompactRail = () => {
    if (workbenchRail) {
      setWorkbenchRailExpanded(true)
      return
    }
    setRailCollapsed(false)
  }

  const collapseExpandedRail = () => {
    if (workbenchRail) {
      setWorkbenchRailExpanded(false)
      return
    }
    setRailCollapsed(true)
  }

  const brandMark = canExpandCompactRail ? (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            onClick={expandCompactRail}
            aria-label={t('nav.expandRail')}
            className={`group relative hidden shrink-0 items-center justify-center rounded-md text-sidebar-foreground outline-none transition-[background-color,box-shadow] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] hover:bg-sidebar-accent focus-visible:[box-shadow:var(--oa-focus-shadow)] motion-reduce:transition-none md:flex ${denseRail ? 'size-7' : 'size-8'}`}
          />
        )}
      >
        <img
          src="/alice.ico"
          alt=""
          className={`${denseRail ? 'size-5' : 'size-[22px]'} pointer-events-none absolute object-contain opacity-100 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-0 group-focus-visible:opacity-0 group-focus-visible:[transition-duration:0ms] motion-reduce:transition-none`}
          draggable={false}
          aria-hidden
        />
        <PanelLeftOpen
          size={denseRail ? 15 : 17}
          strokeWidth={1.75}
          className="pointer-events-none absolute opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:[transition-duration:0ms] motion-reduce:transition-none"
          aria-hidden
        />
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{t('nav.expandRail')}</TooltipContent>
    </Tooltip>
  ) : (
    <img
      src="/alice.ico"
      alt="Alice"
      className={`${denseRail ? 'h-6 w-6 md:h-5 md:w-5' : 'h-[22px] w-[22px]'} shrink-0 object-contain`}
      draggable={false}
    />
  )

  const railContent = (
    <>
        <div className={`${denseRail ? 'h-10 md:h-8' : 'h-10'} flex shrink-0 items-center ${compactRail ? 'justify-center px-0' : narrowRail ? 'gap-2 px-3' : 'gap-2.5 px-3.5'}`}>
          {brandMark}
          <h1 className={`min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] tracking-[-0.01em] text-foreground ${compactRail ? 'md:hidden' : ''}`}>OpenAlice</h1>
          {!desktopStatic && (
            <Button
              type="button"
              onClick={onClose}
              aria-label={t('common.closePanel', { title: t('nav.primaryNavigation') })}
              className="-mr-1 shrink-0 text-muted-foreground"
              variant="ghost"
              size="icon"
            >
              <X size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={`flex flex-1 flex-col overflow-x-hidden overflow-y-auto ${denseRail ? 'pb-3 md:pb-1' : 'pb-3 pt-1'} ${compactRail ? 'px-2 md:items-center' : 'px-2'}`}
        >
          {navSections.map((section, si) => {
            const labeled = section.id !== 'primary'
            // User toggle wins over default. The collapse store stores
            // user's explicit preference (true/false); absence means
            // "fall back to defaultCollapsed". Once the user touches a
            // section, their preference is sticky.
            const stored = labeled ? collapsedSections[section.id] : undefined
            const isCollapsed = labeled && (
              stored !== undefined ? stored : Boolean(section.defaultCollapsed)
            )
            const showItems = compactRail ? true : !isCollapsed
            return (
              <div
                key={section.id}
                className={
                  compactRail && si > 0
                    ? `${denseRail ? 'mt-3 pt-3 md:mt-0.5 md:pt-0.5 md:w-8' : 'mt-3 pt-3 md:w-8'} border-t border-sidebar-border/70`
                    : si > 0
                      ? denseRail ? 'mt-2' : 'mt-3'
                      : compactRail
                        ? 'md:w-8'
                        : ''
                }
              >
                {labeled && !compactRail && (
                  <SectionHeader
                    label={section.labelKey ? t(section.labelKey) : section.sectionLabel}
                    description={section.descriptionKey ? t(section.descriptionKey) : undefined}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => setCollapsed(
                      section.id,
                      !isCollapsed,
                      section.defaultCollapsed,
                    )}
                    controlsId={`activity-section-${section.id}`}
                  />
                )}
                {showItems && (
                  <div className={`flex flex-col ${denseRail ? 'gap-1 md:gap-px' : 'gap-px'}`} id={`activity-section-${section.id}`}>
                    {section.items.map((item) => {
                      const sec = activitySectionFor(item.page)
                      const isActive = selectedSidebar === sec
                      const Icon = item.icon
                      let badge: { count: number; label: string; tone: string } | null = null
                      if (item.page === 'inbox' && unreadInbox > 0) {
                        badge = {
                          count: unreadInbox,
                          label: t('nav.unread', { count: unreadInbox }),
                          tone: 'bg-sidebar-foreground text-sidebar',
                        }
                      } else if (item.page === 'portfolio' && pendingPush > 0) {
                        badge = {
                          count: pendingPush,
                          label: t('nav.pendingPush', { count: pendingPush }),
                          tone: 'bg-info text-info-foreground',
                        }
                      } else if (item.page === 'connectors' && connectorWarnings > 0) {
                        badge = {
                          count: connectorWarnings,
                          label: t('nav.connectorNeedsAttention', { count: connectorWarnings }),
                          tone: 'bg-warning text-warning-foreground',
                        }
                      }
                      const handleClick = () => {
                        setSidebar(sec)
                        openOrFocus(item.defaultTab)
                        onClose()
                      }
                      const label = t(item.labelKey)
                      const control = (
                        <button
                          key={item.page}
                          type="button"
                          onClick={handleClick}
                          aria-label={label}
                          aria-current={isActive ? 'page' : undefined}
                          className={`oa-nav-item relative flex items-center rounded-md text-left ${
                            compactRail
                              ? denseRail
                                ? 'md:h-[26px] md:w-8 md:min-h-[26px] md:justify-center md:gap-0 md:px-0 md:py-0'
                                : 'md:h-8 md:w-8 md:min-h-8 md:justify-center md:gap-0 md:px-0 md:py-0'
                              : denseRail
                                ? `min-h-[28px] ${narrowRail ? 'gap-2 px-2' : 'gap-2.5 px-2.5'} py-1 text-[12px]`
                                : 'min-h-10 gap-2.5 px-2.5 py-1 text-[13px] leading-[18px] md:min-h-8'
                          } ${
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                          }`}
                        >
                          {isActive && <SelectionIndicator />}
                          <span className={`oa-nav-icon relative flex h-[18px] w-[18px] shrink-0 items-center justify-center ${denseRail ? 'md:h-3.5 md:w-3.5' : ''}`}>
                            <Icon size={denseRail ? 14 : 15} strokeWidth={1.75} />
                          </span>
                          <span className={`flex-1 truncate ${compactRail ? 'md:hidden' : ''}`}>{label}</span>
                          {badge !== null && (
                            <span
                              aria-label={badge.label}
                              className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] leading-[14px] font-semibold tabular-nums ${badge.tone} ${
                                compactRail ? 'md:absolute md:-right-1 md:-top-1 md:h-4 md:min-w-4 md:px-1 md:text-[9px]' : ''
                              }`}
                            >
                              {badge.count > 99 ? '99+' : badge.count}
                            </span>
                          )}
                        </button>
                      )
                      if (!compactRail || !desktopStatic) return control
                      return (
                        <Tooltip key={item.page}>
                          <TooltipTrigger render={control} />
                          <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Footer — global icon controls pinned to the bottom of the rail. */}
        <div className={`flex shrink-0 items-center ${compactRail ? `${denseRail ? 'py-2 md:py-0.5 md:gap-px' : 'py-2 md:gap-1'} px-4 md:flex-col md:items-center md:px-2` : 'justify-between gap-2 border-t border-border/55 px-2 py-1'}`}>
          <ThemeToggle compact={denseRail} />
          {!compactRail && !constrainedCompactRail && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    onClick={collapseExpandedRail}
                    aria-label={t('nav.collapseRail')}
                    aria-hidden={!desktopStatic ? true : undefined}
                    tabIndex={!desktopStatic ? -1 : undefined}
                    className={`hidden ${denseRail ? 'md:h-[26px] md:w-[26px]' : ''} shrink-0 text-muted-foreground md:flex`}
                    variant="ghost"
                    size="icon"
                  />
                }
              >
                <PanelLeftClose size={denseRail ? 14 : 17} strokeWidth={1.75} aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t('nav.collapseRail')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
    </>
  )

  const railClassName = `
    w-[280px] ${compactRail ? 'md:w-[50px]' : narrowRail ? 'md:w-[152px]' : 'md:w-[188px]'} h-full flex flex-col shrink-0
    bg-sidebar border-r border-sidebar-border/70
  `

  if (desktopStatic) {
    return (
      <aside
        id="activity-bar"
        data-testid="activity-bar"
        data-rail-layout={compactRail ? 'compact' : narrowRail ? 'narrow' : 'full'}
        className={`${railClassName} static z-auto transition-[width] duration-[var(--motion-standard)] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none`}
      >
        {railContent}
      </aside>
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <SheetContent
        ref={mobileDrawerRef}
        id="activity-bar"
        data-testid="activity-bar"
        data-rail-layout="drawer"
        side="left"
        aria-modal="true"
        aria-describedby={undefined}
        showCloseButton={false}
        className={`${railClassName} max-w-[85vw] gap-0 overflow-hidden rounded-r-[20px] p-0 motion-reduce:animate-none motion-reduce:transition-none data-[side=left]:w-[280px] data-[side=left]:max-w-[85vw] sm:max-w-[85vw]`}
        initialFocus={() => {
          const drawer = mobileDrawerRef.current
          const current = drawer?.querySelector<HTMLElement>('[aria-current="page"]')
          const firstAction = drawer?.querySelector<HTMLElement>('button:not([disabled])')
          return current ?? firstAction ?? drawer
        }}
        finalFocus={returnFocusRef ?? undefined}
      >
        <SheetTitle className="sr-only">{t('nav.primaryNavigation')}</SheetTitle>
        {railContent}
      </SheetContent>
    </Sheet>
  )
}

// ==================== SectionHeader ====================

function SectionHeader({
  label,
  description,
  isCollapsed,
  onToggleCollapse,
  controlsId,
}: {
  label: string
  description?: string
  isCollapsed: boolean
  onToggleCollapse: () => void
  controlsId: string
}) {
  const control = (
    <button
      type="button"
      onClick={onToggleCollapse}
      className="mb-0.5 flex min-h-10 w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px] font-medium leading-4 text-muted-foreground/75 transition-colors hover:text-foreground md:min-h-6"
      aria-expanded={!isCollapsed}
      aria-controls={controlsId}
      aria-label={label}
    >
      <ChevronDown
        size={11}
        strokeWidth={2.25}
        className={`shrink-0 transition-transform duration-[var(--motion-fast)] ${
          isCollapsed ? '-rotate-90' : 'rotate-0'
        }`}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </button>
  )
  if (!description) return control
  return (
    <Tooltip>
      <TooltipTrigger render={control} />
      <TooltipContent side="right" sideOffset={8}>{description}</TooltipContent>
    </Tooltip>
  )
}
