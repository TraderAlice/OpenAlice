import type { ComponentType } from 'react'
import type { Workspace } from '../components/workspace/api'
import type { ViewKind, ViewSpec } from './types'

import { PortfolioPage } from '../pages/PortfolioPage'
import { TradingAsGitPage } from '../pages/TradingAsGitPage'
import { IssuePage } from '../pages/IssuePage'
import { IssueSettingsPage } from '../pages/IssueSettingsPage'
import { IssueDetailPage } from '../pages/IssueDetailPage'
import { TrackedIssueDetailPage } from '../pages/TrackedIssueDetailPage'
import { AutomationPage } from '../pages/AutomationPage'
import { NewsPage } from '../pages/NewsPage'
import { MarketPage } from '../pages/MarketPage'
import { MarketRotationPage } from '../pages/MarketRotationPage'
import { MarketBoardPage } from '../pages/MarketBoardPage'
import { MARKET_BOARD_TITLES } from '../pages/market-board-titles'
import { MarketDetailPage } from '../pages/MarketDetailPage'
import { SettingsPage } from '../pages/SettingsPage'
import { AgentPermissionsPage } from '../pages/AgentPermissionsPage'
import { AIProviderPage } from '../pages/AIProviderPage'
import { TradingPage } from '../pages/TradingPage'
import { MCPPage } from '../pages/MCPPage'
import { MarketDataPage } from '../pages/MarketDataPage'
import { NewsCollectorPage } from '../pages/NewsCollectorPage'
import { UTADetailPage } from '../pages/UTADetailPage'
import { OnboardingDesignPage } from '../pages/OnboardingDesignPage'
import { DesignProjectPage } from '../pages/DesignProjectPage'
import { DevPage } from '../pages/DevPage'
import { InboxPage } from '../pages/InboxPage'
import { InboxPageShell } from '../pages/InboxPageShell'
import { TrackedPage } from '../pages/TrackedPage'
import { ChatLandingPage } from '../pages/ChatLandingPage'
import { ChatPageShell } from '../pages/ChatPageShell'
import { PageSidebarShell } from '../pages/PageSidebarShell'
import { WorkspaceListPage } from '../pages/WorkspaceListPage'
import { WorkspacePage } from '../pages/WorkspacePage'
import { TemplateCatalogPage } from '../pages/TemplateCatalogPage'
import { TemplateDetailPage } from '../pages/TemplateDetailPage'
import { FileViewerPage } from '../pages/FileViewerPage'
import { TrackedSidebar } from '../components/TrackedSidebar'
import { WorkspacesSidebar } from '../components/workspace/WorkspacesSidebar'
import { SettingsCategoryList } from '../components/SettingsCategoryList'
import { DevCategoryList } from '../components/DevCategoryList'
import { MarketSidebar } from '../components/MarketSidebar'
import { PortfolioSidebar } from '../components/PortfolioSidebar'
import { AutomationSidebar } from '../components/AutomationSidebar'
import { getDesignProject } from '../design/projects'

/**
 * Central registry mapping each ViewKind to its render component and URL
 * projection. Adding a new view kind means adding one entry here.
 *
 * Page-owned sidebars live here with their pages. The app shell only owns the
 * ActivityBar; each view kind decides whether it needs local navigation.
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
  /** The actual page component. Ignores `visible` unless it needs catch-up behaviour. */
  Component: ComponentType<ViewProps<K>>
}

// ==================== Per-kind modules ====================

const portfolioModule: ViewModule<'portfolio'> = {
  kind: 'portfolio',
  title: () => 'Portfolio',
  toUrl: () => '/portfolio',
  Component: () => (
    <PageSidebarShell
      storageKey="portfolio"
      titleKey="nav.item.portfolio"
      defaultWidth={220}
      sidebar={<PortfolioSidebar />}
    >
      <PortfolioPage />
    </PageSidebarShell>
  ),
}

const tradingAsGitModule: ViewModule<'trading-as-git'> = {
  kind: 'trading-as-git',
  title: () => 'Trading as Git',
  toUrl: () => '/trading-as-git',
  Component: () => <TradingAsGitPage />,
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
  Component: ({ spec }) => <IssueDetailPage spec={spec} />,
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
      sidebar={<TrackedSidebar />}
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
  flow: 'Flow',
  webhook: 'Webhook',
}

