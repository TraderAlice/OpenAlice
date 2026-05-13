import { useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useWorkspace } from './store'
import { specEquals, type ViewSpec } from './types'
import { getView } from './registry'

/**
 * Two-way bridge between window.location and the workspace store.
 *
 * Direction A (URL → tab):
 *   Mounted alongside the main router. Each route renders a tiny adopter
 *   that, on mount or param change, calls openOrFocus with the matched
 *   spec. This drives the workspace from external links and from
 *   browser back/forward (which fires popstate, which re-evaluates routes).
 *
 * Direction B (tab → URL):
 *   `<UrlSync>` watches the focused tab and pushes its toUrl() into
 *   window.history.replaceState. We use replaceState (not pushState) so
 *   tab switches don't pollute browser history — back/forward only
 *   navigates real pushState entries (initial load, deep links).
 *
 * Mount order matters: UrlSync should run AFTER any URL → tab adoption so
 * an external URL load doesn't get clobbered. We render the routes first.
 */
export function UrlAdopter() {
  return (
    <>
      <Routes>
        {/* Root → default chat */}
        <Route path="/" element={<Navigate to="/chat" replace />} />

        {/* Activities */}
        <Route path="/chat" element={<AdoptStatic spec={{ kind: 'chat', params: { channelId: 'default' } }} />} />
        <Route path="/chat/:channelId" element={<AdoptChat />} />
        <Route path="/portfolio" element={<AdoptStatic spec={{ kind: 'portfolio', params: {} }} />} />
        <Route path="/automation" element={<Navigate to="/automation/flow" replace />} />
        <Route path="/automation/:section" element={<AdoptAutomation />} />
        <Route path="/news" element={<AdoptStatic spec={{ kind: 'news', params: {} }} />} />
        <Route path="/market" element={<AdoptStatic spec={{ kind: 'market-list', params: {} }} />} />
        <Route path="/market/:assetClass/:symbol" element={<AdoptMarketDetail />} />
        {/* /trading-as-git no longer creates a tab — sidebar-only activity. */}
        <Route path="/trading-as-git" element={<SetSidebarOnly section="trading-as-git" />} />

        {/* Settings — one entry per category */}
        <Route path="/settings" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'general' } }} />} />
        <Route path="/settings/ai-provider" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'ai-provider' } }} />} />
        <Route path="/settings/trading" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'trading' } }} />} />
        <Route path="/settings/connectors" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'connectors' } }} />} />
        <Route path="/settings/mcp" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'mcp' } }} />} />
        <Route path="/settings/market-data" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'market-data' } }} />} />
        <Route path="/settings/news-collector" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'news-collector' } }} />} />
        <Route path="/settings/uta/:id" element={<AdoptUtaDetail />} />

        {/* Dev */}
        <Route path="/dev" element={<Navigate to="/dev/connectors" replace />} />
        <Route path="/dev/:tab" element={<AdoptDev />} />

        {/* Notifications inbox */}
        <Route path="/notifications" element={<AdoptStatic spec={{ kind: 'notifications-inbox', params: {} }} />} />

        {/* Workspaces */}
        <Route path="/workspaces" element={<AdoptStatic spec={{ kind: 'workspace-list', params: {} }} />} />
        <Route path="/workspaces/:wsId" element={<AdoptWorkspace />} />
        <Route path="/workspaces/:wsId/s/:sessionId" element={<AdoptWorkspace />} />

        {/* Legacy redirects — preserved from sections.tsx */}
        <Route path="/logs" element={<Navigate to="/dev/logs" replace />} />
        <Route path="/events" element={<Navigate to="/dev/logs" replace />} />
        <Route path="/agent-status" element={<Navigate to="/dev/logs" replace />} />
        <Route path="/heartbeat" element={<Navigate to="/automation/heartbeat" replace />} />
        <Route path="/scheduler" element={<Navigate to="/automation/cron" replace />} />
        <Route path="/ai-provider" element={<Navigate to="/settings/ai-provider" replace />} />
        <Route path="/trading" element={<Navigate to="/settings/trading" replace />} />
        <Route path="/connectors" element={<Navigate to="/settings/connectors" replace />} />
        <Route path="/market-data" element={<Navigate to="/settings/market-data" replace />} />
        <Route path="/news-collector" element={<Navigate to="/settings/news-collector" replace />} />
        <Route path="/data-sources" element={<Navigate to="/settings/market-data" replace />} />
        <Route path="/tools" element={<Navigate to="/settings" replace />} />
        <Route path="/uta/:id" element={<RedirectUtaDetail />} />

        {/* Unknown URL → default chat */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
      <UrlSync />
    </>
  )
}

