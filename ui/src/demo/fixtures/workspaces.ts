import type { Workspace, TemplateInfo, SessionRecord } from '../../components/workspace/api'

// The flagship demo workspace — the one inbox/transcript fixtures tie to.
// Template is `chat` (the general-purpose workspace): the AAPL Q1 transcript
// is a research session (read SEC filings, compute services-rev YoY, write
// report, inbox_push), which Chat handles fine. A real template name makes
// the Workspaces sidebar group it correctly.
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
  title: "What jumped out from Apple's Q1 earnings?",
}

export const demoWorkspace: Workspace = {
  id: DEMO_WORKSPACE_ID,
  tag: 'aapl-q1',
  displayName: 'AAPL Q1 review',
  dir: '/demo/workspaces/aapl-q1',
  createdAt: new Date().toISOString(),
  template: 'chat',
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

// A small spread of agents + states so the sidebar shows the full session
// styling (per-agent badge colours for claude/codex/opencode/pi, the paused
// treatment, and the hover pause/resume/delete icons).
const demoChatSessions: SessionRecord[] = [
  {
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
    title: "What's moving in semiconductors today?",
  },
  {
    id: 'demo-chat-x1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'codex',
    name: 'x1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'running',
    agentSessionId: '019eb75e-0b1b-7fa2',
    pid: 0,
    startedAt: Date.now(),
    title: 'Build a thesis on NVDA',
  },
  {
    id: 'demo-chat-o1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'opencode',
    name: 'o1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'paused',
    agentSessionId: 'ses_148a17c1bffe',
    pid: null,
    startedAt: null,
    title: 'Scan the EV supply chain for bottlenecks',
  },
  {
    id: 'demo-chat-p1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'pi',
    name: 'p1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'paused',
    agentSessionId: '6850b4d0-1c2e',
    pid: null,
    startedAt: null,
    title: '解释一下美债收益率曲线倒挂意味着什么',
  },
]

export const demoChatWorkspace: Workspace = {
  id: DEMO_CHAT_WORKSPACE_ID,
  tag: 'chat-may26',
  displayName: 'Semis and supply chain',
  dir: '/demo/workspaces/chat-may26',
  createdAt: new Date().toISOString(),
  template: 'chat',
  spawnedFromVersion: '0.1.0',
  currentVersion: '0.1.0',
  upgradeAvailable: null,
  agents: ['claude', 'codex', 'opencode', 'pi'],
  sessions: demoChatSessions,
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

export const demoWorkspaces: Workspace[] = [demoWorkspace, demoChatWorkspace]

// Templates — names + metadata mirror the real template at
// src/workspaces/templates/chat/template.json. The name matters: the Chat /
// Workspaces sidebars filter on the literal 'chat' template name.
export const chatTemplate: TemplateInfo = {
  name: 'chat',
  displayName: 'Chat',
  description:
    "General-purpose Alice workspace — Alice's full tool surface (market/research data + trading) via the alice*/traderhub CLIs on PATH.",
  groupOrder: 10,
  defaultAgents: ['claude', 'codex'],
  version: '0.1.0',
  hasReadme: false,
}

export const demoTemplates: TemplateInfo[] = [chatTemplate]

// Back-compat singleton for older callers (other fixture files reference
// `demoTemplate` and we want a stable name). Points at the flagship.
export const demoTemplate: TemplateInfo = chatTemplate
