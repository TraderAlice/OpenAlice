import { type LucideIcon, MessageSquare, LineChart, GitBranch, BarChart3, Newspaper, Zap, Settings, Code2, TerminalSquare } from 'lucide-react'
import { type Page } from '../App'
import { useWorkspace } from '../tabs/store'
import type { ActivitySection, ViewSpec } from '../tabs/types'

/**
 * Map ActivityBar page enum (visual layout grouping) to the ActivitySection
 * used by the workspace store. Names are 1:1.
 */
function activitySectionFor(page: Page): ActivitySection {
  switch (page) {
    case 'chat':           return 'chat'
    case 'workspaces':     return 'workspaces'
    case 'trading-as-git': return 'trading-as-git'
    case 'settings':       return 'settings'
    case 'dev':            return 'dev'
    case 'market':         return 'market'
    case 'portfolio':      return 'portfolio'
    case 'automation':     return 'automation'
    case 'news':           return 'news'
  }
}

interface ActivityBarProps {
  open: boolean
  onClose: () => void
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
}

const NAV_SECTIONS: NavSection[] = [
  {
    sectionLabel: '',
    items: [
      { page: 'chat',           label: 'Chat',           icon: MessageSquare },
      { page: 'workspaces',     label: 'Workspaces',     icon: TerminalSquare },
      { page: 'portfolio',      label: 'Portfolio',      icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
      { page: 'trading-as-git', label: 'Trading as Git', icon: GitBranch },
      { page: 'market',         label: 'Market',         icon: BarChart3 },
      { page: 'news',           label: 'News',           icon: Newspaper, defaultTab: { kind: 'news', params: {} } },
    ],
  },
  {
    sectionLabel: 'Agent',
    items: [
      { page: 'automation', label: 'Automation', icon: Zap, defaultTab: { kind: 'automation', params: { section: 'flow' } } },
    ],
  },
  {
    sectionLabel: 'System',
    items: [
      { page: 'settings', label: 'Settings', icon: Settings },
      { page: 'dev',      label: 'Dev',      icon: Code2 },
    ],
  },
]

// ==================== ActivityBar ====================

export function ActivityBar({ open, onClose }: ActivityBarProps) {
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return (
    <>
      {/* Backdrop — mobile only */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* ActivityBar — mobile: 220px slide-in with labels; desktop: 56px icon-only column */}
      <aside
        className={`
          w-[220px] md:w-14 h-full flex flex-col shrink-0
          bg-bg-secondary md:bg-bg
          border-r border-border md:border-r-0
          fixed z-50 top-0 left-0 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto md:transition-none
        `}
      >
        {/* Branding */}
        <div className="px-5 md:px-0 md:justify-center py-4 flex items-center gap-2.5">
          <img
            src="/alice.ico"
            alt="Alice"
            className="w-7 h-7 rounded-lg ring-1 ring-accent/25 shadow-[0_0_8px_rgba(88,166,255,0.15)]"
            draggable={false}
          />
          <h1 className="text-[15px] font-semibold text-text md:hidden">OpenAlice</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col px-2 md:px-1.5 overflow-y-auto">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si} className={si > 0 ? 'mt-4 md:mt-2' : ''}>
              {section.sectionLabel && (
                <p className="px-3 mb-1 text-[11px] font-medium text-text-muted/50 uppercase tracking-wider md:hidden">
                  {section.sectionLabel}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const sec = activitySectionFor(item.page)
                  const isActive = selectedSidebar === sec
                  const Icon = item.icon
                  const handleClick = () => {
                    onClose()
                    if (selectedSidebar === sec) {
                      // Same section re-clicked: toggle sidebar off. Don't
                      // touch the focused tab — collapsing the sidebar
                      // shouldn't change what's in the editor.
                      setSidebar(null)
                    } else {
                      setSidebar(sec)
                      // Activities with a meaningful default landing (e.g.
                      // Portfolio overview) jump straight to it. Sidebar-only
                      // activities (Chat, Settings, Trading-as-Git, …) leave
                      // tab focus alone — user picks from the sidebar.
                      if (item.defaultTab) openOrFocus(item.defaultTab)
                    }
                  }
                  return (
                    <button
                      key={item.page}
                      type="button"
                      onClick={handleClick}
                      title={item.label}
                      className={`relative flex items-center gap-3 px-3 py-2 md:px-0 md:py-2.5 md:rounded-none md:justify-center rounded-lg text-sm transition-colors text-left ${
                        isActive
                          ? 'bg-bg-tertiary text-text md:bg-transparent'
                          : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50 md:hover:bg-bg-secondary'
                      }`}
                    >
                      {/* Active indicator — left vertical bar, desktop only */}
                      <span
                        className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-accent transition-opacity duration-150 hidden md:block ${
                          isActive ? 'opacity-100' : 'opacity-0'
                        }`}
                        aria-hidden
                      />
                      <span className="flex items-center justify-center w-5 h-5">
                        <Icon size={18} strokeWidth={1.5} />
                      </span>
                      <span className="md:hidden">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

      </aside>
    </>
  )
}
