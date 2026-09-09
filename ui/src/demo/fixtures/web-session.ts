import type {
  WebConversationMessage,
  WebPermissionRequest,
  WebSessionSnapshot,
  WebSessionWire,
  WebSurfaceCapability,
} from '../../components/workspace/api'
import {
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  DEMO_SESSION_ID,
  DEMO_WORKSPACE_ID,
} from './workspaces'

/**
 * Web surface capability per demo runtime. Mirrors the adapter declarations
 * in src/workspaces/adapters so the demo gates the same buttons production
 * does. Antigravity has no structured protocol and therefore stays TUI-only.
 */
export const demoWebCapabilities: Readonly<Record<string, WebSurfaceCapability>> = {
  claude: { wire: 'claude-stream-json', permissionPrompts: true, freshSession: true },
  codex: { wire: 'codex-app-server', permissionPrompts: true, freshSession: true },
  cursor: { wire: 'acp', permissionPrompts: true, freshSession: true },
  grok: { wire: 'acp', permissionPrompts: true, freshSession: true },
  omp: { wire: 'pi-rpc', permissionPrompts: false, freshSession: true },
  opencode: { wire: 'acp', permissionPrompts: true, freshSession: true },
  pi: { wire: 'pi-rpc', permissionPrompts: false, freshSession: true },
}

export function demoWebWire(agent: string): WebSessionWire {
  return demoWebCapabilities[agent]?.wire ?? 'pi-rpc'
}

export interface DemoWebSeed {
  readonly wsId: string
  readonly sessionId: string
  readonly resumeId: string
  readonly agent: string
  readonly startedAt: number
  readonly messages: readonly WebConversationMessage[]
}

const aaplResearchMessages: readonly WebConversationMessage[] = [
  {
    role: 'user',
    content: "Hey, what jumped out from Apple's Q1 earnings?",
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'I should compare the quarter with the recent trend instead of repeating the headline EPS result.',
      },
      {
        type: 'toolCall',
        id: 'aapl-filings',
        name: 'read',
        arguments: { path: 'data/sec/aapl/10-Q-Q1-2026.json' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'aapl-filings',
    toolName: 'read',
    isError: false,
    content: 'Services revenue YoY: Q2 +16.3%, Q3 +14.2%, Q4 +12.0%, Q1 +9.1%. Services gross margin remains the company margin anchor.',
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'The useful signal is the three-quarter deceleration. I should preserve the evidence and make the threshold explicit.',
      },
      {
        type: 'text',
        text: 'The headline beat looks fine, but the Services trend is more interesting. I’m writing the comparison into the Workspace so it remains reviewable.',
      },
      {
        type: 'toolCall',
        id: 'aapl-report',
        name: 'write',
        arguments: { path: 'research/AAPL-q1-hidden-deceleration.md' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'aapl-report',
    toolName: 'write',
    isError: false,
    content: 'Wrote research/AAPL-q1-hidden-deceleration.md',
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: 'aapl-inbox',
        name: 'bash',
        arguments: {
          command: 'alice inbox push --doc research/AAPL-q1-hidden-deceleration.md',
        },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'aapl-inbox',
    toolName: 'bash',
    isError: false,
    content: 'Inbox entry created: AAPL Q1 — Hidden Deceleration Signal',
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: [
          'The thing I would watch is **Services growth decelerating for a third consecutive quarter**:',
          '',
          '| Quarter | Services YoY |',
          '| --- | ---: |',
          '| Q2 FY25 | +16.3% |',
          '| Q3 FY25 | +14.2% |',
          '| Q4 FY25 | +12.0% |',
          '| Q1 FY26 | **+9.1%** |',
          '',
          'Services is still the margin anchor, so a move below roughly **8%** would weaken the SaaS-like multiple argument. I saved the full note and posted it to Inbox.',
        ].join('\n'),
      },
    ],
  },
]

const semiconductorMessages: readonly WebConversationMessage[] = [
  {
    role: 'user',
    content: "What's moving in semiconductors today?",
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'I need a cross-check between price leadership, the supply chain, and the latest desk notes before calling a move durable.',
      },
      {
        type: 'toolCall',
        id: 'semis-board',
        name: 'bash',
        arguments: { command: 'traderhub board get --board movers' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'semis-board',
    toolName: 'bash',
    isError: false,
    content: 'Semiconductor snapshot: memory and foundry suppliers are leading; broad-market participation is mixed. Recorded demo data, not a live quote.',
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'The move is concentrated enough that the catalyst map matters more than the index-level percentage.',
      },
      {
        type: 'toolCall',
        id: 'semis-notes',
        name: 'read',
        arguments: { path: 'research/semiconductor-monitor.md' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'semis-notes',
    toolName: 'read',
    isError: false,
    content: 'Desk notes: HBM supply remains the near-term bottleneck; advanced packaging lead times are improving slowly; foundry utilization is the next confirmation point.',
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: [
          'The move is **narrower than the headline suggests**. The recorded snapshot points to three things:',
          '',
          '- **Memory/HBM is leading** — the clearest expression of AI accelerator demand.',
          '- **Advanced packaging is still the bottleneck**, although lead times are improving.',
          '- **Foundry utilization is the confirmation signal**; without it, this is supplier rotation rather than a full-cycle acceleration.',
          '',
          'I’d watch whether leadership broadens into equipment and foundry names before treating it as a durable sector breakout.',
        ].join('\n'),
      },
    ],
  },
]

