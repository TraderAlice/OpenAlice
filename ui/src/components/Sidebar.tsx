import type { Page } from '../App'

interface SidebarProps {
  sseConnected: boolean
  currentPage: Page
  onNavigate: (page: Page) => void
}

const NAV_ITEMS: { page: Page; label: string; icon: string }[] = [
  { page: 'chat', label: 'Chat', icon: '💬' },
  { page: 'events', label: 'Events', icon: '📋' },
  { page: 'settings', label: 'Settings', icon: '⚙️' },
]

export function Sidebar({ sseConnected, currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[220px] h-full flex flex-col bg-bg-secondary border-r border-border shrink-0">
      {/* Branding */}
      <div className="px-5 py-4">
        <h1 className="text-base font-semibold text-text">Open Alice</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(({ page, label, icon }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left ${
              currentPage === page
                ? 'bg-bg-tertiary text-text'
                : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
            }`}
          >
            <span className="text-base leading-none">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* SSE Connection Status */}
      <div className="mt-auto px-5 py-4 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <div
            className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green' : 'bg-red'}`}
          />
          <span>{sseConnected ? 'Connected' : 'Reconnecting...'}</span>
        </div>
      </div>
    </aside>
  )
}
