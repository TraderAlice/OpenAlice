import type { ComponentType, ReactNode } from 'react'
import type { Workspace } from '../components/workspace/api'
import type { ViewKind, ViewSpec } from './types'
import { WorkspaceDetailsPage } from '../pages/WorkspaceDetailsPage'
import { QuickStartPage } from '../pages/QuickStartPage'

import { PortfolioPage } from '../pages/PortfolioPage'
import { TradingAsGitPage } from '../pages/TradingAsGitPage'
import { IssuePage } from '../pages/IssuePage'
import { IssueSettingsPage } from '../pages/IssueSettingsPage'
import { HarnessSettingsPage } from '../pages/HarnessSettingsPage'
import { IssueDetailPage } from '../pages/IssueDetailPage'
import { TrackedIssueDetailPage } from '../pages/TrackedIssueDetailPage'
import { OfficePage } from '../pages/OfficePage'
import { NewsPage } from '../pages/NewsPage'
import { MarketPage } from '../pages/MarketPage'
import { MarketRotationPage } from '../pages/MarketRotationPage'
import { MarketBoardPage } from '../pages/MarketBoardPage'
import { MARKET_BOARD_TITLES } from '../pages/market-board-titles'
import { MarketDetailPage } from '../pages/MarketDetailPage'
import { AppearanceSettingsPage, SettingsPage, ToolsSettingsPage } from '../pages/SettingsPage'
import { ActivityBarSettingsPage } from '../pages/ActivityBarSettingsPage'
import { BetaSettingsPage } from '../pages/BetaSettingsPage'
import { AgentPermissionsPage } from '../pages/AgentPermissionsPage'
import { AgentRuntimesSettingsPage } from '../pages/AgentRuntimesSettingsPage'
import { AIProviderPage } from '../pages/AIProviderPage'
import { TradingPage } from '../pages/TradingPage'
import { MCPPage } from '../pages/MCPPage'
import { ConnectorsPage } from '../pages/ConnectorsPage'
import { ConnectorStatusPage } from '../pages/ConnectorStatusPage'
import { MarketDataPage } from '../pages/MarketDataPage'
import { NewsCollectorPage } from '../pages/NewsCollectorPage'
import { UTADetailPage } from '../pages/UTADetailPage'
import { OnboardingDesignPage } from '../pages/OnboardingDesignPage'
import { DesignProjectPage } from '../pages/DesignProjectPage'
import { DevPage } from '../pages/DevPage'
import { InboxPage } from '../pages/InboxPage'
import { InboxPageShell } from '../pages/InboxPageShell'
import { TrackedPage } from '../pages/TrackedPage'
import { AutoPredictionLandingPage, AutoQuantLandingPage, ChatLandingPage } from '../pages/ChatLandingPage'
import { WorkspaceManagerPage } from '../pages/WorkspaceManagerPage'
import { PageSidebarShell } from '../pages/PageSidebarShell'
import { WorkspacePage } from '../pages/WorkspacePage'
import { WorkspaceHarnessRedirect } from './WorkspaceHarnessRedirect'
import { FileViewerPage } from '../pages/FileViewerPage'
import { HarnessSurfacePage } from '../pages/HarnessSurfacePage'
import { TrackedSidebar } from '../components/TrackedSidebar'
import { SettingsCategoryList } from '../components/SettingsCategoryList'
import { MarketSidebar } from '../components/MarketSidebar'
import { PortfolioSidebar } from '../components/PortfolioSidebar'
import { PageContentLayout } from '../components/PageTopBar'
import { getDesignProject } from '../design/projects'

/**
 * Central registry mapping each ViewKind to its render component and URL
 * projection. Adding a new view kind means adding one entry here.
 *
 * Page-owned sidebars live here with their pages. Shared product shells are
 * declared here and mounted by TabHost so adjacent views can retain one local
 * navigator instance. The app shell itself owns only the ActivityBar.
 */

export interface TitleCtx {
  /** Workspaces list, threaded from WorkspacesContext. Used by workspaceModule
   *  to render tab titles as `<tag> · <sessionName>` instead of opaque UUIDs. */
  workspaces?: readonly Workspace[]
}

interface ViewProps<K extends ViewKind> {
  spec: Extract<ViewSpec, { kind: K }>
  visible: boolean
}

export type ViewLifecycle = 'active-only' | 'keep-mounted'
export type ViewShell = 'chat' | 'auto-quant' | 'prediction' | 'market'

