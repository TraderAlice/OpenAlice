import { useEffect } from 'react'
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { useWorkspace } from './store'
import { specEquals, type ActivitySection, type ViewSpec } from './types'
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
        {/* Root → Ask Alice. An AI product should open on how-to-use-it (the
            chat front door), not an information summary (Inbox is task sync, à
            la Linear — but Linear's comms live in Slack; ours live here). */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/onboarding" element={<AdoptStatic spec={{ kind: 'onboarding', params: {} }} />} />
        <Route path="/design/:project" element={<AdoptDesignProject />} />

        {/* Activities */}
        {/* /chat → the "Ask Alice" quick-chat landing (composer). Legacy
            /chat/:channelId (the retired traditional-chat channels) still
            redirects to Inbox so stale bookmarks land on a live surface. */}
        <Route path="/chat" element={<AdoptStatic spec={{ kind: 'chat-landing', params: {} }} />} />
        <Route path="/chat/workspaces/:wsId" element={<AdoptChatWorkspace />} />
        <Route path="/chat/workspaces/:wsId/s/:sessionId" element={<AdoptChatWorkspace />} />
        <Route path="/chat/:channelId" element={<Navigate to="/inbox" replace />} />
        <Route path="/portfolio" element={<AdoptStatic spec={{ kind: 'portfolio', params: {} }} />} />
        <Route path="/issues" element={<AdoptStatic spec={{ kind: 'issue', params: {} }} />} />
        <Route path="/issues/:wsId/:id" element={<AdoptIssueDetail />} />
        <Route path="/automation" element={<Navigate to="/automation/runs" replace />} />
        <Route path="/automation/:section" element={<AdoptAutomation />} />
        <Route path="/news" element={<AdoptStatic spec={{ kind: 'news', params: {} }} />} />
        <Route path="/market" element={<AdoptStatic spec={{ kind: 'market-list', params: {} }} />} />
        <Route path="/market/rotation" element={<AdoptStatic spec={{ kind: 'market-rotation', params: {} }} />} />
        {/* Static `boards` segment outranks /market/:assetClass/:symbol in
            react-router's specificity scoring, so order here doesn't matter —
            but keep it above the dynamic route for readability. */}
        <Route path="/market/boards/:board" element={<AdoptMarketBoard />} />
        <Route path="/market/:assetClass/:symbol" element={<AdoptMarketDetail />} />
        <Route path="/trading-as-git" element={<AdoptStatic spec={{ kind: 'trading-as-git', params: {} }} />} />

        {/* Settings — one entry per category */}
        <Route path="/settings" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'general' } }} />} />
        <Route path="/settings/ai-provider" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'ai-provider' } }} />} />
        <Route path="/settings/agent-permissions" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'agent-permissions' } }} />} />
        <Route path="/settings/trading" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'trading' } }} />} />
        <Route path="/settings/issues" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'issues' } }} />} />
        <Route path="/settings/mcp" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'mcp' } }} />} />
        <Route path="/settings/market-data" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'market-data' } }} />} />
        <Route path="/settings/news-collector" element={<AdoptStatic spec={{ kind: 'settings', params: { category: 'news-collector' } }} />} />
        <Route path="/settings/uta/:id" element={<AdoptUtaDetail />} />

        {/* Dev */}
        <Route path="/dev" element={<Navigate to="/dev/tools" replace />} />
        <Route path="/dev/:tab" element={<AdoptDev />} />

        {/* Legacy /notifications (retired NotificationsStore inbox) →
            the workspace-anchored Inbox. */}
        <Route path="/notifications" element={<Navigate to="/inbox" replace />} />

        {/* Inbox (workspace-anchored, Linear-style) */}
        <Route path="/inbox" element={<AdoptStatic spec={{ kind: 'inbox', params: {} }} />} />

        {/* Tracked (entity index) */}
        <Route path="/tracked" element={<AdoptStatic spec={{ kind: 'tracked', params: {} }} />} />
        <Route path="/tracked/issues/:wsId/:id" element={<AdoptTrackedIssueDetail />} />

        {/* Workspaces */}
        <Route path="/workspaces" element={<AdoptStatic spec={{ kind: 'workspace-list', params: {} }} />} />
        {/* Template catalog routes must come before /workspaces/:wsId so the
            static `templates` segment wins the match even if a workspace id is
            a human-readable slug. */}
        <Route path="/workspaces/templates" element={<AdoptStatic spec={{ kind: 'template-catalog', params: {} }} />} />
        <Route path="/workspaces/templates/:name" element={<AdoptTemplateDetail />} />
        <Route path="/workspaces/:wsId/view/:path" element={<AdoptFileViewer />} />
        <Route path="/workspaces/:wsId" element={<AdoptWorkspace />} />
        <Route path="/workspaces/:wsId/s/:sessionId" element={<AdoptWorkspace />} />

        {/* Legacy redirects */}
        <Route path="/logs" element={<Navigate to="/dev/logs" replace />} />
        <Route path="/events" element={<Navigate to="/dev/logs" replace />} />
        <Route path="/agent-status" element={<Navigate to="/dev/logs" replace />} />
        {/* Schedules were absorbed into the Issue board — scheduled issues now
            live there (carrying a cadence pill). */}
        <Route path="/scheduler" element={<Navigate to="/issues" replace />} />
        <Route path="/automation/schedules" element={<Navigate to="/issues" replace />} />
        <Route path="/ai-provider" element={<Navigate to="/settings/ai-provider" replace />} />
        <Route path="/trading" element={<Navigate to="/settings/trading" replace />} />
        <Route path="/trading-accounts" element={<Navigate to="/settings/trading" replace />} />
        <Route path="/market-data" element={<Navigate to="/settings/market-data" replace />} />
        <Route path="/news-collector" element={<Navigate to="/settings/news-collector" replace />} />
        <Route path="/data-sources" element={<Navigate to="/settings/market-data" replace />} />
        <Route path="/tools" element={<Navigate to="/settings" replace />} />
        <Route path="/uta/:id" element={<RedirectUtaDetail />} />

        {/* Unknown URL → Inbox */}
        <Route path="*" element={<Navigate to="/inbox" replace />} />
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

