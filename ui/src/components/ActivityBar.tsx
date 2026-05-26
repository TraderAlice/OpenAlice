import { type LucideIcon, MessageSquare, MessagesSquare, Inbox, Bell, LineChart, GitBranch, BarChart3, Newspaper, Zap, Settings, Code2, TerminalSquare, ChevronDown, Plug, Landmark, Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { type Page } from '../App'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection, ViewSpec } from '../tabs/types'
import { useUnreadInboxCount } from '../live/inbox-read'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'

/**
 * Map ActivityBar page enum (visual layout grouping) to the ActivitySection
 * used by the workspace store. Names are 1:1.
 */
function activitySectionFor(page: Page): ActivitySection {
  switch (page) {
    case 'chat':                 return 'chat'
    case 'inbox':                return 'inbox'
    case 'workspaces':           return 'workspaces'
    case 'trading-as-git':       return 'trading-as-git'
    case 'settings':             return 'settings'
    case 'dev':                  return 'dev'
    case 'market':               return 'market'
    case 'portfolio':            return 'portfolio'
    case 'automation':           return 'automation'
    case 'news':                 return 'news'
    case 'traditional-chat':     return 'traditional-chat'
    case 'notifications-legacy': return 'notifications-legacy'
    case 'connectors-legacy':    return 'connectors-legacy'
    case 'trading-accounts':     return 'trading-accounts'
  }
}

interface ActivityBarProps {
  open: boolean
  onClose: () => void
  /**
   * Called after the user activates an item. Receives the activity the user
   * landed on (or null if they collapsed the current one by re-clicking it).
   * The parent uses this on mobile to drill into the secondary sidebar drawer
   * instead of dismissing entirely. Desktop layouts can ignore it.
   */
  onItemActivated?: (section: ActivitySection | null) => void
}

// ==================== Nav item definitions ====================

interface NavLeaf {
  page: Page
  label: string
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
  sectionLabel: string
  items: NavLeaf[]
  /** When true, the section starts collapsed on a user's first visit
   *  (or after they clear localStorage). User-toggled collapse state
   *  still wins — `defaultCollapsed` only fills in the absence-of-key
   *  default. Useful for "this section exists but isn't the recommended
   *  path" framing (Legacy). */
  defaultCollapsed?: boolean
  /** Optional muted-text paragraph rendered between the section header
   *  and its items (visible only when the section is expanded). Use
   *  this to communicate lifecycle stage — e.g. Beta's "stuff here
   *  works but expect churn" hint. Plain text; keep short. */
  description?: string
}

