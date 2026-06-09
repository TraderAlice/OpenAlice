import { type LucideIcon, MessageSquare, Inbox, Telescope, LineChart, GitBranch, BarChart3, Newspaper, Zap, Settings, Code2, TerminalSquare, ChevronDown, Info } from 'lucide-react'
import { useState } from 'react'
import { type Page } from '../App'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection, ViewSpec } from '../tabs/types'
import { useUnreadInboxCount } from '../live/inbox-read'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useTranslation } from 'react-i18next'

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
    case 'automation':           return 'automation'
    case 'news':                 return 'news'
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

type NavItemKey =
  | 'nav.item.inbox' | 'nav.item.tracked' | 'nav.item.chat' | 'nav.item.workspaces'
  | 'nav.item.market' | 'nav.item.news' | 'nav.item.tradingAsGit'
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
  // Mental model: Workspace is the atom for all work units. Chat is
  // the high-frequency subset's shortcut — chat-template workspaces
  // got their own top-level entry because that flow is common enough
  // to warrant direct access. Workspaces (the all-templates index)
  // sits alongside; the two aren't redundant: Workspaces = whole set,
  // Chat = chat-shape subset shortcut.
  //
  // Market / News are operational tools that work but aren't load-
  // bearing — they live here because they don't need lifecycle
  // labelling.
  {
    sectionLabel: '',
    items: [
      { page: 'inbox',      labelKey: 'nav.item.inbox',      icon: Inbox, defaultTab: { kind: 'inbox', params: {} } },
      { page: 'tracked',    labelKey: 'nav.item.tracked',    icon: Telescope, defaultTab: { kind: 'tracked', params: {} } },
      { page: 'chat',       labelKey: 'nav.item.chat',       icon: MessageSquare },
      { page: 'workspaces', labelKey: 'nav.item.workspaces', icon: TerminalSquare },
      { page: 'market',     labelKey: 'nav.item.market',     icon: BarChart3 },
      { page: 'news',       labelKey: 'nav.item.news',       icon: Newspaper, defaultTab: { kind: 'news', params: {} } },
    ],
  },
  // Beta — functional but not yet dependable. Two distinct reasons
  // land an entry here:
  //  - Cross-broker unification (UTA abstraction, FX/options/futures)
  //    is in active rearchitecture. Portfolio surfaces that state;
  //    Trading-as-Git is the operations side (pending broker writes).
  //    The data runs; the schema/UX underneath isn't settled.
  //  - Automation runs fine in isolation, but its trigger chain isn't
  //    closed in the current Harness architecture — nothing fires it
  //    end-to-end yet, so it's effectively unusable today. Once
  //    Harness scheduling lands it gets wired back up.
  // Broker connection CRUD lives under Settings → Trading, not here —
  // it's a config surface, not a state/ops one.
  {
    sectionLabel: 'Beta',
    labelKey: 'nav.section.beta',
    descriptionKey: 'nav.betaDescription',
    items: [
      { page: 'trading-as-git', labelKey: 'nav.item.tradingAsGit', icon: GitBranch },
      { page: 'portfolio',      labelKey: 'nav.item.portfolio',    icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
      { page: 'automation',     labelKey: 'nav.item.automation',   icon: Zap, defaultTab: { kind: 'automation', params: { section: 'flow' } } },
    ],
  },
  {
    sectionLabel: 'System',
    labelKey: 'nav.section.system',
    items: [
      { page: 'settings', labelKey: 'nav.item.settings', icon: Settings },
      { page: 'dev',      labelKey: 'nav.item.dev',      icon: Code2 },
    ],
  },
]

// ==================== ActivityBar ====================

/**
 * Linear-style left nav. 276px wide on desktop; on mobile (<md)
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

      {/* ActivityBar — Linear-style workspace rail. Mobile: slide-in over
       *  page with backdrop. Desktop: static column flush left. */}
      <aside
        className={`
          w-[276px] h-full flex flex-col shrink-0
          bg-bg-secondary
          border-r border-border/80
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
            className="w-7 h-7 rounded-full ring-1 ring-white/10 shadow-[0_0_14px_rgba(198,109,55,0.12)]"
            draggable={false}
          />
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">OpenAlice</h1>
          <span className="text-text-muted/70">⌄</span>
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
                          title={t(item.labelKey)}
                          className={`relative flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors text-left ${
                            isActive
                              ? 'bg-bg-tertiary text-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]'
                              : 'text-text-muted hover:text-text hover:bg-white/[0.035]'
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
                              className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full border border-border bg-bg-tertiary text-[10px] font-semibold text-text-muted tabular-nums flex items-center justify-center"
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
