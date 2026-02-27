import { useCallback, type ReactNode } from 'react'
import type { Page } from '../App'

interface SidebarProps {
  sseConnected: boolean
  currentPage: Page
  onNavigate: (page: Page) => void
  open: boolean
  onClose: () => void
}

// Chevron icon for expandable groups
const Chevron = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

// ==================== Nav item definitions ====================

interface NavLeaf {
  page: Page
  label: string
  icon: (active: boolean) => ReactNode
}

interface NavGroup {
  prefix: string
  label: string
  icon: (active: boolean) => ReactNode
  children: { page: Page; label: string }[]
}

type NavItem = NavLeaf | NavGroup
const isGroup = (item: NavItem): item is NavGroup => 'children' in item

const NAV_ITEMS: NavItem[] = [
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
    page: 'events',
    label: 'Events',
    icon: (active) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    page: 'data-sources',
    label: 'Data Sources',
    icon: (active) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
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
    prefix: 'trading',
    label: 'Crypto',
    icon: (active) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20h20" />
        <path d="M5 17V10" /><path d="M5 7V4" /><path d="M3 10h4" /><path d="M3 7h4" />
        <path d="M10 17V13" /><path d="M10 10V6" /><path d="M8 13h4" /><path d="M8 10h4" />
        <path d="M15 17V11" /><path d="M15 8V4" /><path d="M13 11h4" /><path d="M13 8h4" />
        <path d="M20 17V14" /><path d="M20 11V8" /><path d="M18 14h4" /><path d="M18 11h4" />
      </svg>
    ),
    children: [
      { page: 'trading/connection', label: 'Connection' },
      { page: 'trading/guards', label: 'Guards' },
    ],
  },
  {
    prefix: 'securities',
    label: 'Securities',
    icon: (active) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    children: [
      { page: 'securities/connection', label: 'Connection' },
      { page: 'securities/guards', label: 'Guards' },
    ],
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
]

// ==================== Sidebar ====================

export function Sidebar({ sseConnected, currentPage, onNavigate, open, onClose }: SidebarProps) {
  const handleNav = useCallback(
    (page: Page) => {
      onNavigate(page)
      onClose()
    },
    [onNavigate, onClose],
  )

  return (
    <>
      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

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
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </div>
          <h1 className="text-[15px] font-semibold text-text">Open Alice</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            if (isGroup(item)) {
              const expanded = currentPage.startsWith(`${item.prefix}/`)
              return (
                <div key={item.prefix}>
                  {/* Group parent */}
                  <button
                    onClick={() => {
                      if (expanded) {
                        // Already expanded — collapse by navigating away is weird,
                        // so just toggle to first child (no-op if already there)
                        // In practice, clicking the active group header does nothing special
                      } else {
                        handleNav(item.children[0].page)
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      expanded
                        ? 'text-text'
                        : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
                    }`}
                  >
                    <span className="flex items-center justify-center w-5 h-5">{item.icon(expanded)}</span>
                    <span className="flex-1">{item.label}</span>
                    <Chevron expanded={expanded} />
                  </button>

                  {/* Children — animate height */}
                  <div
                    className={`overflow-hidden transition-all duration-150 ${
                      expanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    {item.children.map((child) => {
                      const isActive = currentPage === child.page
                      return (
                        <button
                          key={child.page}
                          onClick={() => handleNav(child.page)}
                          className={`w-full flex items-center pl-11 pr-3 py-1.5 rounded-lg text-[13px] transition-colors text-left ${
                            isActive
                              ? 'bg-bg-tertiary text-text'
                              : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
                          }`}
                        >
                          {child.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }

            // Leaf item
            const isActive = currentPage === item.page
            return (
              <button
                key={item.page}
                onClick={() => handleNav(item.page)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? 'bg-bg-tertiary text-text'
                    : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
                }`}
              >
                <span className="flex items-center justify-center w-5 h-5">{item.icon(isActive)}</span>
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* SSE Connection Status */}
        <div className="mt-auto px-5 py-4 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <div
              className={`w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-green' : 'bg-red'}`}
            />
            <span>{sseConnected ? 'Connected' : 'Reconnecting...'}</span>
          </div>
        </div>
      </aside>
    </>
  )
}
