import { http, HttpResponse } from 'msw'

const now = Date.now()

export const agentConversationHandlers = [
  http.get('/api/agent-conversations', () => HttpResponse.json({
    entries: [
      {
        taskId: 'run-demo-quant',
        dispatchedAt: now - 96_000,
        completedAt: now - 42_000,
        status: 'done',
        source: {
          kind: 'session',
          workspaceId: 'chat-demo',
          resumeId: 'resume-chat-demo',
          agent: 'codex',
        },
        target: {
          workspaceId: 'auto-quant-demo',
          resumeId: 'resume-quant-demo',
          agent: 'codex',
        },
        requestedTarget: { kind: 'workspace', workspaceId: 'auto-quant-demo' },
        resolution: { mode: 'reconstructed', reason: 'explicit-workspace' },
        prompt: {
          original: '研究一下最近三个月黄金和美元实际利率的关系，给我一个可复现的结论。',
          delivered: '研究一下最近三个月黄金和美元实际利率的关系，给我一个可复现的结论。',
          mode: 'plain',
        },
        assistantText: '任务已完成。研究代码和报告已保存在 Workspace，并已推送摘要到 Inbox。',
        durationMs: 54_000,
      },
      {
        taskId: 'run-demo-reconstruction',
        dispatchedAt: now - 6 * 60_000,
        completedAt: now - 5 * 60_000,
        status: 'done',
        source: { kind: 'human' },
        target: {
          workspaceId: 'research-demo',
          resumeId: 'resume-research-demo',
          agent: 'pi',
        },
        requestedTarget: { kind: 'inbox', inboxEntryId: 'inbox-demo', workspaceId: 'research-demo' },
        resolution: { mode: 'reconstructed', reason: 'missing-origin' },
        prompt: {
          original: '这个结论当时为什么排除了 2020 年样本？',
          delivered: 'You are a reconstruction analyst. The original author is unavailable. Reconstruct the likely evidence and explicitly label uncertainty.\n\n这个结论当时为什么排除了 2020 年样本？',
          mode: 'reconstruction',
        },
        assistantText: '从仓库中的数据清洗脚本看，2020 年被作为结构突变期单独排除；这是一项重建判断。',
        durationMs: 41_000,
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  })),
]
