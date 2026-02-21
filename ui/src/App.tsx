import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { SettingsPanel } from './components/SettingsPanel'
import { ChatPage } from './pages/ChatPage'
import { EventsPage } from './pages/EventsPage'

export type Page = 'chat' | 'events'

export function App() {
  const [page, setPage] = useState<Page>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
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
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {page === 'chat' ? <ChatPage /> : <EventsPage />}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