function AdoptMarketDetail() {
  const { assetClass, symbol } = useParams<{ assetClass: string; symbol: string }>()
  const [search] = useSearchParams()
  const valid: ReadonlyArray<string> = ['equity', 'crypto', 'currency', 'commodity']
  if (!assetClass || !symbol || !valid.includes(assetClass)) {
    return <Navigate to="/market" replace />
  }
  const source = search.get('source') ?? undefined
  return (
    <AdoptStatic
      spec={{
        kind: 'market-detail',
        params: {
          assetClass: assetClass as Extract<ViewSpec, { kind: 'market-detail' }>['params']['assetClass'],
          symbol,
          ...(source ? { source } : {}),
        },
      }}
    />
  )
}

function AdoptMarketBoard() {
  const { board } = useParams<{ board: string }>()
  const valid: ReadonlyArray<string> = ['movers', 'calendar', 'macro', 'term-structure', 'global-macro', 'shipping', 'fed']
  if (!board || !valid.includes(board)) return <Navigate to="/market" replace />
  return (
    <AdoptStatic
      spec={{
        kind: 'market-board',
        params: { board: board as Extract<ViewSpec, { kind: 'market-board' }>['params']['board'] },
      }}
    />
  )
}

function AdoptIssueDetail() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>()
  if (!wsId || !id) return <Navigate to="/issues" replace />
  return <AdoptStatic spec={{ kind: 'issue-detail', params: { wsId, id } }} />
}

function AdoptTrackedIssueDetail() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>()
  if (!wsId || !id) return <Navigate to="/tracked" replace />
  return <AdoptStatic spec={{ kind: 'tracked-issue-detail', params: { wsId, id } }} />
}

function AdoptUtaDetail() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/settings/trading" replace />
  return <AdoptStatic spec={{ kind: 'uta-detail', params: { id } }} />
}

