import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { EventsPage } from './pages/EventsPage'
import { SettingsPage } from './pages/SettingsPage'
import { DataSourcesPage } from './pages/DataSourcesPage'

export type Page = 'chat' | 'events' | 'data-sources' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('chat')
  const [sseConnected, setSseConnected] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-full">
      <Sidebar
        sseConnected={sseConnected}
        currentPage={page}
        onNavigate={setPage}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-bg">
        {/* Mobile header — visible only below md */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-secondary shrink-0 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-text-muted hover:text-text p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-text">Open Alice</span>
        </div>
        {page === 'chat' && <ChatPage onSSEStatus={setSseConnected} />}
        {page === 'events' && <EventsPage />}
        {page === 'data-sources' && <DataSourcesPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