export interface ViewModule<K extends ViewKind> {
  kind: K
  /** Tab title — derived from spec each render so e.g. channel renames propagate. */
  title(spec: Extract<ViewSpec, { kind: K }>, ctx: TitleCtx): string
  /** URL the active tab projects onto window.location (via replaceState). */
  toUrl(spec: Extract<ViewSpec, { kind: K }>): string
  /**
   * Runtime policy while the view's tab is not focused.
   *
   * Default is `active-only`: the tab store remembers navigation state, but
   * the component unmounts when hidden. This matches the post-editor-tabs UI
   * where tabs are lightweight history/bookmarks, not VS-Code-style runtime
   * containers. Use `keep-mounted` only for views that truly need a live DOM
   * while backgrounded.
   */
  lifecycle?: ViewLifecycle
  /**
   * Shared product chrome owned by TabHost rather than this individual view.
   * Adjacent views using the same shell swap only their content, preserving
   * the navigator instance and its rendered state.
   */
  shell?: ViewShell | ((spec: Extract<ViewSpec, { kind: K }>) => ViewShell | null)
  /** The actual page component. Ignores `visible` unless it needs catch-up behaviour. */
  Component: ComponentType<ViewProps<K>>
}

// ==================== Per-kind modules ====================

function TradingArea({ children }: { children: ReactNode }) {
  return (
    <PageSidebarShell
      storageKey="portfolio"
      titleKey="nav.item.trading"
      defaultWidth={220}
      sidebar={<PortfolioSidebar />}
    >
      {children}
    </PageSidebarShell>
  )
}

const portfolioModule: ViewModule<'portfolio'> = {
  kind: 'portfolio',
  title: () => 'Portfolio',
  toUrl: () => '/portfolio',
  Component: () => (
    <TradingArea>
      <PortfolioPage />
    </TradingArea>
  ),
}

const tradingAsGitModule: ViewModule<'trading-as-git'> = {
  kind: 'trading-as-git',
  title: () => 'Trading as Git',
  toUrl: () => '/trading-as-git',
  Component: () => (
    <TradingArea>
      <TradingAsGitPage />
    </TradingArea>
  ),
}

const connectorsModule: ViewModule<'connectors'> = {
  kind: 'connectors',
  title: () => 'Connectors',
  toUrl: () => '/connectors',
  Component: () => <ConnectorStatusPage />,
}

const issueModule: ViewModule<'issue'> = {
  kind: 'issue',
  title: () => 'Issues',
  toUrl: () => '/issues',
  Component: () => <IssuePage />,
}

const issueDetailModule: ViewModule<'issue-detail'> = {
  kind: 'issue-detail',
  title: (spec) => spec.params.id,
  toUrl: (spec) =>
    `/issues/${encodeURIComponent(spec.params.wsId)}/${encodeURIComponent(spec.params.id)}`,
  Component: ({ spec }) => <PageContentLayout title={spec.params.id}><IssueDetailPage spec={spec} /></PageContentLayout>,
}

const trackedIssueDetailModule: ViewModule<'tracked-issue-detail'> = {
  kind: 'tracked-issue-detail',
  title: (spec) => spec.params.id,
  toUrl: (spec) =>
    `/tracked/issues/${encodeURIComponent(spec.params.wsId)}/${encodeURIComponent(spec.params.id)}`,
  Component: ({ spec }) => (
    <PageSidebarShell
      storageKey="tracked"
      titleKey="nav.item.tracked"
      defaultWidth={232}
      sidebar={({ closeMobileDrawer }) => <TrackedSidebar onNavigate={closeMobileDrawer} />}
    >
      <TrackedIssueDetailPage spec={spec} />
    </PageSidebarShell>
  ),
}

const automationSectionTitle: Record<
  Extract<ViewSpec, { kind: 'automation' }>['params']['section'],
  string
> = {
  runs: 'Runs',
  api: 'API',
}

const automationModule: ViewModule<'automation'> = {
  kind: 'automation',
  title: (spec) => automationSectionTitle[spec.params.section],
  toUrl: (spec) => `/settings/developer/${spec.params.section}`,
  Component: (props) => (
    <devModule.Component {...props} spec={{ kind: 'dev', params: { tab: props.spec.params.section } }} />
  ),
}

