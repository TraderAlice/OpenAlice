import type { Page } from '../App'

interface HeaderProps {
  sseConnected: boolean
  currentPage: Page
  onNavigate: (page: Page) => void
  onOpenSettings: () => void
}

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: 'chat', label: 'Chat' },
  { page: 'events', label: 'Events' },
]

export function Header({ sseConnected, currentPage, onNavigate, onOpenSettings }: HeaderProps) {
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

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <div
            className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green' : 'bg-red'}`}
          />
          <span>{sseConnected ? 'connected' : 'reconnecting...'}</span>
        </div>
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
