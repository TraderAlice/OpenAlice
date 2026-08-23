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
  resumeId: 'demo-resume-main',
  wsId: DEMO_WORKSPACE_ID,
  agent: 'pi',
  name: 'p1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running',
  surface: 'webpi',
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
  upgradeAvailable: { from: '0.1.0', to: '0.2.0' },
  sessions: [demoSession],
  runtimeSettings: {
    version: 3,
    runtime: {
      interactive: {
        agents: {},
        recent: {
          agent: 'pi',
          agents: {
          pi: {
            accessMode: 'vault',
            credentialSlug: 'openai-1',
            wireShape: 'openai-chat',
            model: 'gpt-5.6-sol',
            reasoningEffort: 'high',
          },
          },
        },
      },
      headless: { agents: {}, recent: { agent: 'pi', agents: { pi: { accessMode: 'native' } } } },
    },
  },
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

// Chat workspace — populates the Chat activity sidebar (which filters
// `template === 'chat'`). Its featured Session uses the real WebPi renderer
// over recorded native Pi messages; the remaining rows keep the multi-runtime
// history visible.
export const DEMO_CHAT_WORKSPACE_ID = 'demo-chat-ws'
export const DEMO_CHAT_SESSION_ID = 'demo-chat-session'
export const DEMO_AUTO_QUANT_WORKSPACE_ID = 'demo-ws-auto-quant'
export const DEMO_AUTO_PREDICTION_WORKSPACE_ID = 'demo-ws-auto-prediction'
export const DEMO_MACRO_WORKSPACE_ID = 'demo-ws-macro'