/**
 * Adopt a fixed spec (no URL params). Fires once when the route first
 * matches; openOrFocus is idempotent on a focused tab so re-mounts during
 * popstate cycles also do the right thing.
 */
function AdoptStatic({ spec }: { spec: ViewSpec }) {
  useAdopt(spec)
  return null
}

function AdoptChat() {
  const { channelId = 'default' } = useParams<{ channelId?: string }>()
  useAdopt({ kind: 'chat', params: { channelId } })
  return null
}

function AdoptMarketDetail() {
  const { assetClass, symbol } = useParams<{ assetClass: string; symbol: string }>()
  const valid: ReadonlyArray<string> = ['equity', 'crypto', 'currency', 'commodity']
  if (!assetClass || !symbol || !valid.includes(assetClass)) {
    return <Navigate to="/market" replace />
  }
  return (
    <AdoptStatic
      spec={{
        kind: 'market-detail',
        params: {
          assetClass: assetClass as Extract<ViewSpec, { kind: 'market-detail' }>['params']['assetClass'],
          symbol,
        },
      }}
    />
  )
}

function AdoptUtaDetail() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/settings/trading" replace />
  return <AdoptStatic spec={{ kind: 'uta-detail', params: { id } }} />
}

function AdoptDev() {
  const { tab } = useParams<{ tab: string }>()
  const valid: ReadonlyArray<string> = ['connectors', 'tools', 'sessions', 'snapshots', 'logs', 'simulator']
  if (!tab || !valid.includes(tab)) return <Navigate to="/dev/connectors" replace />
  return (
    <AdoptStatic
      spec={{
        kind: 'dev',
        params: { tab: tab as Extract<ViewSpec, { kind: 'dev' }>['params']['tab'] },
      }}
    />
  )
}

function AdoptAutomation() {
  const { section } = useParams<{ section: string }>()
  const valid: ReadonlyArray<string> = ['flow', 'heartbeat', 'cron', 'webhook']
  if (!section || !valid.includes(section)) return <Navigate to="/automation/flow" replace />
  return (
    <AdoptStatic
      spec={{
        kind: 'automation',
        params: { section: section as Extract<ViewSpec, { kind: 'automation' }>['params']['section'] },
      }}
    />
  )
}

function AdoptWorkspace() {
  const { wsId, sessionId } = useParams<{ wsId: string; sessionId?: string }>()
  if (!wsId) return <Navigate to="/workspaces" replace />
  const params: { wsId: string; sessionId?: string } = { wsId }
  if (sessionId) params.sessionId = sessionId
  return <AdoptStatic spec={{ kind: 'workspace', params }} />
}

function RedirectUtaDetail() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/settings/uta/${id ?? ''}`} replace />
}

/**
 * Some activities have no tab kind (e.g. trading-as-git is sidebar-only).
 * Visiting their URL should just open the sidebar; no tab gets created.
 */
function SetSidebarOnly({ section }: { section: import('./types').ActivitySection }) {
  const setSidebar = useWorkspace((state) => state.setSidebar)
  useEffect(() => {
    setSidebar(section)
  }, [section, setSidebar])
  return null
}

/**
 * Compare focused tab against `spec` and openOrFocus only if different —
 * skips redundant store updates on every render.
 */
function useAdopt(spec: ViewSpec) {
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  // Stable string key for dep tracking; spec is freshly built each render.
  const key = `${spec.kind}:${JSON.stringify(spec.params)}`
  useEffect(() => {
    const state = useWorkspace.getState()
    const focused = state.tree.kind === 'leaf' && state.tree.group.activeTabId
      ? state.tabs[state.tree.group.activeTabId]
      : null
    if (focused && specEquals(focused.spec, spec)) return
    openOrFocus(spec)
    // The spec object captured here is the one keyed by `key`; safe to use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * Project the focused tab's spec onto window.location via replaceState.
 * No-op when the URL already matches (avoids unnecessary history writes).
 */
function UrlSync() {
  const focusedSpec = useWorkspace((state) => {
    if (state.tree.kind !== 'leaf') return null
    const id = state.tree.group.activeTabId
    return id ? state.tabs[id]?.spec ?? null : null
  })
  useEffect(() => {
    if (!focusedSpec) return
    const view = getView(focusedSpec.kind)
    const target = view.toUrl(focusedSpec as never)
    const current = window.location.pathname + window.location.search + window.location.hash
    if (current === target) return
    window.history.replaceState(window.history.state, '', target)
  }, [focusedSpec])
  return null
}
