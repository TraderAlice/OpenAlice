import { http, HttpResponse } from 'msw'

import {
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
} from '../fixtures/workspaces'

export const officeHandlers = [
  http.get('/api/office/floor', ({ request }) => {
    const asOfRaw = new URL(request.url).searchParams.get('asOfSeq')
    const asOfSeq = asOfRaw == null ? undefined : Number.parseInt(asOfRaw, 10)
    const working = asOfSeq == null || asOfSeq >= 4
    const now = Date.now()
    return HttpResponse.json({
      config: {
        workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
      },
      lastSeq: 6,
      firstSeq: 1,
      ...(asOfSeq != null ? { asOfSeq } : {}),
      offices: [
        {
          workspace: { id: DEMO_CHAT_WORKSPACE_ID, tag: 'chat', harness: 'chat' },
          lastInteractionAt: now,
          sleeping: false,
          employees: demoChatWorkspace.sessions.map((session, index) => ({
            resumeId: session.resumeId,
            agent: session.agent,
            name: session.name,
            title: session.title,
            sessionRecordId: session.id,
            mood: working && session.state === 'running' ? 'working' : 'idle',
            ...(session.surface ? { surface: session.surface } : {}),
            bubble: working && session.state === 'running'
              ? { kind: 'tool' as const, name: index === 0 ? 'workspace_list' : 'research' }
              : null,
            lastSeq: working && session.state === 'running' ? 4 : 2,
            lastInteractionAt: Date.parse(session.lastActiveAt),
            drawers: index === 0 ? [{
              id: 'prov-demo',
              kind: 'report' as const,
              action: 'created',
              at: Date.now() - 60_000,
              label: 'ai-chain-2026-06-02.md',
              path: 'rotation/ai-chain-2026-06-02.md',
            }] : [],
          })),
        },
        {
          workspace: { id: DEMO_AUTO_QUANT_WORKSPACE_ID, tag: 'auto-quant', harness: 'auto-quant' },
          lastInteractionAt: now,
          sleeping: false,
          employees: [],
        },
      ],
    })
  }),
]
