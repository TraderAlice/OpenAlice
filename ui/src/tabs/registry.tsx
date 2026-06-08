import type { ComponentType } from 'react'
import type { Workspace } from '../components/workspace/api'
import type { ViewKind, ViewSpec } from './types'

import { PortfolioPage } from '../pages/PortfolioPage'
import { AutomationPage } from '../pages/AutomationPage'
import { NewsPage } from '../pages/NewsPage'
import { MarketPage } from '../pages/MarketPage'
import { MarketRotationPage } from '../pages/MarketRotationPage'
import { MarketDetailPage } from '../pages/MarketDetailPage'
import { SettingsPage } from '../pages/SettingsPage'
import { AIProviderPage } from '../pages/AIProviderPage'
import { TradingPage } from '../pages/TradingPage'
import { MCPPage } from '../pages/MCPPage'
import { MarketDataPage } from '../pages/MarketDataPage'
import { NewsCollectorPage } from '../pages/NewsCollectorPage'
import { UTADetailPage } from '../pages/UTADetailPage'
import { DevPage } from '../pages/DevPage'
import { InboxPage } from '../pages/InboxPage'
import { TrackedPage } from '../pages/TrackedPage'
import { WorkspaceListPage } from '../pages/WorkspaceListPage'
import { WorkspacePage } from '../pages/WorkspacePage'
import { TemplateCatalogPage } from '../pages/TemplateCatalogPage'
import { TemplateDetailPage } from '../pages/TemplateDetailPage'
import { FileViewerPage } from '../pages/FileViewerPage'

/**
 * Central registry mapping each ViewKind to its render component and URL
 * projection. Adding a new view kind means adding one entry here.
 *
 * Sidebar selection is decoupled from view kind — it's driven by
 * ActivityBar via `selectedSidebar` in the workspace store. The registry
 * no longer knows which sidebar a view "belongs to".
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

export interface ViewModule<K extends ViewKind> {
  kind: K
  /** Tab title — derived from spec each render so e.g. channel renames propagate. */
  title(spec: Extract<ViewSpec, { kind: K }>, ctx: TitleCtx): string
  /** URL the active tab projects onto window.location (via replaceState). */
  toUrl(spec: Extract<ViewSpec, { kind: K }>): string
  /** The actual page component. Ignores `visible` unless it needs catch-up behaviour. */
  Component: ComponentType<ViewProps<K>>
}

// ==================== Per-kind modules ====================

const portfolioModule: ViewModule<'portfolio'> = {
  kind: 'portfolio',
  title: () => 'Portfolio',
  toUrl: () => '/portfolio',
  Component: () => <PortfolioPage />,
}

const automationSectionTitle: Record<
  Extract<ViewSpec, { kind: 'automation' }>['params']['section'],
  string
> = {
  flow: 'Flow',
  heartbeat: 'Heartbeat',
  cron: 'Cron Jobs',
  webhook: 'Webhook',
  runs: 'Runs',
}

const automationModule: ViewModule<'automation'> = {
  kind: 'automation',
  title: (spec) => automationSectionTitle[spec.params.section],
  toUrl: (spec) => `/automation/${spec.params.section}`,
  Component: AutomationPage,
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
  Component: () => <MarketPage />,
}

const marketRotationModule: ViewModule<'market-rotation'> = {
  kind: 'market-rotation',
  title: () => 'Sector Rotation',
  toUrl: () => '/market/rotation',
  Component: () => <MarketRotationPage />,
}

const marketDetailModule: ViewModule<'market-detail'> = {
  kind: 'market-detail',
  title: (spec) => `${spec.params.symbol}`,
  toUrl: (spec) =>
    `/market/${spec.params.assetClass}/${encodeURIComponent(spec.params.symbol)}`,
  Component: MarketDetailPage,
}

const settingsCategoryTitle: Record<
  Extract<ViewSpec, { kind: 'settings' }>['params']['category'],
  string
> = {
  general: 'Settings',
  'ai-provider': 'AI Provider',
  trading: 'Trading',
  mcp: 'MCP Server',
  'market-data': 'Market Data',
  'news-collector': 'News Sources',
}

function SettingsRouter({ spec }: ViewProps<'settings'>) {
  switch (spec.params.category) {
    case 'general': return <SettingsPage />
    case 'ai-provider': return <AIProviderPage />
    case 'trading': return <TradingPage />
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
  Component: SettingsRouter,
}

const utaDetailModule: ViewModule<'uta-detail'> = {
  kind: 'uta-detail',
  title: (spec) => `Account ${spec.params.id}`,
  toUrl: (spec) => `/settings/uta/${encodeURIComponent(spec.params.id)}`,
  Component: UTADetailPage,
}

const devTabTitle: Record<Extract<ViewSpec, { kind: 'dev' }>['params']['tab'], string> = {
  tools: 'Tools',
  snapshots: 'Snapshots',
  logs: 'Logs',
  simulator: 'Simulator',
}

const devModule: ViewModule<'dev'> = {
  kind: 'dev',
  title: (spec) => devTabTitle[spec.params.tab],
  toUrl: (spec) => `/dev/${spec.params.tab}`,
  Component: DevPage,
}

const inboxModule: ViewModule<'inbox'> = {
  kind: 'inbox',
  title: () => 'Inbox',
  toUrl: () => '/inbox',
  Component: InboxPage,
}

const trackedModule: ViewModule<'tracked'> = {
  kind: 'tracked',
  title: () => 'Tracked',
  toUrl: () => '/tracked',
  Component: () => <TrackedPage />,
}

const workspaceListModule: ViewModule<'workspace-list'> = {
  kind: 'workspace-list',
  title: () => 'Workspaces',
  toUrl: () => '/workspaces',
  Component: () => <WorkspaceListPage />,
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
    const base = `/workspaces/${encodeURIComponent(spec.params.wsId)}`
    const sid = spec.params.sessionId
    return sid ? `${base}/s/${encodeURIComponent(sid)}` : base
  },
  Component: WorkspacePage,
}

const templateCatalogModule: ViewModule<'template-catalog'> = {
  kind: 'template-catalog',
  title: () => 'Templates',
  toUrl: () => '/workspaces/templates',
  Component: () => <TemplateCatalogPage />,
}

const templateDetailModule: ViewModule<'template-detail'> = {
  kind: 'template-detail',
  title: (spec) => `Template · ${spec.params.name}`,
  toUrl: (spec) => `/workspaces/templates/${encodeURIComponent(spec.params.name)}`,
  Component: ({ spec }) => <TemplateDetailPage spec={spec} />,
}

const fileViewerModule: ViewModule<'file-viewer'> = {
  kind: 'file-viewer',
  // Tab title = file basename; path itself shows in the page header.
  title: (spec) => spec.params.path.split('/').filter(Boolean).pop() ?? spec.params.path,
  toUrl: (spec) =>
    `/workspaces/${encodeURIComponent(spec.params.wsId)}/view/${encodeURIComponent(spec.params.path)}`,
  Component: ({ spec }) => <FileViewerPage spec={spec} />,
}

// ==================== Aggregate ====================

export const VIEWS = {
  portfolio: portfolioModule,
  automation: automationModule,
  news: newsModule,
  'market-list': marketListModule,
  'market-rotation': marketRotationModule,
  'market-detail': marketDetailModule,
  settings: settingsModule,
  'uta-detail': utaDetailModule,
  dev: devModule,
  inbox: inboxModule,
  tracked: trackedModule,
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
