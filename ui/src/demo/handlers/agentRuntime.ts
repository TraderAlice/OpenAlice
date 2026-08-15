import { http, HttpResponse } from 'msw'

const now = Date.now()

export const agentRuntimeHandlers = [
  http.get('/api/agent-runtime', () => HttpResponse.json({
    lastSeq: 6,
    page: 1,
    pageSize: 50,
    total: 6,
    totalPages: 1,
    entries: [
      {
        seq: 6,
        ts: now - 12_000,
        type: 'runtime.stopped',
        payload: {
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
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
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
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
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
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
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
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
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
          agent: 'codex',
          surface: 'headless',
          taskId: 'run-demo-quant',
          cause: {
            kind: 'conversation',
            from: { kind: 'session', workspaceId: 'chat-demo', resumeId: 'resume-caller', agent: 'pi' },
            resolution: 'exact',
          },
        },
      },
      {
        seq: 1,
        ts: now - 97_000,
        type: 'session.born',
        payload: {
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
          agent: 'codex',
          sessionRecordId: 'codex-demo-1',
        },
      },
    ],
  })),
]
