import type { ThemeColorScenario } from './types.js'

const desktop = { width: 1440, height: 1000 } as const
const bothThemes = ['light', 'dark'] as const

export const globalColorSourcePaths = ['ui/src/index.css'] as const

export const themeColorScenarios = [
  {
    scenarioId: 'workspace-overview-normal', route: '/workspaces', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Workspaces Overview' }, actions: [],
    sourcePaths: [
      'ui/src/components/ActivityBar.tsx', 'ui/src/components/FirstRunGuide.tsx', 'ui/src/components/PageSidebarLayout.tsx',
      'ui/src/components/workspace/OverviewCard.tsx', 'ui/src/components/workspace/Terminal.tsx',
      'ui/src/components/workspace/WorkspaceAIConfigModal.tsx', 'ui/src/components/workspace/workspaces.css',
      'ui/src/pages/ChatLandingPage.tsx', 'ui/src/components/Toggle.tsx',
    ],
  },
  {
    scenarioId: 'workspace-config-dialog', route: '/workspaces', fixtureProfile: 'demo', state: 'dialog-overlay',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Workspace Settings' },
    actions: [{ kind: 'click', role: 'button', name: 'Configure this workspace' }],
    sourcePaths: ['ui/src/components/workspace/WorkspaceAIConfigModal.tsx'],
  },
  {
    scenarioId: 'workspace-new-hover', route: '/workspaces', fixtureProfile: 'demo', state: 'hover',
    themes: bothThemes, viewport: desktop, ready: { role: 'button', name: 'New workspace' },
    actions: [{ kind: 'hover', role: 'button', name: 'New workspace' }],
    sourcePaths: ['ui/src/components/workspace/workspaces.css'],
  },
  {
    scenarioId: 'automation-runs-normal', route: '/automation/runs', fixtureProfile: 'demo', state: 'warning',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Runs' }, actions: [],
    sourcePaths: ['ui/src/pages/AutomationRunsSection.tsx', 'ui/src/pages/AutomationApiSection.tsx'],
  },
  {
    scenarioId: 'issues-board-normal', route: '/issues', fixtureProfile: 'demo', state: 'selected',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Issues' }, actions: [],
    sourcePaths: ['ui/src/components/IssuesBoard.tsx', 'ui/src/components/issue-status-meta.ts'],
  },
  {
    scenarioId: 'issue-detail-approval', route: '/issues/demo-ws-auto-quant/morning-scan', fixtureProfile: 'demo', state: 'warning',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Morning movers scan' }, actions: [],
    sourcePaths: [
      'ui/src/components/IssueDetail.tsx', 'ui/src/components/InquiryPanel.tsx', 'ui/src/components/MarkdownWhatEditor.tsx',
      'ui/src/components/PushApprovalPanel.tsx', 'ui/src/components/issue-status-meta.ts',
    ],
  },
  {
    scenarioId: 'issue-comment-focus', route: '/issues/demo-ws-auto-quant/morning-scan', fixtureProfile: 'demo', state: 'focus',
    themes: bothThemes, viewport: desktop, ready: { role: 'textbox', name: 'Leave a comment… (⌘↵ / Ctrl↵ to send)' },
    actions: [{ kind: 'focus', role: 'textbox', name: 'Leave a comment… (⌘↵ / Ctrl↵ to send)' }],
    sourcePaths: ['ui/src/components/IssueDetail.tsx'],
  },
  {
    scenarioId: 'market-aapl-normal', route: '/market/equity/AAPL', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'AAPL' }, actions: [],
    sourcePaths: [
      'ui/src/components/MarketSidebar.tsx', 'ui/src/components/market/BoardMeta.tsx', 'ui/src/components/market/KlinePanel.tsx',
      'ui/src/components/market/SearchBox.tsx', 'ui/src/pages/MarketBoardPage.tsx', 'ui/src/pages/MarketDetailPage.tsx',
      'ui/src/pages/MarketRotationPage.tsx',
    ],
  },
  {
    scenarioId: 'connectors-normal', route: '/connectors', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'main' }, actions: [],
    sourcePaths: [
      'ui/src/components/SDKSelector.tsx', 'ui/src/components/credentials/CredentialModal.tsx',
      'ui/src/pages/ConnectorsPage.tsx', 'ui/src/pages/ConnectorStatusPage.tsx',
    ],
  },
  {
    scenarioId: 'inbox-normal', route: '/inbox', fixtureProfile: 'demo', state: 'selected',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Inbox' }, actions: [],
    sourcePaths: ['ui/src/components/InboxSidebar.tsx', 'ui/src/components/SnapshotDetail.tsx', 'ui/src/pages/InboxPage.tsx'],
  },
  {
    scenarioId: 'portfolio-normal', route: '/portfolio', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Portfolio' }, actions: [],
    sourcePaths: ['ui/src/pages/PortfolioPage.tsx'],
  },
  {
    scenarioId: 'trading-settings-normal', route: '/settings/trading', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Trading' }, actions: [],
    sourcePaths: [
      'ui/src/components/uta/CreateUTADialog.tsx', 'ui/src/components/uta/Dialog.tsx', 'ui/src/components/uta/HealthBadge.tsx',
      'ui/src/components/uta/OrderEntryDialog.tsx', 'ui/src/pages/TradingPage.tsx', 'ui/src/pages/UTADetailPage.tsx',
    ],
  },
  {
    scenarioId: 'agent-permissions-normal', route: '/settings/agent-permissions', fixtureProfile: 'demo', state: 'disabled',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Agent Permissions' }, actions: [],
    sourcePaths: ['ui/src/pages/AgentPermissionsPage.tsx'],
  },
  {
    scenarioId: 'simulator-unavailable', route: '/dev/simulator', fixtureProfile: 'demo', state: 'error',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'Simulator' }, actions: [],
    sourcePaths: [
      'ui/src/pages/DevPage.tsx', 'ui/src/pages/SimulatorPage.tsx', 'ui/src/pages/simulator/ActionPanel.tsx',
      'ui/src/pages/simulator/PendingOrders.tsx',
    ],
  },
  {
    scenarioId: 'onboarding-design-normal', route: '/design/first-run-onboarding', fixtureProfile: 'demo', state: 'normal',
    themes: bothThemes, viewport: desktop, ready: { role: 'heading', name: 'First-run onboarding' }, actions: [],
    sourcePaths: ['ui/src/pages/DesignProjectPage.tsx', 'ui/src/pages/OnboardingDesignPage.tsx'],
  },
] as const satisfies readonly ThemeColorScenario[]
