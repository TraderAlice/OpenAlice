import { useState, useEffect } from 'react'
import { Header } from './components/Header'
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
    <div className="flex flex-col h-full max-w-[900px] mx-auto">
      <Header
        sseConnected={sseConnected}
        currentPage={page}
        onNavigate={setPage}
      />
      {page === 'chat' && <ChatPage />}
      {page === 'events' && <EventsPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  )
}
