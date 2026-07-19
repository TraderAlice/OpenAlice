import { ChevronDown, Info, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Page } from '../App'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection } from '../tabs/types'
import { useUnreadInboxCount } from '../live/inbox-read'
import { usePendingPushCount } from '../live/trading-push'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from './ThemeToggle'
import { NAV_SECTIONS } from './activity-navigation'

/**
 * Map ActivityBar page enum (visual layout grouping) to the ActivitySection
 * used by the workspace store. Names are 1:1.
 */
function activitySectionFor(page: Page): ActivitySection {
  switch (page) {
    case 'chat':                 return 'chat'
    case 'inbox':                return 'inbox'
    case 'tracked':              return 'tracked'
    case 'workspaces':           return 'workspaces'
    case 'trading-as-git':       return 'trading-as-git'
    case 'connectors':           return 'connectors'
    case 'settings':             return 'settings'
    case 'dev':                  return 'dev'
    case 'market':               return 'market'
    case 'portfolio':            return 'portfolio'
    case 'issue':                return 'issue'
    case 'automation':           return 'automation'
    case 'news':                 return 'news'
  }
}

interface ActivityBarProps {
  open: boolean
  onClose: () => void
  /** True once the rail is static (>= md). The compact rail is desktop-only. */
  desktopStatic?: boolean
  /** Static desktop rail width chosen by App's shell breakpoints. */
  railMode?: 'compact' | 'narrow' | 'full'
  /** Force the static rail into icon-only mode at narrow desktop widths. */
  compactRailForced?: boolean
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
}: ActivityBarProps) {
  const { t } = useTranslation()
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const unreadInbox = useUnreadInboxCount()
  const pendingPush = usePendingPushCount()
  const collapsedSections = useActivityBarCollapse((s) => s.collapsedSections)
  const setCollapsed = useActivityBarCollapse((s) => s.setCollapsed)
  const railCollapsed = useActivityBarCollapse((s) => s.railCollapsed)
  const setRailCollapsed = useActivityBarCollapse((s) => s.setRailCollapsed)
  const shortRailHeight = useMediaQuery('(max-height: 700px)')
  const veryShortRailHeight = useMediaQuery('(max-height: 520px)')
  const forcedCompactRail = desktopStatic && (
    compactRailForced || railMode === 'compact' || veryShortRailHeight
  )
  const compactRail = desktopStatic && (forcedCompactRail || railCollapsed)
  const narrowRail = desktopStatic && railMode === 'narrow' && !compactRail
  const denseRail = desktopStatic && shortRailHeight

  return (
    <>
      {/* Backdrop — mobile only */}
      <div
        className={`fixed inset-0 bg-backdrop z-40 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* ActivityBar — Linear-style workspace rail. Mobile: slide-in over
       *  page with backdrop. Desktop: static column flush left. */}
      <aside
        className={`
          w-[280px] ${compactRail ? 'md:w-[60px]' : narrowRail ? 'md:w-[152px]' : 'md:w-[188px]'} h-full flex flex-col shrink-0
          bg-muted
          border-r border-border/80
          fixed z-50 top-0 left-0 transition-[transform,width] duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto
        `}
      >
        {/* Branding — h-10 to line up with the Sidebar header + TabStrip
            (all three top surfaces share the 40px header rhythm). */}
        <div className={`${denseRail ? 'h-10 mb-2 md:h-7 md:mb-0.5' : 'h-10 mb-2'} flex items-center shrink-0 ${compactRail ? 'justify-center px-0' : narrowRail ? 'pl-[18px] pr-3 gap-2' : 'pl-[22px] pr-4 gap-2.5'}`}>
          <img
            src="/alice.ico"
            alt="Alice"
            className={`${denseRail ? 'h-6 w-6 md:h-5 md:w-5' : 'h-6 w-6'} shrink-0 rounded-full ring-1 ring-border shadow-[0_0_14px_var(--primary-muted)]`}
            draggable={false}
          />
          <h1 className={`min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground ${compactRail ? 'md:hidden' : ''}`}>OpenAlice</h1>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 flex flex-col overflow-x-hidden overflow-y-auto ${denseRail ? 'pb-3 md:pb-0.5' : 'pb-3'} ${compactRail ? 'px-2 md:items-center' : narrowRail ? 'px-2.5' : 'px-3'}`}>
          {NAV_SECTIONS.map((section, si) => {
            const labeled = section.sectionLabel.length > 0
            // User toggle wins over default. The collapse store stores
            // user's explicit preference (true/false); absence means
            // "fall back to defaultCollapsed". Once the user touches a
            // section, their preference is sticky.
            const stored = labeled ? collapsedSections[section.sectionLabel] : undefined
            const isCollapsed = labeled && (
              stored !== undefined ? stored : Boolean(section.defaultCollapsed)
            )
            const showItems = compactRail ? true : !isCollapsed
            return (
              <div
                key={si}
                className={
                  compactRail && si > 0
                    ? `${denseRail ? 'mt-3 pt-3 md:mt-0.5 md:pt-0.5 md:w-8' : 'mt-3 pt-3 md:w-11'} border-t border-border/70`
                    : si > 0
                      ? denseRail ? 'mt-2' : 'mt-4'
                      : compactRail
                        ? denseRail ? 'md:w-8' : 'md:w-11'
                        : ''
                }
              >
                {labeled && !compactRail && (
                  <SectionHeader
                    label={section.labelKey ? t(section.labelKey) : section.sectionLabel}
                    description={section.descriptionKey ? t(section.descriptionKey) : undefined}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => setCollapsed(
                      section.sectionLabel,
                      !isCollapsed,
                      section.defaultCollapsed,
                    )}
                    controlsId={`activity-section-${si}`}
                    showItems={showItems}
                  />
                )}
                {showItems && (
                  <div className={`oa-disclosure-enter flex flex-col ${denseRail ? 'gap-1 md:gap-px' : 'gap-1'}`} id={`activity-section-${si}`}>
                    {section.items.map((item) => {
                      const sec = activitySectionFor(item.page)
                      const isActive = selectedSidebar === sec
                      const Icon = item.icon
                      const handleClick = () => {
                        setSidebar(sec)
                        openOrFocus(item.defaultTab)
                        onClose()
                      }
                      return (
                        <button
                          key={item.page}
                          type="button"
                          onClick={handleClick}
                          title={t(item.labelKey)}
                          className={`oa-nav-item relative flex items-center rounded-md text-left ${
                            compactRail
                              ? denseRail
                                ? 'md:h-[26px] md:w-8 md:min-h-[26px] md:justify-center md:gap-0 md:px-0 md:py-0'
                                : 'md:h-9 md:w-11 md:min-h-9 md:justify-center md:gap-0 md:px-0 md:py-0'
                              : denseRail
                                ? `min-h-[28px] ${narrowRail ? 'gap-2 px-2' : 'gap-2.5 px-2.5'} py-1 text-[12px]`
                                : `min-h-[34px] ${narrowRail ? 'gap-2 px-2.5' : 'gap-3 px-3'} py-1.5 text-[13px]`
                          } ${
                            isActive
                              ? 'bg-primary-muted text-foreground'
                              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                          }`}
                        >
                          {/* Active indicator — left vertical bar */}
                          <span
                            className={`absolute left-0 ${denseRail ? 'top-1.5 bottom-1.5 md:top-0.5 md:bottom-0.5' : 'top-1.5 bottom-1.5'} w-[2px] rounded-r-full bg-primary transition-opacity duration-150 ${
                              isActive ? 'opacity-100' : 'opacity-0'
                            }`}
                            aria-hidden
                          />
                          <span className={`oa-nav-icon relative flex items-center justify-center w-5 h-5 shrink-0 ${denseRail ? 'md:w-3.5 md:h-3.5' : ''}`}>
                            <Icon size={denseRail ? 14 : 16} strokeWidth={1.75} />
                          </span>
                          <span className={`flex-1 truncate ${compactRail ? 'md:hidden' : ''}`}>{t(item.labelKey)}</span>
                          {item.page === 'inbox' && unreadInbox > 0 && (
                            <span
                              aria-label={t('nav.unread', { count: unreadInbox })}
                              className={`shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums flex items-center justify-center ${
                                compactRail ? 'md:absolute md:-right-1 md:-top-1 md:h-4 md:min-w-4 md:px-1 md:text-[9px]' : ''
                              }`}
                            >
                              {unreadInbox > 99 ? '99+' : unreadInbox}
                            </span>
                          )}
                          {item.page === 'trading-as-git' && pendingPush > 0 && (
                            <span
                              aria-label={t('nav.pendingPush', { count: pendingPush })}
                              className={`shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums flex items-center justify-center ${
                                compactRail ? 'md:absolute md:-right-1 md:-top-1 md:h-4 md:min-w-4 md:px-1 md:text-[9px]' : ''
                              }`}
                            >
                              {pendingPush > 99 ? '99+' : pendingPush}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Footer — global icon controls pinned to the bottom of the rail. */}
        <div className={`shrink-0 flex items-center ${compactRail ? `${denseRail ? 'py-2 md:py-0.5 md:gap-px' : 'py-2 md:gap-1'} px-4 md:flex-col md:items-center md:px-2` : `${narrowRail ? 'px-3' : 'px-4'} border-t border-border py-1.5 justify-between gap-2`}`}>
          <ThemeToggle compact={denseRail} />
          {!forcedCompactRail && (
            <button
              type="button"
              onClick={() => setRailCollapsed(!railCollapsed)}
              title={t(railCollapsed ? 'nav.expandRail' : 'nav.collapseRail')}
              aria-label={t(railCollapsed ? 'nav.expandRail' : 'nav.collapseRail')}
              className={`oa-icon-action hidden ${denseRail ? 'h-9 w-9 md:h-[26px] md:w-[26px]' : 'h-9 w-9'} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex`}
            >
              {railCollapsed
                ? <PanelLeftOpen size={denseRail ? 14 : 17} strokeWidth={1.75} aria-hidden />
                : <PanelLeftClose size={denseRail ? 14 : 17} strokeWidth={1.75} aria-hidden />}
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

// ==================== SectionHeader ====================

/**
 * Section header row: collapse-toggle on the left + optional (i)
 * disclosure on the right that expands the section's `description`
 * prose inline below the row, pushing items down.
 *
 * Why inline rather than a floating popover: the nav uses
 * `overflow-y: auto` for scrolling, which clips horizontally-
 * overflowing absolute children. An inline disclosure sidesteps that
 * entirely and lets the prose use full sidebar width.
 *
 * Hint visibility is component-local state — every fresh mount starts
 * collapsed. Intentional: the description is reference info, not a
 * preference worth persisting.
 */
function SectionHeader({
  label,
  description,
  isCollapsed,
  onToggleCollapse,
  controlsId,
  showItems,
}: {
  label: string
  description?: string
  isCollapsed: boolean
  onToggleCollapse: () => void
  controlsId: string
  showItems: boolean
}) {
  const { t } = useTranslation()
  const [hintOpen, setHintOpen] = useState(false)
  return (
    <>
      <div className="flex items-center px-3 mb-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex min-h-7 flex-1 items-center gap-1.5 py-1 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={!isCollapsed}
          aria-controls={controlsId}
          title={label}
        >
          <ChevronDown
            size={12}
            strokeWidth={2.25}
            className={`shrink-0 transition-transform duration-150 ${
              isCollapsed ? '-rotate-90' : 'rotate-0'
            }`}
            aria-hidden
          />
          <span>{label}</span>
        </button>
        {description && (
          <button
            type="button"
            onClick={() => setHintOpen((o) => !o)}
            className={`flex min-h-7 min-w-7 items-center justify-center p-0.5 transition-colors ${
              hintOpen ? 'text-muted-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'
            }`}
            aria-label={t('nav.about', { label })}
            aria-expanded={hintOpen}
          >
            <Info size={11} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      {showItems && description && hintOpen && (
        <p className="oa-disclosure-enter mb-2 px-3 text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </>
  )
}
