import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { EventsPage } from './pages/EventsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AIProviderPage } from './pages/AIProviderPage'
import { DataSourcesPage } from './pages/DataSourcesPage'
import { TradingPage } from './pages/TradingPage'
import { ConnectorsPage } from './pages/ConnectorsPage'
import { DevPage } from './pages/DevPage'
import { HeartbeatPage } from './pages/HeartbeatPage'
import { ToolsPage } from './pages/ToolsPage'
import { AgentStatusPage } from './pages/AgentStatusPage'

export type Page =
  | 'chat' | 'portfolio' | 'events' | 'agent-status' | 'heartbeat' | 'data-sources' | 'connectors'
  | 'trading'
  | 'ai-provider' | 'settings' | 'tools' | 'dev'

/** Page type → URL path mapping. Chat is the root, everything else maps to /slug. */
export const ROUTES: Record<Page, string> = {
  'chat': '/',
  'portfolio': '/portfolio',
  'events': '/events',
  'agent-status': '/agent-status',
  'heartbeat': '/heartbeat',
  'data-sources': '/data-sources',
  'connectors': '/connectors',
  'tools': '/tools',
  'trading': '/trading',
  'ai-provider': '/ai-provider',
  'settings': '/settings',
  'dev': '/dev',
}

export function App() {
  const [sseConnected, setSseConnected] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex h-full">
      <Sidebar
        sseConnected={sseConnected}
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
        <div key={location.pathname} className="page-fade-in flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<ChatPage onSSEStatus={setSseConnected} />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/agent-status" element={<AgentStatusPage />} />
            <Route path="/heartbeat" element={<HeartbeatPage />} />
            <Route path="/data-sources" element={<DataSourcesPage />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/trading" element={<TradingPage />} />
            <Route path="/ai-provider" element={<AIProviderPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/dev" element={<DevPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