const officeModule: ViewModule<'office'> = {
  kind: 'office',
  title: () => 'Office',
  toUrl: () => '/office',
  Component: () => <PageContentLayout title="Office"><OfficePage /></PageContentLayout>,
}

export function MarketArea({ children }: { children: ReactNode }) {
  return (
    <PageSidebarShell
      storageKey="market"
      titleKey="nav.item.market"
      defaultWidth={300}
      sidebar={({ closeMobileDrawer }) => <MarketSidebar onNavigate={closeMobileDrawer} />}
    >
      {children}
    </PageSidebarShell>
  )
}

const newsModule: ViewModule<'news'> = {
  kind: 'news',
  title: () => 'News',
  toUrl: ({ params }) => {
    const search = new URLSearchParams()
    if (params.category) search.set('category', params.category)
    if (params.view) search.set('view', params.view)
    return '/market/news' + (search.size ? '?' + search : '')
  },
  shell: 'market',
  Component: () => <NewsPage />,
}

const marketListModule: ViewModule<'market-list'> = {
  kind: 'market-list',
  title: () => 'Market',
  toUrl: () => '/market',
  shell: 'market',
  Component: () => <MarketPage />,
}

const marketRotationModule: ViewModule<'market-rotation'> = {
  kind: 'market-rotation',
  title: () => 'Sector Rotation',
  toUrl: () => '/market/rotation',
  shell: 'market',
  Component: () => <MarketRotationPage />,
}

const marketBoardModule: ViewModule<'market-board'> = {
  kind: 'market-board',
  title: (spec) => MARKET_BOARD_TITLES[spec.params.board],
  toUrl: (spec) => `/market/boards/${spec.params.board}`,
  shell: 'market',
  Component: (props) => <MarketBoardPage {...props} />,
}

const marketDetailModule: ViewModule<'market-detail'> = {
  kind: 'market-detail',
  title: (spec) => `${spec.params.symbol}`,
  toUrl: (spec) =>
    `/market/${spec.params.assetClass}/${encodeURIComponent(spec.params.symbol)}` +
    (spec.params.source ? `?source=${encodeURIComponent(spec.params.source)}` : ''),
  shell: 'market',
  Component: (props) => <MarketDetailPage {...props} />,
}

const settingsCategoryTitle: Record<
  Extract<ViewSpec, { kind: 'settings' }>['params']['category'],
  string
> = {
  general: 'Settings',
  appearance: 'Appearance',
  'activity-bar': 'Activity bar',
  'ai-provider': 'AI Provider',
  'agent-runtimes': 'Agent runtimes',
  'agent-permissions': 'Agent Permissions',
  tools: 'Tools',
  trading: 'Trading',
  issues: 'Issues',
  harness: 'Harness',
  connectors: 'Connectors',
  mcp: 'MCP Server',
  'market-data': 'Market Data',
  'news-collector': 'News Sources',
  beta: 'Beta',
}

function SettingsRouter({ spec }: ViewProps<'settings'>) {
  switch (spec.params.category) {
    case 'general': return <SettingsPage />
    case 'appearance': return <AppearanceSettingsPage />
    case 'activity-bar': return <ActivityBarSettingsPage />
    case 'ai-provider': return <AIProviderPage />
    case 'agent-runtimes': return <AgentRuntimesSettingsPage />
    case 'agent-permissions': return <AgentPermissionsPage />
    case 'tools': return <ToolsSettingsPage />
    case 'trading': return <TradingPage />
    case 'issues': return <IssueSettingsPage />
    case 'harness': return <HarnessSettingsPage />
    case 'connectors': return <ConnectorsPage />
    case 'mcp': return <MCPPage />
    case 'market-data': return <MarketDataPage />
    case 'news-collector': return <NewsCollectorPage />
    case 'beta': return <BetaSettingsPage />
  }
}

const settingsModule: ViewModule<'settings'> = {
  kind: 'settings',
  title: (spec) => settingsCategoryTitle[spec.params.category],
  toUrl: (spec) =>
    spec.params.category === 'general'
      ? '/settings'
      : `/settings/${spec.params.category}`,
  Component: (props) => (
    <PageSidebarShell
      storageKey="settings"
      titleKey="nav.item.settings"
      defaultWidth={220}
      desktopMinWidth={960}
      sidebar={({ closeMobileDrawer }) => <SettingsCategoryList onSelect={closeMobileDrawer} />}
    >
      <SettingsRouter {...props} />
    </PageSidebarShell>
  ),
}