const automationModule: ViewModule<'automation'> = {
  kind: 'automation',
  title: (spec) => automationSectionTitle[spec.params.section],
  toUrl: (spec) => `/automation/${spec.params.section}`,
  Component: (props) => (
    <PageSidebarShell
      storageKey="automation"
      titleKey="nav.item.automation"
      defaultWidth={220}
      sidebar={<AutomationSidebar />}
    >
      <AutomationPage {...props} />
    </PageSidebarShell>
  ),
}

const newsModule: ViewModule<'news'> = {
  kind: 'news',
  title: () => 'News',
  toUrl: () => '/news',
  Component: () => <NewsPage />,
}

const marketListModule: ViewModule<'market-list'> = {
  kind: 'market-list',
  title: () => 'Market',
  toUrl: () => '/market',
  Component: () => (
    <PageSidebarShell
      storageKey="market"
      titleKey="nav.item.market"
      defaultWidth={300}
      sidebar={<MarketSidebar />}
    >
      <MarketPage />
    </PageSidebarShell>
  ),
}

const marketRotationModule: ViewModule<'market-rotation'> = {
  kind: 'market-rotation',
  title: () => 'Sector Rotation',
  toUrl: () => '/market/rotation',
  Component: () => (
    <PageSidebarShell
      storageKey="market"
      titleKey="nav.item.market"
      defaultWidth={300}
      sidebar={<MarketSidebar />}
    >
      <MarketRotationPage />
    </PageSidebarShell>
  ),
}

const marketBoardModule: ViewModule<'market-board'> = {
  kind: 'market-board',
  title: (spec) => MARKET_BOARD_TITLES[spec.params.board],
  toUrl: (spec) => `/market/boards/${spec.params.board}`,
  Component: (props) => (
    <PageSidebarShell
      storageKey="market"
      titleKey="nav.item.market"
      defaultWidth={300}
      sidebar={<MarketSidebar />}
    >
      <MarketBoardPage {...props} />
    </PageSidebarShell>
  ),
}

const marketDetailModule: ViewModule<'market-detail'> = {
  kind: 'market-detail',
  title: (spec) => `${spec.params.symbol}`,
  toUrl: (spec) =>
    `/market/${spec.params.assetClass}/${encodeURIComponent(spec.params.symbol)}` +
    (spec.params.source ? `?source=${encodeURIComponent(spec.params.source)}` : ''),
  Component: (props) => (
    <PageSidebarShell
      storageKey="market"
      titleKey="nav.item.market"
      defaultWidth={300}
      sidebar={<MarketSidebar />}
    >
      <MarketDetailPage {...props} />
    </PageSidebarShell>
  ),
}

const settingsCategoryTitle: Record<
  Extract<ViewSpec, { kind: 'settings' }>['params']['category'],
  string
> = {
  general: 'Settings',
  'ai-provider': 'AI Provider',
  'agent-permissions': 'Agent Permissions',
  trading: 'Trading',
  issues: 'Issues',
  mcp: 'MCP Server',
  'market-data': 'Market Data',
  'news-collector': 'News Sources',
}

