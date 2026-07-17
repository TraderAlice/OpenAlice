import { http, HttpResponse } from 'msw'

import type { HeadlessOutput, HeadlessTaskRecord } from '../../api/headless'

const now = Date.now()
const demoHeadlessTasks: HeadlessTaskRecord[] = [
  {
    taskId: 'demo-headless-1',
    resumeId: 'demo-resume-1',
    resumable: true,
    wsId: 'demo-ws',
    agent: 'codex',
    prompt: 'Compute a quant snapshot of NVDA and push a report to the inbox.',
    status: 'done',
    startedAt: now - 92_000,
    finishedAt: now - 20_000,
    durationMs: 72_000,
    exitCode: 0,
  },
  {
    taskId: 'demo-headless-2',
    resumeId: 'demo-resume-2',
    resumable: false,
    wsId: 'demo-chat',
    agent: 'claude',
    prompt: "Summarize today's AI-sector headlines and flag anything actionable.",
    status: 'running',
    startedAt: now - 6_000,
  },
  {
    taskId: 'demo-headless-3',
    resumeId: 'demo-resume-3',
    resumable: false,
    wsId: 'demo-ws',
    agent: 'pi',
    prompt: 'Refresh the uranium watchlist and note any breakouts.',
    status: 'interrupted',
    startedAt: now - 3_600_000,
    finishedAt: now - 3_600_000,
  },
]

const demoOutput = (taskId: string): HeadlessOutput | null => {
  const t = demoHeadlessTasks.find((x) => x.taskId === taskId)
  if (!t) return null
  const lines = [
    `{"type":"thread.started","thread_id":"demo-native"}`,
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"Report pushed to the inbox."}}',
  ]
  const text = lines.join('\n') + '\n'
  return {
    taskId,
    status: t.status,
    structured: {
      schemaVersion: 1,
      assistantText: 'Report pushed to the inbox.',
      blocks: [
        { type: 'tool', id: 'tool-1', name: 'alice analysis', status: 'completed', input: { symbol: 'NVDA' }, output: 'snapshot ready' },
        { type: 'text', text: 'Report pushed to the inbox.' },
      ],
      metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
      truncated: false,
    },
    stdout: { text, sizeBytes: text.length, truncated: false },
    stderr: null,
  }
}

const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')
  ?? (request.referrer ? new URL(request.referrer).searchParams.get('themeAuditFixture') : null)
const auditRefreshCounts = new Map<string, number>()

const failedAuditTask: HeadlessTaskRecord = {
  taskId: 'audit-headless-failed', resumeId: 'audit-resume-failed', resumable: true,
  wsId: 'demo-ws', agent: 'codex', prompt: 'Audit failed automation output', status: 'failed',
  startedAt: now - 60_000, finishedAt: now - 30_000, durationMs: 30_000, exitCode: 1,
  error: 'Broker validation failed',
}

const failedAuditOutput: HeadlessOutput = {
  taskId: failedAuditTask.taskId, status: failedAuditTask.status,
  structured: {
    schemaVersion: 1, assistantText: '', truncated: true,
    blocks: [
      { type: 'tool', id: 'audit-tool-failed', name: 'alice push', status: 'failed', input: { symbol: 'NVDA' }, output: 'rejected' },
      { type: 'tool', id: 'audit-tool-running', name: 'alice retry', status: 'running', input: {}, output: undefined },
      { type: 'error', message: 'Broker validation failed' },
    ],
    metrics: { textBlocks: 0, toolCalls: 2, toolFailures: 1 },
  },
  stdout: { text: 'audit stdout', sizeBytes: 12, truncated: true },
  stderr: { text: 'audit stderr', sizeBytes: 12, truncated: false },
}

export const headlessHandlers = [
  http.get('/api/headless', async ({ request }) => {
    const fixture = auditFixture(request)
    if (fixture === 'automation-loading') await new Promise((resolve) => setTimeout(resolve, 3_000))
    if (fixture === 'automation-list-error') return HttpResponse.json({ error: 'audit_list_failure' }, { status: 500 })
    if (fixture === 'automation-refresh-error') {
      const run = request.headers.get('x-openalice-theme-audit-run') ?? 'unknown'
      const count = auditRefreshCounts.get(run) ?? 0
      auditRefreshCounts.set(run, count + 1)
      if (count > 0) return HttpResponse.json({ error: 'audit_refresh_failure' }, { status: 500 })
    }
    if (fixture === 'automation-run-failed') return HttpResponse.json({
      tasks: [failedAuditTask], page: { total: 1, hasMore: false, nextCursor: null },
      summary: { done: 0, needsAttention: 1 }, capacity: { running: 0, limit: 8 },
    })
    const wsId = new URL(request.url).searchParams.get('wsId')
    const tasks = wsId ? demoHeadlessTasks.filter((t) => t.wsId === wsId) : demoHeadlessTasks
    return HttpResponse.json({
      tasks,
      page: { total: tasks.length, hasMore: false, nextCursor: null },
      summary: {
        done: tasks.filter((task) => task.status === 'done').length,
        needsAttention: tasks.filter((task) => task.status === 'failed' || task.status === 'interrupted').length,
      },
      capacity: { running: tasks.filter((task) => task.status === 'running').length, limit: 8 },
    })
  }),
  // Path-specific route BEFORE the :taskId catch-all (msw matches in order).
  http.get('/api/headless/:taskId/output', ({ params, request }) => {
    if (auditFixture(request) === 'automation-output-error' && params.taskId === 'demo-headless-1') {
      return HttpResponse.json({ error: 'audit_output_failure' }, { status: 500 })
    }
    if (auditFixture(request) === 'automation-run-failed' && params.taskId === failedAuditTask.taskId) return HttpResponse.json(failedAuditOutput)
    const out = demoOutput(String(params.taskId))
    return out ? HttpResponse.json(out) : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
  http.get('/api/headless/:taskId', ({ params }) => {
    const t = demoHeadlessTasks.find((x) => x.taskId === params.taskId)
    return t ? HttpResponse.json(t) : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
]
