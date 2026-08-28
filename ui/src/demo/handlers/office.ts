import { http, HttpResponse } from 'msw'

import {
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
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
          employees: [
            {
              resumeId: DEMO_CHAT_RESUME_ID,
              agent: 'codex',
              name: 'c1',
              title: 'Desk mate',
              sessionRecordId: DEMO_CHAT_SESSION_ID,
              mood: working ? 'working' : 'idle',
              surface: 'headless',
              bubble: working ? { kind: 'tool', name: 'workspace_list' } : null,
              lastSeq: working ? 4 : 2,
              lastInteractionAt: now,
              drawers: [{
                id: 'prov-demo',
                kind: 'report',
                action: 'created',
                at: Date.now() - 60_000,
                label: 'ai-chain-2026-06-02.md',
                path: 'rotation/ai-chain-2026-06-02.md',
              }],
            },
          ],
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