function SettingsRouter({ spec }: ViewProps<'settings'>) {
  switch (spec.params.category) {
    case 'general': return <SettingsPage />
    case 'ai-provider': return <AIProviderPage />
    case 'agent-permissions': return <AgentPermissionsPage />
    case 'trading': return <TradingPage />
    case 'issues': return <IssueSettingsPage />
    case 'mcp': return <MCPPage />
    case 'market-data': return <MarketDataPage />
    case 'news-collector': return <NewsCollectorPage />
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
      sidebar={<SettingsCategoryList />}
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
    <PageSidebarShell
      storageKey="portfolio"
      titleKey="nav.item.portfolio"
      defaultWidth={220}
      sidebar={<PortfolioSidebar />}
    >
      <UTADetailPage {...props} />
    </PageSidebarShell>
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
  tools: 'Tools',
  onboarding: 'Onboarding',
  snapshots: 'Snapshots',
  logs: 'Logs',
  simulator: 'Simulator',
}

const devModule: ViewModule<'dev'> = {
  kind: 'dev',
  title: (spec) => devTabTitle[spec.params.tab],
  toUrl: (spec) => `/dev/${spec.params.tab}`,
  Component: (props) => (
    <PageSidebarShell
      storageKey="dev"
      titleKey="nav.item.dev"
      defaultWidth={220}
      sidebar={<DevCategoryList />}
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
  toUrl: () => '/tracked',
  Component: () => (
    <PageSidebarShell
      storageKey="tracked"
      titleKey="nav.item.tracked"
      defaultWidth={232}
      sidebar={<TrackedSidebar />}
    >
      <TrackedPage />
    </PageSidebarShell>
  ),
}

const chatLandingModule: ViewModule<'chat-landing'> = {
  kind: 'chat-landing',
  title: (spec, ctx) => {
    if (!spec.params.targetWsId) return 'Ask Alice'
    const tag = ctx.workspaces?.find((w) => w.id === spec.params.targetWsId)?.tag
    return tag ? `New session · ${tag}` : 'New session'
  },
  toUrl: () => '/chat',
  Component: ({ spec }) => (
    <ChatPageShell>
      <ChatLandingPage spec={spec} />
    </ChatPageShell>
  ),
}

const workspaceListModule: ViewModule<'workspace-list'> = {
  kind: 'workspace-list',
  title: () => 'Workspaces',
  toUrl: () => '/workspaces',
  Component: () => (
    <PageSidebarShell
      storageKey="workspaces"
      titleKey="nav.item.workspaces"
      defaultWidth={300}
      sidebar={<WorkspacesSidebar />}
    >
      <WorkspaceListPage />
    </PageSidebarShell>
  ),
}

const workspaceModule: ViewModule<'workspace'> = {
  kind: 'workspace',
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
        : `/workspaces/${encodeURIComponent(spec.params.wsId)}`
    const sid = spec.params.sessionId
    return sid ? `${base}/s/${encodeURIComponent(sid)}` : base
  },
  Component: (props) =>
    props.spec.params.source === 'chat'
      ? (
        <ChatPageShell>
          <WorkspacePage {...props} />
        </ChatPageShell>
      )
      : (
        <PageSidebarShell
          storageKey="workspaces"
          titleKey="nav.item.workspaces"
          defaultWidth={300}
          sidebar={<WorkspacesSidebar />}
        >
          <WorkspacePage {...props} />
        </PageSidebarShell>
      ),
}

const templateCatalogModule: ViewModule<'template-catalog'> = {
  kind: 'template-catalog',
  title: () => 'Templates',
  toUrl: () => '/workspaces/templates',
  Component: () => (
    <PageSidebarShell
      storageKey="workspaces"
      titleKey="nav.item.workspaces"
      defaultWidth={300}
      sidebar={<WorkspacesSidebar />}
    >
      <TemplateCatalogPage />
    </PageSidebarShell>
  ),
}

const templateDetailModule: ViewModule<'template-detail'> = {
  kind: 'template-detail',
  title: (spec) => `Template · ${spec.params.name}`,
  toUrl: (spec) => `/workspaces/templates/${encodeURIComponent(spec.params.name)}`,
  Component: ({ spec }) => (
    <PageSidebarShell
      storageKey="workspaces"
      titleKey="nav.item.workspaces"
      defaultWidth={300}
      sidebar={<WorkspacesSidebar />}
    >
      <TemplateDetailPage spec={spec} />
    </PageSidebarShell>
  ),
}

const fileViewerModule: ViewModule<'file-viewer'> = {
  kind: 'file-viewer',
  // Tab title = file basename; path itself shows in the page header.
  title: (spec) => spec.params.path.split('/').filter(Boolean).pop() ?? spec.params.path,
  toUrl: (spec) =>
    `/workspaces/${encodeURIComponent(spec.params.wsId)}/view/${encodeURIComponent(spec.params.path)}`,
  Component: ({ spec }) => (
    <PageSidebarShell
      storageKey="workspaces"
      titleKey="nav.item.workspaces"
      defaultWidth={300}
      sidebar={<WorkspacesSidebar />}
    >
      <FileViewerPage spec={spec} />
    </PageSidebarShell>
  ),
}

// ==================== Aggregate ====================

const VIEWS = {
  portfolio: portfolioModule,
  'trading-as-git': tradingAsGitModule,
  issue: issueModule,
  'issue-detail': issueDetailModule,
  'tracked-issue-detail': trackedIssueDetailModule,
  automation: automationModule,
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
  'chat-landing': chatLandingModule,
  'workspace-list': workspaceListModule,
  workspace: workspaceModule,
  'template-catalog': templateCatalogModule,
  'template-detail': templateDetailModule,
  'file-viewer': fileViewerModule,
} as const satisfies { [K in ViewKind]: ViewModule<K> }

/** Untyped lookup — narrow at the call site by inspecting `spec.kind`. */
export function getView<K extends ViewKind>(kind: K): ViewModule<K> {
  return VIEWS[kind] as unknown as ViewModule<K>
}