export const demoWebSeeds: readonly DemoWebSeed[] = [
  {
    wsId: DEMO_WORKSPACE_ID,
    sessionId: DEMO_SESSION_ID,
    resumeId: 'demo-resume-main',
    agent: 'pi',
    startedAt: Date.now() - 8 * 60_000,
    messages: aaplResearchMessages,
  },
  {
    wsId: DEMO_CHAT_WORKSPACE_ID,
    sessionId: DEMO_CHAT_SESSION_ID,
    resumeId: 'demo-resume-chat',
    agent: 'pi',
    startedAt: Date.now() - 4 * 60_000,
    messages: semiconductorMessages,
  },
]

export function createDemoWebSnapshot(seed: DemoWebSeed): WebSessionSnapshot {
  return {
    recordId: seed.sessionId,
    wsId: seed.wsId,
    resumeId: seed.resumeId,
    agent: seed.agent,
    wire: demoWebWire(seed.agent),
    nativeSessionId: `demo-native-${seed.sessionId}`,
    pid: 0,
    startedAt: seed.startedAt,
    phase: 'idle',
    messages: structuredClone(seed.messages),
    streamingMessage: null,
    requests: [],
    error: null,
    stderrTail: '',
    revision: seed.messages.length,
  }
}

const DEMO_REQUEST_FILE = 'research/positioning-notes.md'

/**
 * Runtimes with per-tool prompts stop and ask before reading the Workspace.
 * The demo reproduces that pause so visitors see the request card exactly as
 * a live Claude/Codex/ACP session would present it.
 */
export function demoWebPermissionRequest(agent: string, requestId: string): WebPermissionRequest {
  const wire = demoWebWire(agent)
  return {
    id: requestId,
    kind: 'permission',
    title: `Allow ${wire === 'codex-app-server' ? 'reading' : 'read access to'} ${DEMO_REQUEST_FILE}?`,
    description: 'The agent wants to check the desk notes before answering. Recorded demo: no file is read.',
    tool: { name: 'read', input: { path: DEMO_REQUEST_FILE } },
    options: wire === 'acp'
      ? [
          { id: 'allow_once', label: 'Allow once', tone: 'allow' },
          { id: 'allow_always', label: 'Always allow', tone: 'allow' },
          { id: 'reject_once', label: 'Reject', tone: 'deny' },
        ]
      : [
          { id: 'allow', label: 'Allow', tone: 'allow' },
          { id: 'deny', label: 'Deny', tone: 'deny' },
        ],
    createdAt: Date.now(),
  }
}

/** The in-flight assistant message while a permission request is pending. */
export function demoWebPendingToolCall(requestId: string): WebConversationMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'The desk notes should settle this faster than re-deriving the positioning from scratch.' },
      { type: 'toolCall', id: requestId, name: 'read', arguments: { path: DEMO_REQUEST_FILE } },
    ],
  }
}

export function demoWebPermissionOutcome(
  agent: string,
  requestId: string,
  allowed: boolean,
): readonly WebConversationMessage[] {
  const label = demoRuntimeLabel(agent)
  if (!allowed) {
    return [
      demoWebPendingToolCall(requestId),
      {
        role: 'toolResult',
        toolCallId: requestId,
        toolName: 'read',
        isError: true,
        content: 'Permission denied by the user.',
      },
      {
        role: 'assistant',
        content: [{
          type: 'text',
          text: `Understood — I won’t read ${DEMO_REQUEST_FILE}. This public preview of ${label} in the Web surface does not call a live model, so this reply is simulated; install OpenAlice locally to continue with your own runtime.`,
        }],
      },
    ]
  }
  return [
    demoWebPendingToolCall(requestId),
    {
      role: 'toolResult',
      toolCallId: requestId,
      toolName: 'read',
      isError: false,
      content: 'Desk notes: net long semis, hedged with index puts; review threshold is a two-day close below the 20-day average.',
    },
    {
      role: 'assistant',
      content: [{
        type: 'text',
        text: `Thanks. The desk is **net long semis with an index-put hedge**, and the review trigger is a two-day close below the 20-day average. This is the real **Web conversation surface** for ${label} backed by recorded demo data; the public preview does not call a live model, so this reply is simulated.`,
      }],
    },
  ]
}

export function demoWebFollowUp(agent: string, message: string): readonly WebConversationMessage[] {
  const label = demoRuntimeLabel(agent)
  return [
    { role: 'user', content: message },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'This public preview keeps the runtime’s native conversation shape, but it must not imply that a live model or trading service was called.',
        },
        {
          type: 'text',
          text: `This is the real **Web conversation surface** for ${label} backed by recorded demo data. The public preview does not call a live model, so this reply is simulated; install OpenAlice locally to continue the research with your own runtime and data sources.`,
        },
      ],
    },
  ]
}

function demoRuntimeLabel(agent: string): string {
  switch (agent) {
    case 'claude': return 'Claude Code'
    case 'codex': return 'Codex'
    case 'cursor': return 'Cursor Agent'
    case 'grok': return 'Grok Build'
    case 'omp': return 'Oh My Pi'
    case 'opencode': return 'opencode'
    case 'pi': return 'Pi'
    default: return agent
  }
}