const utaDetailModule: ViewModule<'uta-detail'> = {
  kind: 'uta-detail',
  title: (spec) => `Account ${spec.params.id}`,
  toUrl: (spec) => `/settings/uta/${encodeURIComponent(spec.params.id)}`,
  Component: (props) => (
    <TradingArea>
      <UTADetailPage {...props} />
    </TradingArea>
  ),
}

const onboardingModule: ViewModule<'onboarding'> = {
  kind: 'onboarding',
  title: () => 'Onboarding',
  toUrl: () => '/onboarding',
  Component: () => <OnboardingDesignPage />,
}

const designProjectModule: ViewModule<'design-project'> = {
  kind: 'design-project',
  title: (spec) => getDesignProject(spec.params.project)?.title ?? `Design: ${spec.params.project}`,
  toUrl: (spec) => `/design/${encodeURIComponent(spec.params.project)}`,
  Component: ({ spec }) => <DesignProjectPage spec={spec} />,
}

const devTabTitle: Record<Extract<ViewSpec, { kind: 'dev' }>['params']['tab'], string> = {
  frontend: 'Frontend',
  tools: 'Tools',
  onboarding: 'Onboarding',
  snapshots: 'Snapshots',
  logs: 'Logs',
  runs: 'Runs',
  api: 'API',
  simulator: 'Simulator',
}

const devModule: ViewModule<'dev'> = {
  kind: 'dev',
  title: (spec) => devTabTitle[spec.params.tab],
  toUrl: (spec) => `/settings/developer/${spec.params.tab}`,
  Component: (props) => (
    <PageSidebarShell
      storageKey="settings"
      titleKey="nav.item.settings"
      defaultWidth={220}
      desktopMinWidth={960}
      sidebar={({ closeMobileDrawer }) => <SettingsCategoryList onSelect={closeMobileDrawer} />}
    >
      <DevPage {...props} />
    </PageSidebarShell>
  ),
}

const inboxModule: ViewModule<'inbox'> = {
  kind: 'inbox',
  title: () => 'Inbox',
  toUrl: () => '/inbox',
  Component: ({ visible }) => (
    <InboxPageShell>
      <InboxPage visible={visible} />
    </InboxPageShell>
  ),
}

const trackedModule: ViewModule<'tracked'> = {
  kind: 'tracked',
  title: () => 'Tracked',
  toUrl: (spec) => {
    const search = new URLSearchParams()
    if (spec.params.entity) search.set('entity', spec.params.entity)
    if (spec.params.workspace && spec.params.issue) {
      search.set('workspace', spec.params.workspace)
      search.set('issue', spec.params.issue)
    }
    const query = search.toString()
    return query ? `/tracked?${query}` : '/tracked'
  },
  Component: ({ spec }) => (
    <PageSidebarShell
      storageKey="tracked"
      titleKey="nav.item.tracked"
      defaultWidth={232}
      sidebar={({ closeMobileDrawer }) => (
        <TrackedSidebar routeSelection={spec.params} onNavigate={closeMobileDrawer} />
      )}
    >
      <TrackedPage />
    </PageSidebarShell>
  ),
}

const chatLandingModule: ViewModule<'chat-landing'> = {
  kind: 'chat-landing',
  shell: 'chat',
  title: (spec, ctx) => {
    if (!spec.params.targetWsId) return 'Chat'
    const tag = ctx.workspaces?.find((w) => w.id === spec.params.targetWsId)?.tag
    return tag ? `New session · ${tag}` : 'New session'
  },
  toUrl: () => '/chat',
  Component: ({ spec }) => <ChatLandingPage spec={spec} />,
}

const autoQuantLandingModule: ViewModule<'auto-quant-landing'> = {
  kind: 'auto-quant-landing',
  shell: 'auto-quant',
  title: (spec, ctx) => {
    if (!spec.params.targetWsId) return 'AutoQuant'
    const tag = ctx.workspaces?.find((w) => w.id === spec.params.targetWsId)?.tag
    return tag ? `New research · ${tag}` : 'New research'
  },
  toUrl: () => '/auto-quant',
  Component: ({ spec }) => <AutoQuantLandingPage spec={spec} />,
}

