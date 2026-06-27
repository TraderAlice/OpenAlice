import { type LucideIcon, MessageSquare, Inbox, Telescope, LineChart, GitBranch, BarChart3, Newspaper, Zap, Settings, Code2, TerminalSquare, ChevronDown, Info, ListChecks } from 'lucide-react'
import { useState } from 'react'
import { type Page } from '../App'
import { findSectionForActivity } from '../sections'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection, ViewSpec } from '../tabs/types'
import { useUnreadInboxCount } from '../live/inbox-read'
import { usePendingPushCount } from '../live/trading-push'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from './ThemeToggle'

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
  /**
   * Whether the secondary sidebar is actually on screen right now (a static
   * panel on wide, or the open drawer on narrow). Re-clicking the active
   * item only *collapses* the sidebar when it's visible; if it's hidden
   * (e.g. landed on /portfolio at a tablet width with the drawer closed),
   * re-clicking re-opens it instead of toggling the selection off. Defaults
   * to true so the collapse gesture works when the prop isn't wired.
   */
  sidebarVisible?: boolean
  /**
   * Called after the user activates an item. Receives the activity the user
   * landed on (or null if they collapsed the current one by re-clicking it).
   * The parent uses this on mobile to drill into the secondary sidebar drawer
   * instead of dismissing entirely. Desktop layouts can ignore it.
   */
  onItemActivated?: (section: ActivitySection | null) => void
}

// ==================== Nav item definitions ====================

type NavItemKey =
  | 'nav.item.inbox' | 'nav.item.tracked' | 'nav.item.chat' | 'nav.item.workspaces'
  | 'nav.item.market' | 'nav.item.news' | 'nav.item.tradingAsGit' | 'nav.item.issue'
  | 'nav.item.portfolio' | 'nav.item.automation' | 'nav.item.settings' | 'nav.item.dev'

interface NavLeaf {
  page: Page
  labelKey: NavItemKey
  icon: LucideIcon
  /**
   * What tab opens when this ActivityBar item is clicked.
   *
   * - **Set**: clicking the icon both reveals the sidebar AND opens (or
   *   focuses) this tab. Used for activities with a meaningful default
   *   landing page — e.g. Portfolio's Overview, News, Automation.
   * - **Omitted**: sidebar-only activity. Click reveals the sidebar; tabs
   *   are created from sidebar interactions. Used when there's no canonical
   *   "all of X" view (Chat, Settings, Dev) or no tab at all (Trading-as-Git).
   *
   * Same-section re-click always collapses the sidebar regardless of this
   * field; the focused tab isn't touched on collapse.
   */
  defaultTab?: ViewSpec
}

interface NavSection {
  /** Stable identity — the collapse-state storage key and the labeled-vs-
   *  pinned check. '' = the unlabeled top section. Display comes from
   *  `labelKey`, not this. */
  sectionLabel: string
  /** i18n key for the displayed section header (labeled sections only). */
  labelKey?: 'nav.section.beta' | 'nav.section.system'
  items: NavLeaf[]
  /** When true, the section starts collapsed on a user's first visit
   *  (or after they clear localStorage). User-toggled collapse state
   *  still wins — `defaultCollapsed` only fills in the absence-of-key
   *  default. Useful for "this section exists but isn't the recommended
   *  path" framing (Legacy). */
  defaultCollapsed?: boolean
  /** i18n key for the muted-text paragraph rendered between the section
   *  header and its items (visible only when expanded) — e.g. Beta's
   *  lifecycle hint. */
  descriptionKey?: 'nav.betaDescription'
}

