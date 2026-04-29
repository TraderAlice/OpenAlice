import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { DiaryPage } from './pages/DiaryPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { AutomationPage } from './pages/AutomationPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AIProviderPage } from './pages/AIProviderPage'
import { MarketDataPage } from './pages/MarketDataPage'
import { MarketPage } from './pages/MarketPage'
import { MarketDetailPage } from './pages/MarketDetailPage'
import { NewsPage } from './pages/NewsPage'
import { NewsCollectorPage } from './pages/NewsCollectorPage'
import { TradingPage } from './pages/TradingPage'
import { UTADetailPage } from './pages/UTADetailPage'
import { ConnectorsPage } from './pages/ConnectorsPage'
import { DevPage } from './pages/DevPage'

export type Page =
  | 'chat' | 'diary' | 'portfolio' | 'news' | 'automation' | 'logs' | 'market' | 'market-data' | 'news-collector' | 'connectors'
  | 'trading'
  | 'ai-provider' | 'settings' | 'dev'

/** Page type → URL path mapping. Chat is the root, everything else maps to /slug. */
export const ROUTES: Record<Page, string> = {
  'chat': '/',
  'diary': '/diary',
  'portfolio': '/portfolio',
  'automation': '/automation',
  'logs': '/logs',
  'market': '/market',
  'market-data': '/market-data',
  'news-collector': '/news-collector',
  'news': '/news',
  'connectors': '/connectors',
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
          <span className="text-sm font-semibold text-text">OpenAlice</span>
        </div>
        <div key={location.pathname} className="page-fade-in flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<ChatPage onSSEStatus={setSseConnected} />} />
            <Route path="/diary" element={<DiaryPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/market/:assetClass/:symbol" element={<MarketDetailPage />} />
            <Route path="/market-data" element={<MarketDataPage />} />
            <Route path="/news-collector" element={<NewsCollectorPage />} />
            <Route path="/news" element={<NewsPage />} />
            {/* Redirects for old URLs */}
            <Route path="/events" element={<Navigate to="/logs" replace />} />
            <Route path="/heartbeat" element={<Navigate to="/automation" replace />} />
            <Route path="/scheduler" element={<Navigate to="/automation" replace />} />
            <Route path="/agent-status" element={<Navigate to="/logs" replace />} />
            <Route path="/data-sources" element={<Navigate to="/market-data" replace />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/tools" element={<Navigate to="/settings" replace />} />
            <Route path="/trading" element={<TradingPage />} />
            <Route path="/uta/:id" element={<UTADetailPage />} />
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