// A small spread of agents + states so the sidebar shows the full session
// styling (per-agent badge colours for claude/codex/opencode/pi, the paused
// treatment, and the hover pause/resume/delete icons).
const demoChatSessions: SessionRecord[] = [
  {
    id: DEMO_CHAT_SESSION_ID,
    resumeId: 'demo-resume-chat',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'pi',
    name: 'p1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'running',
    surface: 'webpi',
    pid: 0,
    startedAt: Date.now(),
    title: "What's moving in semiconductors today?",
  },
  {
    id: 'demo-chat-x1',
    resumeId: 'demo-resume-x1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'codex',
    name: 'x1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'running',
    pid: 0,
    startedAt: Date.now(),
    title: 'Build a thesis on NVDA',
  },
  {
    id: 'demo-chat-o1',
    resumeId: 'demo-resume-o1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'opencode',
    name: 'o1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'paused',
    pid: null,
    startedAt: null,
    title: 'Scan the EV supply chain for bottlenecks',
  },
  {
    id: 'demo-chat-p1',
    resumeId: 'demo-resume-p1',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'pi',
    name: 'p2',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    state: 'paused',
    pid: null,
    startedAt: null,
    title: '解释一下美债收益率曲线倒挂意味着什么',
  },
  {
    id: 'demo-chat-headless-codex',
    resumeId: 'resume-demo-headless-colleague',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'codex',
    name: 'x2',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    lastActiveAt: new Date(Date.now() - 120_000).toISOString(),
    state: 'paused',
    surface: 'headless',
    pid: null,
    startedAt: null,
    title: 'Morning semiconductor scan',
    sourceRunId: 'demo-headless-colleague-run',
  },
  {
    id: 'demo-chat-headless-claude',
    resumeId: 'resume-demo-headless-running',
    wsId: DEMO_CHAT_WORKSPACE_ID,
    agent: 'claude',
    name: 'c1',
    createdAt: new Date(Date.now() - 720_000).toISOString(),
    lastActiveAt: new Date(Date.now() - 5_000).toISOString(),
    state: 'running',
    surface: 'headless',
    pid: null,
    startedAt: null,
    title: 'Open issue scan',
    sourceRunId: 'demo-headless-running',
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
  sessions: demoChatSessions,
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

const demoIssueWorkspaces: Workspace[] = [
  {
    id: DEMO_AUTO_QUANT_WORKSPACE_ID,
    tag: 'auto-quant',
    displayName: 'Auto Quant',
    dir: '/demo/workspaces/auto-quant',
    createdAt: new Date().toISOString(),
    template: 'auto-quant-v2',
    harnessSource: {
      schemaVersion: 1,
      template: 'auto-quant-v2',
      repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
      version: 'v0.8.31',
      commit: '426d815b18450172fbcf4c6b6af77c6ae05a4967',
    },
    sessions: [],
    agentOverride: { claude: false, codex: false, opencode: false, pi: false },
  },
  {
    id: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
    tag: 'prediction',
    displayName: 'Auto Prediction',
    dir: '/demo/workspaces/auto-prediction',
    createdAt: new Date().toISOString(),
    template: 'auto-prediction',
    harnessSource: {
      schemaVersion: 1,
      template: 'auto-prediction',
      repository: 'https://github.com/TraderAlice/Auto-Prediction.git',
      version: 'v0.1.2',
      commit: 'd6c9447cab29898a6eb5fa06be3598b8474cc02f',
    },
    sessions: [],
    agentOverride: { claude: false, codex: false, opencode: false, pi: false },
  },
  {
    id: DEMO_MACRO_WORKSPACE_ID,
    tag: 'macro-research',
    displayName: 'Macro Research',
    dir: '/demo/workspaces/macro-research',
    createdAt: new Date().toISOString(),
    sessions: [],
    agentOverride: { claude: false, codex: false, opencode: false, pi: false },
  },
]

export const demoWorkspaces: Workspace[] = [
  demoWorkspace,
  demoChatWorkspace,
  ...demoIssueWorkspaces,
]

// Templates — names + metadata mirror the real template at
// src/workspaces/templates/chat/template.json. The name matters: the Chat /
// Workspaces sidebars filter on the literal 'chat' template name.
export const chatTemplate: TemplateInfo = {
  name: 'chat',
  displayName: 'Chat',
  description:
    "General-purpose Alice workspace — Alice's full tool surface (market/research data + trading) via the alice*/traderhub CLIs on PATH.",
  groupOrder: 10,
  defaultAgents: ['pi'],
  version: '0.2.0',
  hasReadme: false,
}

export const autoQuantTemplate: TemplateInfo = {
  name: 'auto-quant-v2',
  displayName: 'AutoQuant',
  description: 'Agent-native quantitative research desk pinned to an approved AutoQuant V2 release.',
  groupOrder: 20,
  defaultAgents: ['codex', 'claude'],
  version: '1.1.5',
  hasReadme: true,
  source: {
    repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
    defaultVersion: 'v0.9.34',
    versions: [
      {
        version: 'v0.9.34',
        commit: '52d63148d826e6c35d48c3167d95a4cc7a4eb6c4',
      },
      {
        version: 'v0.9.32',
        commit: '6ad644fe33d194e4ce112f2b07d164f3bf769f90',
      },
      {
        version: 'v0.9.31',
        commit: 'adc6363a7af5a9105811735973d4d5cfac58cf36',
      },
      {
        version: 'v0.8.31',
        commit: '426d815b18450172fbcf4c6b6af77c6ae05a4967',
      },
      {
        version: 'v0.8.30',
        commit: 'cba95f8718e8396a3147a9cc5f5275cd44feae5f',
      },
      {
        version: 'v0.8.27',
        commit: '4bf9eb45763776ab5fc2e02829b804594fc377a3',
      },
    ],
  },
}

export const autoPredictionTemplate: TemplateInfo = {
  name: 'auto-prediction',
  displayName: 'Auto Prediction',
  description: 'Agent-native prediction-market research desk pinned to an approved Auto Prediction source snapshot.',
  groupOrder: 30,
  defaultAgents: ['codex', 'claude'],
  version: '0.1.2',
  hasReadme: true,
  source: {
    repository: 'https://github.com/TraderAlice/Auto-Prediction.git',
    defaultVersion: 'v0.1.2',
    versions: [
      {
        version: 'v0.1.2',
        commit: 'd6c9447cab29898a6eb5fa06be3598b8474cc02f',
      },
      {
        version: 'v0.1.1',
        commit: 'db49d9dde1386fe3f0f8e7b7c78aa3810b7438b9',
      },
      {
        version: 'snapshot-194e0c9',
        commit: '194e0c97f9c4c0c97e0447b8b8861d36f3f71b36',
      },
      {
        version: 'snapshot-26f3ae2',
        commit: '26f3ae2d617e115850cff6fe047f6fb54c979d20',
      },
    ],
  },
}

export const demoTemplates: TemplateInfo[] = [chatTemplate, autoQuantTemplate, autoPredictionTemplate]

// Back-compat singleton for older callers (other fixture files reference
// `demoTemplate` and we want a stable name). Points at the flagship.
export const demoTemplate: TemplateInfo = chatTemplate