const NAV_SECTIONS: NavSection[] = [
  // Top — primary nav, always visible (no header, not collapsible).
  // Mental model: Chat (Ask Alice) is THE entry — for an AI product the
  // chat surface is the front door (how you use the thing), so it sits at
  // the very top, above Inbox (which is task sync, not the core loop).
  // Workspaces (the all-templates index) is the power-user surface for
  // hands-on session management; the two aren't redundant (Workspaces =
  // whole set, Chat = chat-shape subset shortcut), but because day-to-day
  // work rarely leaves Ask Alice, Workspaces sits at the bottom of this
  // group rather than alongside Chat.
  //
  // Market / News are operational tools that work but aren't load-
  // bearing — they live here because they don't need lifecycle
  // labelling.
  {
    sectionLabel: '',
    items: [
      { page: 'chat',       labelKey: 'nav.item.chat',       icon: MessageSquare, defaultTab: { kind: 'chat-landing', params: {} } },
      { page: 'inbox',      labelKey: 'nav.item.inbox',      icon: Inbox, defaultTab: { kind: 'inbox', params: {} } },
      { page: 'issue',      labelKey: 'nav.item.issue',      icon: ListChecks, defaultTab: { kind: 'issue', params: {} } },
      { page: 'tracked',    labelKey: 'nav.item.tracked',    icon: Telescope, defaultTab: { kind: 'tracked', params: {} } },
      { page: 'market',     labelKey: 'nav.item.market',     icon: BarChart3 },
      { page: 'news',       labelKey: 'nav.item.news',       icon: Newspaper, defaultTab: { kind: 'news', params: {} } },
      { page: 'workspaces', labelKey: 'nav.item.workspaces', icon: TerminalSquare },
    ],
  },
  // Beta — functional but not yet dependable. Cross-broker unification
  // (UTA abstraction, FX/options/futures) is in active rearchitecture:
  // Portfolio surfaces that state, Trading-as-Git is the operations side
  // (pending broker writes). The data runs; the schema/UX underneath isn't
  // settled. (Scheduled work now surfaces on the Issues board in the top group;
  // Automation moved down to System as the headless-run / API / event-bus ops
  // side.) Broker connection CRUD lives under
  // Settings → Trading, not here — it's a config surface, not state/ops.
  {
    sectionLabel: 'Beta',
    labelKey: 'nav.section.beta',
    descriptionKey: 'nav.betaDescription',
    items: [
      { page: 'trading-as-git', labelKey: 'nav.item.tradingAsGit', icon: GitBranch },
      { page: 'portfolio',      labelKey: 'nav.item.portfolio',    icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
    ],
  },
  {
    sectionLabel: 'System',
    labelKey: 'nav.section.system',
    items: [
      // Automation lives here now: Issues (the board) is the primary
      // management surface, and scheduled issues fire from there. Automation
      // is the operations/plumbing side (headless runs, API, event bus) —
      // System chrome, not a daily-driver nav target.
      { page: 'automation', labelKey: 'nav.item.automation', icon: Zap, defaultTab: { kind: 'automation', params: { section: 'runs' } } },
      { page: 'settings', labelKey: 'nav.item.settings', icon: Settings },
      { page: 'dev',      labelKey: 'nav.item.dev',      icon: Code2 },
    ],
  },
]

// ==================== ActivityBar ====================

/**
 * Linear-style left nav. 200px wide on desktop; on mobile (<md) it
 * slides in over the page from the left as a 280px drawer (matching
 * the secondary drawer so a drill-in doesn't jump width), on desktop
 * it's a static column. The recessed-rail look comes from bg-tertiary
 * (one elevation step up from the secondary Sidebar and the base main
 * pane) — rail → sidebar → main read as three distinct tiers. Top
 * section (no header) is the pinned-nav block — Chat, Inbox,
 * Workspaces, etc. — always visible. Labeled sections (Agent, System)
 * get collapsible chevron headers; collapse state persists to
 * localStorage.
 *
 * The wider layout (vs VS Code's 56px icon-only column) is deliberate
 * for OpenAlice's current phase: items in the bar live in different
 * lifecycle stages and the section labels are how we'll later
 * communicate that. Mostly-icon view would hide the differentiation.
 */
export function ActivityBar({ open, onClose, onItemActivated, sidebarVisible = true }: ActivityBarProps) {
  const { t } = useTranslation()
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const unreadInbox = useUnreadInboxCount()
  const pendingPush = usePendingPushCount()
  const collapsedSections = useActivityBarCollapse((s) => s.collapsedSections)
  const setCollapsed = useActivityBarCollapse((s) => s.setCollapsed)

  return (
    <>
      {/* Backdrop — mobile only */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* ActivityBar — Linear-style workspace rail. Mobile: slide-in over
       *  page with backdrop. Desktop: static column flush left. */}
      <aside
        className={`
          w-[280px] md:w-[200px] h-full flex flex-col shrink-0
          bg-bg-tertiary
          border-r border-border/80
          fixed z-50 top-0 left-0 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto md:transition-none
        `}
      >
        {/* Branding — h-10 to line up with the Sidebar header + TabStrip
            (all three top surfaces share the 40px header rhythm). */}
        <div className="h-10 px-4 flex items-center gap-2.5 shrink-0">
          <img
            src="/alice.ico"
            alt="Alice"
            className="w-6 h-6 rounded-full ring-1 ring-border shadow-[0_0_14px_var(--color-accent-dim)]"
            draggable={false}
          />
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">OpenAlice</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col px-3 overflow-y-auto pb-3">
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
            const showItems = !isCollapsed
            return (
              <div key={si} className={si > 0 ? 'mt-4' : ''}>
                {labeled && (
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
                  <div className="flex flex-col gap-1" id={`activity-section-${si}`}>
                    {section.items.map((item) => {
                      const sec = activitySectionFor(item.page)
                      const isActive = selectedSidebar === sec
                      const Icon = item.icon
                      // Sidebar-less activity (no entry in SECTION_BY_KEY):
                      // pure navigation — clicking opens the default tab
                      // full-width; no collapse toggle, no secondary drawer.
                      const hasSidebar = findSectionForActivity(sec) != null
                      const handleClick = () => {
                        let landedOn: ActivitySection | null
                        if (selectedSidebar === sec && hasSidebar && sidebarVisible) {
                          // Same section re-clicked while the sidebar is on
                          // screen: collapse it. Don't touch the focused tab —
                          // collapsing the sidebar shouldn't change the editor.
                          // (When the sidebar is hidden — e.g. a closed drawer
                          // at tablet width — we fall through to the else branch
                          // and re-open it instead of toggling selection off.)
                          setSidebar(null)
                          landedOn = null
                        } else {
                          setSidebar(sec)
                          // Activities with a meaningful default landing (e.g.
                          // Portfolio overview) jump straight to it. Sidebar-only
                          // activities (Chat, Settings, Trading-as-Git, …) leave
                          // tab focus alone — user picks from the sidebar.
                          if (item.defaultTab) openOrFocus(item.defaultTab)
                          // Sidebar-less activities report null so mobile
                          // dismisses instead of opening the secondary drawer.
                          landedOn = hasSidebar ? sec : null
                        }
                        // Let parent decide the mobile transition (drill into
                        // secondary drawer vs dismiss). Default: just close.
                        if (onItemActivated) onItemActivated(landedOn)
                        else onClose()
                      }
                      return (
                        <button
                          key={item.page}
                          type="button"
                          onClick={handleClick}
                          title={t(item.labelKey)}
                          className={`relative flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors text-left ${
                            isActive
                              ? 'bg-accent-dim text-text'
                              : 'text-text-muted hover:text-text hover:bg-overlay'
                          }`}
                        >
                          {/* Active indicator — left vertical bar */}
                          <span
                            className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent transition-opacity duration-150 ${
                              isActive ? 'opacity-100' : 'opacity-0'
                            }`}
                            aria-hidden
                          />
                          <span className="relative flex items-center justify-center w-5 h-5 shrink-0">
                            <Icon size={16} strokeWidth={1.75} />
                          </span>
                          <span className="flex-1 truncate">{t(item.labelKey)}</span>
                          {item.page === 'inbox' && unreadInbox > 0 && (
                            <span
                              aria-label={t('nav.unread', { count: unreadInbox })}
                              className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red text-[10px] font-semibold text-white tabular-nums flex items-center justify-center"
                            >
                              {unreadInbox > 99 ? '99+' : unreadInbox}
                            </span>
                          )}
                          {item.page === 'trading-as-git' && pendingPush > 0 && (
                            <span
                              aria-label={t('nav.pendingPush', { count: pendingPush })}
                              className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red text-[10px] font-semibold text-white tabular-nums flex items-center justify-center"
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

        {/* Footer — global toggles pinned to the bottom of the rail.
            py-1.5 matches the nav-item rhythm above (the top border
            already provides the separation). */}
        <div className="shrink-0 border-t border-border px-3 py-1.5">
          <ThemeToggle />
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
          className="flex-1 flex items-center gap-1.5 py-1 text-[12px] font-semibold text-text-muted/75 hover:text-text-muted transition-colors text-left"
          aria-expanded={!isCollapsed}
          aria-controls={controlsId}
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
            className={`flex items-center justify-center p-0.5 transition-colors ${
              hintOpen ? 'text-text-muted' : 'text-text-muted/50 hover:text-text-muted'
            }`}
            aria-label={t('nav.about', { label })}
            aria-expanded={hintOpen}
          >
            <Info size={11} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      {showItems && description && hintOpen && (
        <p className="px-3 mb-2 text-[11px] text-text-muted/60 leading-relaxed">
          {description}
        </p>
      )}
    </>
  )
}
