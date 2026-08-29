import { http, HttpResponse } from 'msw'

import {
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
} from '../fixtures/workspaces'

const now = Date.now()
let demoSonnerSeq = 6
const demoSonnerEvents: Array<Record<string, unknown>> = []

export const agentRuntimeHandlers = [
  http.get('/api/agent-runtime', () => HttpResponse.json({
    lastSeq: demoSonnerSeq,
    page: 1,
    pageSize: 50,
    total: 6 + demoSonnerEvents.length,
    totalPages: 1,
    entries: [
      ...demoSonnerEvents,
      {
        seq: 6,
        ts: now - 12_000,
        type: 'runtime.stopped',
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          status: 'done',
          assistantText: 'The desk is clear. Ready for the next ask.',
          metrics: { textBlocks: 2, toolCalls: 1, toolFailures: 0 },
        },
      },
      {
        seq: 5,
        ts: now - 18_000,
        type: 'runtime.turn.text',
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          text: 'The desk is clear. Ready for the next ask.',
        },
      },
      {
        seq: 4,
        ts: now - 40_000,
        type: 'runtime.turn.tool',
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          toolId: 'call-1',
          toolName: 'workspace_list',
          toolStatus: 'completed',
        },
      },
      {
        seq: 3,
        ts: now - 50_000,
        type: 'runtime.turn.tool',
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          toolId: 'call-1',
          toolName: 'workspace_list',
          toolStatus: 'running',
        },
      },
      {
        seq: 2,
        ts: now - 96_000,
        type: 'runtime.started',
        causedBy: 1,
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          cause: {
            kind: 'conversation',
            from: { kind: 'session', workspaceId: DEMO_CHAT_WORKSPACE_ID, resumeId: 'resume-caller', agent: 'pi' },
            resolution: 'exact',
          },
        },
      },
      {
        seq: 1,
        ts: now - 97_000,
        type: 'session.born',
        payload: {
          workspaceId: DEMO_CHAT_WORKSPACE_ID,
          resumeId: DEMO_CHAT_RESUME_ID,
          agent: 'codex',
          sessionRecordId: DEMO_CHAT_SESSION_ID,
        },
      },
    ],
  })),
  http.post('/api/agent-runtime/sonner-test', async ({ request }) => {
    const body = await request.json() as { state?: 'running' | 'success' | 'error' }
    const state = body.state
    if (!state || !['running', 'success', 'error'].includes(state)) {
      return HttpResponse.json({ error: 'invalid state' }, { status: 400 })
    }
    demoSonnerSeq += 1
    const entry = {
      seq: demoSonnerSeq,
      ts: Date.now(),
      type: 'dev.sonner_test',
      payload: {
        workspaceId: '__dev__',
        resumeId: `sonner-test-${demoSonnerSeq}`,
        agent: 'Dev Panel',
        testState: state,
        message: `Sonner ${state} test`,
      },
    }
    demoSonnerEvents.unshift(entry)
    return HttpResponse.json({ entry }, { status: 201 })
  }),
]