function getNavSections(t: TFunction): NavSection[] {
  return [
  {
    sectionLabel: '',
    items: [
      { page: 'inbox',      label: t('inbox.title', 'Inbox'),      icon: Inbox, defaultTab: { kind: 'inbox', params: {} } },
      { page: 'chat',       label: t('chat.title', 'Chat'),       icon: MessageSquare },
      { page: 'workspaces', label: t('workspaces.title', 'Workspaces'), icon: TerminalSquare },
      { page: 'market',     label: t('market.title', 'Market'),     icon: BarChart3 },
      { page: 'news',       label: t('news.title', 'News'),       icon: Newspaper, defaultTab: { kind: 'news', params: {} } },
    ],
  },
  {
    sectionLabel: t('activityBar.beta', 'Beta'),
    description: t('activityBar.betaDescription', "Goal here is a unified abstraction across broker accounts (deposit/withdraw, options, futures, FX). Large engineering effort, no fixed timeline. Configure and try, but don't depend on schema or UX as stable yet."),
    items: [
      { page: 'trading-accounts', label: t('trading.title', 'Trading Accounts'), icon: Landmark, defaultTab: { kind: 'settings', params: { category: 'trading' } } },
      { page: 'trading-as-git',   label: t('trading.tradingAsGit', 'Trading as Git'),   icon: GitBranch },
      { page: 'portfolio',        label: t('portfolio.title', 'Portfolio'),        icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
    ],
  },
  {
    sectionLabel: t('activityBar.system', 'System'),
    items: [
      { page: 'settings', label: t('settings.title', 'Settings'), icon: Settings },
      { page: 'dev',      label: t('dev.title', 'Dev'),      icon: Code2 },
    ],
  },
  {
    sectionLabel: t('activityBar.legacy', 'Legacy'),
    defaultCollapsed: true,
    items: [
      { page: 'traditional-chat',     label: t('activityBar.traditionalChat', 'Traditional chat'), icon: MessagesSquare },
      { page: 'notifications-legacy', label: t('activityBar.notifications', 'Notifications'),    icon: Bell, defaultTab: { kind: 'notifications-inbox', params: {} } },
      { page: 'connectors-legacy',    label: t('connectors.title', 'Connectors'),       icon: Plug, defaultTab: { kind: 'settings', params: { category: 'connectors' } } },
      { page: 'automation',           label: t('automation.title', 'Automation'),       icon: Zap, defaultTab: { kind: 'automation', params: { section: 'flow' } } },
    ],
  },
]
}

// ==================== ActivityBar ====================

/**
 * Linear-style left nav. 200px wide on all viewports; on mobile (<md)
 * it slides in over the page from the left, on desktop it's a static
 * column. Top section (no header) is the pinned-nav block — Chat,
 * Inbox, Workspaces, etc. — always visible. Labeled sections (Agent,
 * System) get collapsible chevron headers; collapse state persists
 * to localStorage.
 *
 * The wider layout (vs VS Code's 56px icon-only column) is deliberate
 * for OpenAlice's current phase: items in the bar live in different
 * lifecycle stages and the section labels are how we'll later
 * communicate that. Mostly-icon view would hide the differentiation.
 */
export function ActivityBar({ open, onClose, onItemActivated }: ActivityBarProps) {
  const { t } = useTranslation()
  const NAV_SECTIONS = getNavSections(t)
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const unreadInbox = useUnreadInboxCount()
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

      {/* ActivityBar — 200px on all viewports. Mobile: slide-in over
       *  page with backdrop. Desktop: static column flush left. */}
      <aside
        className={`
          w-[200px] h-full flex flex-col shrink-0
          bg-bg-secondary
          border-r border-border
          fixed z-50 top-0 left-0 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto md:transition-none
        `}
      >
        {/* Branding */}
        <div className="px-5 py-4 flex items-center gap-2.5">
          <img
            src="/alice.ico"
            alt="Alice"
            className="w-7 h-7 rounded-lg ring-1 ring-accent/25 shadow-[0_0_8px_rgba(88,166,255,0.15)]"
            draggable={false}
          />
          <h1 className="text-[15px] font-semibold text-text">OpenAlice</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col px-2 overflow-y-auto pb-3">
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
                    label={section.sectionLabel}
                    description={section.description}
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
                  <div className="flex flex-col gap-0.5" id={`activity-section-${si}`}>
                    {section.items.map((item) => {
                      const sec = activitySectionFor(item.page)
                      const isActive = selectedSidebar === sec
                      const Icon = item.icon
                      const handleClick = () => {
                        let landedOn: ActivitySection | null
                        if (selectedSidebar === sec) {
                          // Same section re-clicked: toggle sidebar off. Don't
                          // touch the focused tab — collapsing the sidebar
                          // shouldn't change what's in the editor.
                          setSidebar(null)
                          landedOn = null
                        } else {
                          setSidebar(sec)
                          // Activities with a meaningful default landing (e.g.
                          // Portfolio overview) jump straight to it. Sidebar-only
                          // activities (Chat, Settings, Trading-as-Git, …) leave
                          // tab focus alone — user picks from the sidebar.
                          if (item.defaultTab) openOrFocus(item.defaultTab)
                          landedOn = sec
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
                          title={item.label}
                          className={`relative flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors text-left ${
                            isActive
                              ? 'bg-bg-tertiary text-text'
                              : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
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
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.page === 'inbox' && unreadInbox > 0 && (
                            <span
                              aria-label={`${unreadInbox} unread`}
                              className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red text-[10px] font-semibold text-white tabular-nums flex items-center justify-center"
                            >
                              {unreadInbox > 99 ? '99+' : unreadInbox}
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
  const [hintOpen, setHintOpen] = useState(false)
  return (
    <>
      <div className="flex items-center px-3 mb-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex-1 flex items-center gap-1.5 py-1 text-[11px] font-medium text-text-muted/60 hover:text-text-muted uppercase tracking-wider transition-colors text-left"
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
            aria-label={`About ${label}`}
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
