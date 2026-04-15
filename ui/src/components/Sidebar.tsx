import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { type Page, ROUTES } from '../App'

interface SidebarProps {
  sseConnected: boolean
  open: boolean
  onClose: () => void
}

// ==================== Nav item definitions ====================

interface NavLeaf {
  page: Page
  label: string
  icon: (active: boolean) => ReactNode
}

interface NavSection {
  sectionLabel: string
  items: NavLeaf[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    sectionLabel: '',
    items: [
      {
        page: 'chat',
        label: 'Chat',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        page: 'portfolio',
        label: 'Portfolio',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
            <path d="M7 10l3-3 2 2 5-5" />
          </svg>
        ),
      },
      {
        page: 'news',
        label: 'News',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9h4" />
            <path d="M10 7h8" />
            <path d="M10 11h8" />
            <path d="M10 15h4" />
          </svg>
        ),
      },
    ],
  },
  {
    sectionLabel: 'Agent',
    items: [
      {
        page: 'automation',
        label: 'Automation',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        ),
      },
    ],
  },
  {
    sectionLabel: 'Data',
    items: [
      {
        page: 'market-data',
        label: 'Market Data',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        ),
      },
      {
        page: 'news-collector',
        label: 'News Collector',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        ),
      },
    ],
  },
  {
    sectionLabel: 'Integration',
    items: [
      {
        page: 'connectors',
        label: 'Connectors',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        ),
      },
      {
        page: 'trading' as const,
        label: 'Trading Account',
        icon: (active: boolean) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 20h20" />
            <path d="M5 17V10" /><path d="M5 7V4" /><path d="M3 10h4" /><path d="M3 7h4" />
            <path d="M10 17V13" /><path d="M10 10V6" /><path d="M8 13h4" /><path d="M8 10h4" />
            <path d="M15 17V11" /><path d="M15 8V4" /><path d="M13 11h4" /><path d="M13 8h4" />
            <path d="M20 17V14" /><path d="M20 11V8" /><path d="M18 14h4" /><path d="M18 11h4" />
          </svg>
        ),
      },
      {
        page: 'ai-provider',
        label: 'AI Provider',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73v1.27h1a7 7 0 0 1 7 7h1.27c.34-.6.99-1 1.73-1a2 2 0 1 1 0 4c-.74 0-1.39-.4-1.73-1H21a7 7 0 0 1-7 7v1.27c.6.34 1 .99 1 1.73a2 2 0 1 1-4 0c0-.74.4-1.39 1-1.73V21a7 7 0 0 1-7-7H2.73c-.34.6-.99 1-1.73 1a2 2 0 1 1 0-4c.74 0 1.39.4 1.73 1H4a7 7 0 0 1 7-7V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
            <circle cx="12" cy="14" r="3" />
          </svg>
        ),
      },
    ],
  },
  {
    sectionLabel: 'System',
    items: [
      {
        page: 'logs',
        label: 'Logs',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
      },
      {
        page: 'settings',
        label: 'Settings',
        icon: (active) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
      {
        page: 'dev' as const,
        label: 'Dev',
        icon: (active: boolean) => (
          <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        ),
      },
    ],
  },
]

// ==================== Helpers ====================

/** Derive active page from current URL path */
function pathToPage(pathname: string): Page | null {
  for (const [page, path] of Object.entries(ROUTES) as [Page, string][]) {
    if (path === pathname) return page
    // Match root path for chat
    if (page === 'chat' && pathname === '/') return 'chat'
  }
  return null
}

/** Style for active indicator */
const INDICATOR_STYLE = { background: '#58a6ff' }

// ==================== Sidebar ====================

export function Sidebar({ sseConnected, open, onClose }: SidebarProps) {
  const location = useLocation()
  const currentPage = pathToPage(location.pathname)

  return (
    <>
      {/* Backdrop — mobile only */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`
          w-[220px] h-full flex flex-col bg-bg-secondary border-r border-border shrink-0
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
        <nav className="flex-1 flex flex-col px-2 overflow-y-auto">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si} className={si > 0 ? 'mt-4' : ''}>
              {section.sectionLabel && (
                <p className="px-3 mb-1 text-[11px] font-medium text-text-muted/50 uppercase tracking-wider">
                  {section.sectionLabel}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const isActive = currentPage === item.page
                  return (
                    <Link
                      key={item.page}
                      to={ROUTES[item.page]}
                      onClick={onClose}
                      className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                        isActive
                          ? 'bg-bg-tertiary/60 text-text'
                          : 'text-text-muted hover:text-text hover:bg-bg-tertiary/40'
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-all duration-200 ${
                          isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-50'
                        }`}
                        style={INDICATOR_STYLE}
                      />
                      <span className="flex items-center justify-center w-5 h-5">{item.icon(isActive)}</span>
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* SSE Connection Status */}
        <div className="mt-auto px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2 text-[12px] text-text-muted">
            <span className="relative flex h-2 w-2">
              {sseConnected ? (
                <span className="w-2 h-2 rounded-full bg-green" />
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red" />
                </>
              )}
            </span>
            <span>{sseConnected ? 'Connected' : 'Reconnecting...'}</span>
          </div>
        </div>
      </aside>
    </>
  )
}
