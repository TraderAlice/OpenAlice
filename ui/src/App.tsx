import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { EventsPage } from './pages/EventsPage'
import { SettingsPage } from './pages/SettingsPage'

export type Page = 'chat' | 'events' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('chat')
  const [sseConnected, setSseConnected] = useState(false)

  // Track SSE connection state
  useEffect(() => {
    const es = new EventSource('/api/chat/events')

    es.onopen = () => setSseConnected(true)
    es.onerror = () => setSseConnected(false)

    return () => es.close()
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar
        sseConnected={sseConnected}
        currentPage={page}
        onNavigate={setPage}
      />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-bg">
        {page === 'chat' && <ChatPage />}
        {page === 'events' && <EventsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
