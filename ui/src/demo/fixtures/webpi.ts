import type { WebPiSnapshot } from '../../components/workspace/api'
import {
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  DEMO_SESSION_ID,
  DEMO_WORKSPACE_ID,
} from './workspaces'

export interface DemoWebPiSeed {
  readonly wsId: string
  readonly sessionId: string
  readonly resumeId: string
  readonly startedAt: number
  readonly messages: readonly unknown[]
}

const aaplResearchMessages: readonly unknown[] = [
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
          command: 'alice-workspace inbox push --doc research/AAPL-q1-hidden-deceleration.md',
        },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'aapl-inbox',
    toolName: 'bash',
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

const semiconductorMessages: readonly unknown[] = [
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

export const demoWebPiSeeds: readonly DemoWebPiSeed[] = [
  {
    wsId: DEMO_WORKSPACE_ID,
    sessionId: DEMO_SESSION_ID,
    resumeId: 'demo-resume-main',
    startedAt: Date.now() - 8 * 60_000,
    messages: aaplResearchMessages,
  },
  {
    wsId: DEMO_CHAT_WORKSPACE_ID,
    sessionId: DEMO_CHAT_SESSION_ID,
    resumeId: 'demo-resume-chat',
    startedAt: Date.now() - 4 * 60_000,
    messages: semiconductorMessages,
  },
]

export function createDemoWebPiSnapshot(seed: DemoWebPiSeed): WebPiSnapshot {
  return {
    recordId: seed.sessionId,
    wsId: seed.wsId,
    resumeId: seed.resumeId,
    pid: 0,
    startedAt: seed.startedAt,
    phase: 'idle',
    state: { isStreaming: false, isCompacting: false },
    messages: structuredClone(seed.messages),
    streamingMessage: null,
    error: null,
    stderrTail: '',
    revision: seed.messages.length,
  }
}

export function demoWebPiFollowUp(message: string): readonly unknown[] {
  return [
    { role: 'user', content: message },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'This public preview keeps Pi’s native conversation shape, but it must not imply that a live model or trading service was called.',
        },
        {
          type: 'text',
          text: 'This is the real **WebPi conversation surface** backed by recorded demo data. The public preview does not call a live model, so this reply is simulated; install OpenAlice locally to continue the research with your own Pi runtime and data sources.',
        },
      ],
    },
  ]
}
