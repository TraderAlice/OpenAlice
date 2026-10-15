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
  // Isolated mock-only journey. Never reaches a production runtime or Inbox store.
  http.post('/api/demo/notification-lifecycle', async ({ request }) => {
    const body = await request.json() as { state?: string; taskId?: string }
    if (!body.state || !['running', 'success', 'failure', 'inbox', 'paused', 'interrupted', 'rejected', 'recoverable'].includes(body.state)) {
      return HttpResponse.json({ error: 'invalid demo state' }, { status: 400 })
    }
    demoSonnerSeq += 1
    const entry = {
      seq: demoSonnerSeq, ts: Date.now(),
      type: body.state === 'running' ? 'runtime.started' : body.state === 'inbox' ? 'inbox.received'
        : body.state === 'rejected' ? 'runtime.rejected' : body.state === 'recoverable' ? 'runtime.turn.error' : 'runtime.stopped',
      payload: {
        workspaceId: DEMO_CHAT_WORKSPACE_ID, resumeId: DEMO_CHAT_RESUME_ID, sessionRecordId: DEMO_CHAT_SESSION_ID,
        agent: 'pi', taskId: body.taskId ?? 'demo-notification-task', surface: 'headless',
        cause: { kind: 'conversation', from: { kind: 'session', workspaceId: DEMO_CHAT_WORKSPACE_ID, resumeId: 'demo-caller', agent: 'codex' } },
        ...(body.state === 'success' ? { status: 'done' } : body.state === 'failure' ? { status: 'failed', error: 'Demo: runtime could not complete the request' }
          : body.state === 'paused' || body.state === 'interrupted' ? { status: body.state } : body.state === 'rejected' ? { reason: 'Demo: target is unavailable' }
            : body.state === 'recoverable' ? { message: 'Demo: tool retried successfully' } : body.state === 'inbox'
              ? { inboxEntryId: `demo-inbox-${demoSonnerSeq}`, originKind: 'headless', summary: 'Demo: the research report is ready.', documentCount: 1 } : {}),
      },
    }
    demoSonnerEvents.unshift(entry)
    return HttpResponse.json({ entry }, { status: 201 })
  }),
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
  http.post('/api/agent-runtime/product-test', async ({ request }) => {
    const body = await request.json() as { family?: 'inbox' | 'news'; preview?: 'image' | 'plain' | 'grouped' | 'broken' }
    if (!body.family || !['inbox', 'news'].includes(body.family)) {
      return HttpResponse.json({ error: 'invalid family' }, { status: 400 })
    }
    if (body.family === 'news' && body.preview) {
      const count = body.preview === 'grouped' ? 12 : 1
      const entries = Array.from({ length: count }, (_, index) => {
        demoSonnerSeq += 1
        const latest = body.preview === 'grouped' && index === count - 1
        const entry = {
          seq: demoSonnerSeq, ts: Date.now(), type: 'news.ingested',
          payload: {
            newsItemId: demoSonnerSeq, dedupKey: `demo:${demoSonnerSeq}`,
            title: body.preview === 'plain' ? 'Demo: Fed rate outlook remains data-dependent as inflation cools'
              : latest ? 'Demo: Timber prices steady as construction demand improves'
                : 'Demo: Berry exports rise as overseas demand recovers',
            source: 'Reuters (Demo)', publishedAt: Date.now(), ingestSource: 'demo',
            ...(body.preview === 'plain' ? {} : { image: body.preview === 'broken'
              ? '/demo/news/missing.jpg' : latest ? '/demo/news/larch.jpg' : '/demo/news/blueberries.jpg' }),
          },
        }
        demoSonnerEvents.unshift(entry)
        return entry
      })
      return HttpResponse.json({ entry: entries.at(-1) }, { status: 201 })
    }
    demoSonnerSeq += 1
    const entry = body.family === 'inbox'
      ? {
          seq: demoSonnerSeq,
          ts: Date.now(),
          type: 'inbox.received',
          payload: {
            workspaceId: '__dev__',
            workspaceLabel: 'Frontend lab',
            inboxEntryId: `inbox-test-${demoSonnerSeq}`,
            agent: 'Dev Panel',
            originKind: 'headless',
            summary: 'Product activity journal Inbox test',
            documentCount: 0,
          },
        }
      : {
          seq: demoSonnerSeq,
          ts: Date.now(),
          type: 'news.ingested',
          payload: {
            newsItemId: demoSonnerSeq,
            dedupKey: `dev:${demoSonnerSeq}`,
            title: 'Product activity journal News test',
            source: 'Frontend lab',
            publishedAt: Date.now(),
            ingestSource: 'dev',
          },
        }
    demoSonnerEvents.unshift(entry)
    return HttpResponse.json({ entry }, { status: 201 })
  }),
]
