import { useCallback, type ReactNode } from 'react'
import type { Page } from '../App'

interface SidebarProps {
  sseConnected: boolean
  currentPage: Page
  onNavigate: (page: Page) => void
  open: boolean
  onClose: () => void
}

const NAV_ITEMS: { page: Page; label: string; icon: (active: boolean) => ReactNode }[] = [
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
    page: 'events',
    label: 'Events',
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
]

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
          {NAV_ITEMS.map(({ page, label, icon }) => (
            <button
              key={page}
              onClick={() => handleNav(page)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                currentPage === page
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
              }`}
            >
              <span className="flex items-center justify-center w-5 h-5">{icon(currentPage === page)}</span>
              {label}
            </button>
          ))}
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