const autoPredictionLandingModule: ViewModule<'auto-prediction-landing'> = {
  kind: 'auto-prediction-landing',
  shell: 'prediction',
  title: (spec, ctx) => {
    if (!spec.params.targetWsId) return 'Auto Prediction'
    const tag = ctx.workspaces?.find((w) => w.id === spec.params.targetWsId)?.tag
    return tag ? `New research · ${tag}` : 'New research'
  },
  toUrl: () => '/prediction',
  Component: ({ spec }) => <AutoPredictionLandingPage spec={spec} />,
}

const harnessSurfaceModule: ViewModule<'harness-surface'> = {
  kind: 'harness-surface',
  shell: (spec) => spec.params.source,
  title: (spec, ctx) => {
    const tag = ctx.workspaces?.find((workspace) => workspace.id === spec.params.wsId)?.tag
    return `${tag ?? spec.params.wsId.slice(0, 8)} · Studio`
  },
  toUrl: (spec) => `/${spec.params.source}/workspaces/${encodeURIComponent(spec.params.wsId)}/studio`,
  Component: ({ spec }) => <HarnessSurfacePage workspaceId={spec.params.wsId} source={spec.params.source} />,
}

const workspaceManagerModule: ViewModule<'workspace-manager'> = {
  kind: 'workspace-manager',
  shell: 'chat',
  title: () => 'Workspace Manager',
  toUrl: (spec) => spec.params.sessionId
    ? `/chat/manager/s/${encodeURIComponent(spec.params.sessionId)}`
    : '/chat/manager',
  Component: ({ spec }) => <WorkspaceManagerPage spec={spec} />,
}

const workspaceDetailsModule: ViewModule<'workspace-details'> = {
  kind: 'workspace-details',
  shell: (spec) => spec.params.source,
  title: (spec, ctx) => ctx.workspaces?.find((w) => w.id === spec.params.wsId)?.displayName
    || ctx.workspaces?.find((w) => w.id === spec.params.wsId)?.tag || 'Workspace',
  toUrl: (spec) => `/${spec.params.source}/workspaces/${encodeURIComponent(spec.params.wsId)}/details`,
  Component: ({ spec }) => <WorkspaceDetailsPage spec={spec} />,
}

// Retained only for saved tabs; this no longer mounts a global management UI.
const workspaceListModule: ViewModule<'workspace-list'> = {
  kind: 'workspace-list',
  shell: 'chat',
  title: () => 'Ask Alice',
  toUrl: () => '/chat',
  Component: () => <ChatLandingPage spec={{ params: {} }} />,
}

const workspaceModule: ViewModule<'workspace'> = {
  kind: 'workspace',
  shell: (spec) => spec.params.source === 'chat'
    ? 'chat'
    : spec.params.source === 'auto-quant'
      ? 'auto-quant'
      : spec.params.source === 'prediction' ? 'prediction' : null,
  title: (spec, ctx) => {
    const ws = ctx.workspaces?.find((w) => w.id === spec.params.wsId)
    const tag = ws?.tag ?? spec.params.wsId.slice(0, 8)
    const sid = spec.params.sessionId
    if (!sid) return tag
    const session = ws?.sessions.find((s) => s.id === sid)
    const name = session?.name ?? sid.slice(0, 6)
    return `${tag} · ${name}`
  },
  toUrl: (spec) => {
    const base =
      spec.params.source === 'chat'
        ? `/chat/workspaces/${encodeURIComponent(spec.params.wsId)}`
        : spec.params.source === 'auto-quant'
          ? `/auto-quant/workspaces/${encodeURIComponent(spec.params.wsId)}`
          : spec.params.source === 'prediction'
            ? `/prediction/workspaces/${encodeURIComponent(spec.params.wsId)}`
            : '/chat'
    if (!spec.params.source) return '/chat'
    const sid = spec.params.sessionId
    return sid ? `${base}/s/${encodeURIComponent(sid)}` : base
  },
  Component: (props) => props.spec.params.source
    ? <WorkspacePage {...props} />
    : <WorkspaceHarnessRedirect spec={props.spec} />,
}

// Retained only for saved tabs; this no longer mounts a global management UI.
const templateCatalogModule: ViewModule<'template-catalog'> = {
  kind: 'template-catalog',
  shell: 'chat',
  title: () => 'Ask Alice',
  toUrl: () => '/chat',
  Component: () => <ChatLandingPage spec={{ params: {} }} />,
}

// Retained only for saved tabs; this no longer mounts a global management UI.
const templateDetailModule: ViewModule<'template-detail'> = {
  kind: 'template-detail',
  shell: 'chat',
  title: () => 'Ask Alice',
  toUrl: () => '/chat',
  Component: () => <ChatLandingPage spec={{ params: {} }} />,
}

