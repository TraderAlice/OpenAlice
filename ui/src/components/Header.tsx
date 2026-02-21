import type { Page } from '../App'

interface HeaderProps {
  sseConnected: boolean
  currentPage: Page
  onNavigate: (page: Page) => void
}

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: 'chat', label: 'Chat' },
  { page: 'events', label: 'Events' },
  { page: 'settings', label: 'Settings' },
]

export function Header({ sseConnected, currentPage, onNavigate }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-secondary shrink-0">
      <div className="flex items-center gap-5">
        <h1 className="text-lg font-semibold text-text">Open Alice</h1>

        {/* Navigation tabs */}
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ page, label }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                currentPage === page
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <div
          className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green' : 'bg-red'}`}
        />
        <span>{sseConnected ? 'connected' : 'reconnecting...'}</span>
      </div>
    </header>
  )
}