function AdoptDev() {
  const { tab } = useParams<{ tab: string }>()
  const valid: ReadonlyArray<string> = ['tools', 'onboarding', 'snapshots', 'logs', 'simulator']
  if (!tab || !valid.includes(tab)) return <Navigate to="/dev/tools" replace />
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
  const valid: ReadonlyArray<string> = ['runs', 'api', 'flow', 'webhook']
  if (!section || !valid.includes(section)) return <Navigate to="/automation/runs" replace />
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
  const params: Extract<ViewSpec, { kind: 'workspace' }>['params'] = { wsId }
  if (sessionId) params.sessionId = sessionId
  return <AdoptStatic spec={{ kind: 'workspace', params }} />
}

function AdoptChatWorkspace() {
  const { wsId, sessionId } = useParams<{ wsId: string; sessionId?: string }>()
  if (!wsId) return <Navigate to="/chat" replace />
  const params: Extract<ViewSpec, { kind: 'workspace' }>['params'] = { wsId, source: 'chat' }
  if (sessionId) params.sessionId = sessionId
  return <AdoptStatic spec={{ kind: 'workspace', params }} />
}

function AdoptTemplateDetail() {
  const { name } = useParams<{ name: string }>()
  if (!name) return <Navigate to="/workspaces/templates" replace />
  return <AdoptStatic spec={{ kind: 'template-detail', params: { name } }} />
}

function AdoptFileViewer() {
  const { wsId, path } = useParams<{ wsId: string; path: string }>()
  if (!wsId || !path) return <Navigate to="/workspaces" replace />
  // `path` arrives already URL-decoded by react-router (toUrl encodes it as
  // a single segment), so it may contain slashes — pass through verbatim.
  return <AdoptStatic spec={{ kind: 'file-viewer', params: { wsId, path } }} />
}

function AdoptDesignProject() {
  const { project } = useParams<{ project: string }>()
  if (!project) return <Navigate to="/dev/tools" replace />
  return <AdoptStatic spec={{ kind: 'design-project', params: { project } }} />
}

function RedirectUtaDetail() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/settings/uta/${id ?? ''}`} replace />
}

/**
 * Map a ViewSpec to the ActivitySection highlighted in the ActivityBar.
 * Page-owned sidebars keep the highlight in sync while the app shell stays
 * unaware of each surface's local navigation.
 *
 * `uta-detail` is intentionally Portfolio's sidebar: the URL lives
 * under /settings/uta/:id for historical reasons but the page is a
 * Portfolio drill-in (positions / equity for one account).
 */
function specToSection(spec: ViewSpec): ActivitySection {
  switch (spec.kind) {
    case 'inbox':              return 'inbox'
    case 'tracked':            return 'tracked'
    case 'tracked-issue-detail': return 'tracked'
    case 'chat-landing':       return 'chat'
    case 'workspace':          return spec.params.source === 'chat' ? 'chat' : 'workspaces'
    case 'workspace-list':
    case 'template-catalog':
    case 'template-detail':
    case 'file-viewer':        return 'workspaces'
    case 'trading-as-git':     return 'trading-as-git'
    case 'portfolio':
    case 'uta-detail':         return 'portfolio'
    case 'issue':
    case 'issue-detail':       return 'issue'
    case 'automation':         return 'automation'
    case 'news':               return 'news'
    case 'market-list':
    case 'market-rotation':
    case 'market-board':
    case 'market-detail':      return 'market'
    case 'settings':
    case 'onboarding':         return 'settings'
    case 'design-project':     return 'dev'
    case 'dev':                return 'dev'
  }
}

/**
 * Compare focused tab against `spec` and openOrFocus only if different —
 * skips redundant store updates on every render. Also activates the
 * matching ActivityBar section so URL-driven navigation (fresh load,
 * deep link, back-forward) lands with the expected navigation context.
 */
function useAdopt(spec: ViewSpec) {
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const setSidebar = useWorkspace((state) => state.setSidebar)
  // Stable string key for dep tracking; spec is freshly built each render.
  const key = `${spec.kind}:${JSON.stringify(spec.params)}`
  useEffect(() => {
    setSidebar(specToSection(spec))
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