const fileViewerModule: ViewModule<'file-viewer'> = {
  kind: 'file-viewer',
  shell: (spec) => spec.params.source === 'chat'
    ? 'chat'
    : spec.params.source === 'auto-quant'
      ? 'auto-quant'
      : spec.params.source === 'prediction' ? 'prediction' : null,
  // Tab title = file basename; path itself shows in the page header.
  title: (spec) => spec.params.path.split('/').filter(Boolean).pop() ?? spec.params.path,
  toUrl: (spec) => {
    if (spec.params.source === 'tracked') {
      const query = spec.params.returnTrackedName
        ? `?entity=${encodeURIComponent(spec.params.returnTrackedName)}`
        : ''
      return `/tracked/files/${encodeURIComponent(spec.params.wsId)}/${encodeURIComponent(spec.params.path)}${query}`
    }
    const base = spec.params.source === 'chat'
      ? `/chat/workspaces/${encodeURIComponent(spec.params.wsId)}`
      : spec.params.source === 'auto-quant'
        ? `/auto-quant/workspaces/${encodeURIComponent(spec.params.wsId)}`
        : spec.params.source === 'prediction'
          ? `/prediction/workspaces/${encodeURIComponent(spec.params.wsId)}`
          : '/chat'
    if (!spec.params.source) return '/chat'
    const query = spec.params.returnSessionId
      ? `?sessionId=${encodeURIComponent(spec.params.returnSessionId)}`
      : ''
    return `${base}/view/${encodeURIComponent(spec.params.path)}${query}`
  },
  Component: ({ spec }) => spec.params.source === 'chat'
    || spec.params.source === 'auto-quant'
    || spec.params.source === 'prediction'
    ? <FileViewerPage spec={spec} />
    : spec.params.source === 'tracked'
      ? (
        <PageSidebarShell
          storageKey="tracked"
          titleKey="nav.item.tracked"
          defaultWidth={232}
          sidebar={({ closeMobileDrawer }) => <TrackedSidebar onNavigate={closeMobileDrawer} />}
        >
          <FileViewerPage spec={spec} />
        </PageSidebarShell>
      )
    : <WorkspaceHarnessRedirect spec={spec} />,
}

// ==================== Aggregate ====================

const VIEWS = {
  portfolio: portfolioModule,
  'trading-as-git': tradingAsGitModule,
  connectors: connectorsModule,
  issue: issueModule,
  'issue-detail': issueDetailModule,
  'tracked-issue-detail': trackedIssueDetailModule,
  automation: automationModule,
  office: officeModule,
  news: newsModule,
  'market-list': marketListModule,
  'market-rotation': marketRotationModule,
  'market-board': marketBoardModule,
  'market-detail': marketDetailModule,
  settings: settingsModule,
  'uta-detail': utaDetailModule,
  onboarding: onboardingModule,
  'design-project': designProjectModule,
  dev: devModule,
  inbox: inboxModule,
  tracked: trackedModule,
  'quick-start': { kind: 'quick-start', title: () => 'Quick Start', toUrl: () => '/quick-start', Component: QuickStartPage },
  'chat-landing': chatLandingModule,
  'auto-quant-landing': autoQuantLandingModule,
  'auto-prediction-landing': autoPredictionLandingModule,
  'harness-surface': harnessSurfaceModule,
  'workspace-manager': workspaceManagerModule,
  'workspace-list': workspaceListModule,
  'workspace-details': workspaceDetailsModule,
  workspace: workspaceModule,
  'template-catalog': templateCatalogModule,
  'template-detail': templateDetailModule,
  'file-viewer': fileViewerModule,
} as const satisfies { [K in ViewKind]: ViewModule<K> }

/** Untyped lookup — narrow at the call site by inspecting `spec.kind`. */
export function getView<K extends ViewKind>(kind: K): ViewModule<K> {
  return VIEWS[kind] as unknown as ViewModule<K>
}

/** Resolve shared product chrome without leaking per-kind generic narrowing to TabHost. */
export function getViewShell(spec: ViewSpec): ViewShell | null {
  const shell = (getView(spec.kind) as unknown as {
    shell?: ViewShell | ((candidate: ViewSpec) => ViewShell | null)
  }).shell
  if (typeof shell === 'function') return shell(spec)
  return shell ?? null
}
