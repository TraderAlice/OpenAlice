import type { Workspace, TemplateInfo, SessionRecord } from '../../components/workspace/api'

// The flagship demo workspace — the one inbox/transcript fixtures tie to.
// Template is `finance-research` because the AAPL Q1 transcript IS a
// finance-research session (read SEC filings, compute services-rev YoY,
// write report, inbox_push). Using a real template name (vs the earlier
// `demo-template` placeholder) makes the Workspaces sidebar group it
// correctly AND keeps the door open for the Chat shortcut sidebar to find
// its own workspace via the `chat` template filter.
export const DEMO_WORKSPACE_ID = 'demo-ws'
export const DEMO_SESSION_ID = 'demo-session'

const demoSession: SessionRecord = {
  id: DEMO_SESSION_ID,
  wsId: DEMO_WORKSPACE_ID,
  agent: 'claude',
  name: 'c1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running',
  agentSessionId: null,
  pid: 0,
  startedAt: Date.now(),
}

export const demoWorkspace: Workspace = {
  id: DEMO_WORKSPACE_ID,
  tag: 'aapl-q1',
  dir: '/demo/workspaces/aapl-q1',
  createdAt: new Date().toISOString(),
  template: 'finance-research',
  spawnedFromVersion: '0.1.0',
  currentVersion: '0.1.0',
  upgradeAvailable: null,
  agents: ['claude'],
  sessions: [demoSession],
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

// Chat workspace — populates the Chat activity sidebar (which filters
// `template === 'chat'`). No transcript registered, so its session pane
// falls back to DemoTerminalStub — that's the right "this is a live PTY
// in real OpenAlice" placeholder for demo mode.
export const DEMO_CHAT_WORKSPACE_ID = 'demo-chat-ws'
export const DEMO_CHAT_SESSION_ID = 'demo-chat-session'

const demoChatSession: SessionRecord = {
  id: DEMO_CHAT_SESSION_ID,
  wsId: DEMO_CHAT_WORKSPACE_ID,
  agent: 'claude',
  name: 'c1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running',
  agentSessionId: null,
  pid: 0,
  startedAt: Date.now(),
}

export const demoChatWorkspace: Workspace = {
  id: DEMO_CHAT_WORKSPACE_ID,
  tag: 'chat-may26',
  dir: '/demo/workspaces/chat-may26',
  createdAt: new Date().toISOString(),
  template: 'chat',
  spawnedFromVersion: '0.1.0',
  currentVersion: '0.1.0',
  upgradeAvailable: null,
  agents: ['claude', 'codex'],
  sessions: [demoChatSession],
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

export const demoWorkspaces: Workspace[] = [demoWorkspace, demoChatWorkspace]

// Templates — names + metadata mirror the real templates at
// src/workspaces/templates/{chat,finance-research}/template.json. Aligning
// the names matters: Chat / Workspaces sidebars filter on the literal
// 'chat' / 'finance-research' template name.
export const financeResearchTemplate: TemplateInfo = {
  name: 'finance-research',
  displayName: 'Finance Research',
  description:
    'Finance research workspace bundling himself65/finance-skills (yfinance market data, valuation, earnings, social readers, sentiment).',
  groupOrder: 30,
  community: true,
  defaultAgents: ['claude', 'codex'],
  version: '0.1.0',
  hasReadme: false,
}

export const chatTemplate: TemplateInfo = {
  name: 'chat',
  displayName: 'Chat',
  description:
    "General-purpose Alice workspace — Alice's full tool surface (market/research data + trading) via the alice*/traderhub CLIs by default, or as MCP servers, per launch choice.",
  groupOrder: 10,
  defaultAgents: ['claude', 'codex'],
  version: '0.1.0',
  hasReadme: false,
}

export const demoTemplates: TemplateInfo[] = [chatTemplate, financeResearchTemplate]

// Back-compat singleton for older callers (other fixture files reference
// `demoTemplate` and we want a stable name). Points at the flagship.
export const demoTemplate: TemplateInfo = financeResearchTemplate
