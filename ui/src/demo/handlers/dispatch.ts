import { http, HttpResponse } from 'msw'

import type { DispatchBoardSnapshot } from '../../api/dispatch'
import {
  DEMO_AUTO_PREDICTION_WORKSPACE_ID,
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_WORKSPACE_ID,
} from '../fixtures/workspaces'

function buildDemoDispatchSnapshot(fromParam?: string | null, toParam?: string | null): DispatchBoardSnapshot {
  const nowMs = Date.now()
  const parsedTo = toParam ? Number(toParam) : Number.NaN
  const parsedFrom = fromParam ? Number(fromParam) : Number.NaN
  const toMs = Number.isFinite(parsedTo) && parsedTo > 0 ? parsedTo : nowMs
  const fromMs = Number.isFinite(parsedFrom) && parsedFrom > 0 && parsedFrom < toMs
    ? parsedFrom
    : toMs - 60 * 60_000
  const span = toMs - fromMs

  const t = (frac: number) => Math.round(fromMs + span * frac)

  const coordStart = t(0.12)
  const workerStart = t(0.22)
  const workerAskAt = t(0.38)
  const coordReplyAt = t(0.45)
  const workerEnd = t(0.64)
  const coordEnd = t(0.74)

  const schedStart = t(0.32)
  const schedEnd = t(0.55)

  const predStart = t(0.68)
  const predEnd = t(0.82)

  return {
    fromMs,
    toMs,
    generatedAt: nowMs,
    lanes: [
      {
        workspaceId: DEMO_CHAT_WORKSPACE_ID,
        tag: 'chat-may26',
        label: 'Chat',
        template: 'chat',
        templateKind: 'chat',
      },
      {
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        tag: 'auto-quant-main',
        label: 'Auto Quant',
        template: 'auto-quant-v2',
        templateKind: 'auto-quant',
      },
      {
        workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
        tag: 'auto-prediction-main',
        label: 'Auto Prediction',
        template: 'auto-prediction',
        templateKind: 'prediction',
      },
    ],
    spans: [
      {
        id: 'demo-span-coord',
        kind: 'interactive',
        workspaceId: DEMO_CHAT_WORKSPACE_ID,
        resumeId: DEMO_CHAT_RESUME_ID,
        sessionLabel: 'Portfolio Coordinator',
        agent: 'claude',
        status: 'done',
        startedAt: coordStart,
        finishedAt: coordEnd,
        durationMs: coordEnd - coordStart,
        trigger: { kind: 'interactive', surface: 'webpi' },
        assistantPreview: 'Compiled the volatility attribution report and pushed the summary to Inbox.',
        toolCalls: 5,
        toolFailures: 0,
      },
      {
        id: 'demo-span-worker',
        kind: 'headless',
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        resumeId: 'demo-resume-quant-worker',
        sessionLabel: 'Quant Backtester',
        agent: 'codex',
        model: 'gpt-5.3-codex',
        status: 'done',
        startedAt: workerStart,
        finishedAt: workerEnd,
        durationMs: workerEnd - workerStart,
        trigger: {
          kind: 'orchestration',
          dispatchId: 'demo-dsp-1',
          parentWorkspaceId: DEMO_CHAT_WORKSPACE_ID,
          parentResumeId: DEMO_CHAT_RESUME_ID,
        },
        prompt: 'Compute implied volatility skew across QQQ 30d/60d tenors and deliver a concise markdown memo.',
        assistantPreview: 'Completed IV skew decomposition across 30d and 60d chains.',
        toolCalls: 8,
        toolFailures: 0,
      },
      {
        id: 'demo-span-sched',
        kind: 'headless',
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        resumeId: 'demo-resume-quant-sched',
        sessionLabel: 'Morning Scan',
        agent: 'claude',
        model: 'claude-sonnet-4-6',
        status: 'done',
        startedAt: schedStart,
        finishedAt: schedEnd,
        durationMs: schedEnd - schedStart,
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
          issueId: 'morning-scan',
          issueTitle: 'Morning cross-asset scan',
        },
        prompt: 'Check overnight futures, macro rates, and active positions; publish a morning briefing to Inbox.',
        assistantPreview: 'Published morning briefing with rates and equity breadth summary.',
        toolCalls: 6,
        toolFailures: 0,
      },
      {
        id: 'demo-span-pred',
        kind: 'headless',
        workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
        resumeId: 'demo-resume-pred-live',
        sessionLabel: 'Odds Watcher',
        agent: 'claude',
        status: 'running',
        startedAt: predStart,
        finishedAt: null,
        durationMs: toMs - predStart,
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
          issueId: 'odds-watch',
          issueTitle: 'Macro probability divergence check',
        },
        prompt: 'Compare Polymarket macro contract pricing against Treasury yields and alert on divergences > 4%.',
        toolCalls: 2,
        toolFailures: 0,
      },
      {
        id: 'demo-span-pred-prev',
        kind: 'headless',
        workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
        resumeId: 'demo-resume-pred-err',
        sessionLabel: 'Odds Watcher',
        agent: 'claude',
        status: 'failed',
        startedAt: t(0.08),
        finishedAt: t(0.15),
        durationMs: t(0.15) - t(0.08),
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
          issueId: 'odds-watch',
          issueTitle: 'Macro probability divergence check',
        },
        prompt: 'Compare Polymarket macro contract pricing against Treasury yields.',
        toolCalls: 1,
        toolFailures: 1,
        error: 'Upstream quote snapshot timed out after 30s',
      },
    ],
    edges: [
      {
        id: 'demo-edge-dispatch',
        kind: 'dispatch',
        fromWorkspaceId: DEMO_CHAT_WORKSPACE_ID,
        fromResumeId: DEMO_CHAT_RESUME_ID,
        toWorkspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        toResumeId: 'demo-resume-quant-worker',
        at: workerStart,
        taskId: 'demo-task-1',
        dispatchId: 'demo-dsp-1',
        taskStatus: 'done',
        turnCount: 2,
        spec: 'Compute implied volatility skew across QQQ 30d/60d tenors and deliver a concise markdown memo.',
        outcome: 'completed',
        summary: 'IV skew memo delivered with 30d/60d term structure table.',
        deliverables: [
          { path: 'reports/qqq-iv-skew.md', summary: 'QQQ 30d/60d IV skew memo' },
        ],
      },
      {
        id: 'demo-edge-question',
        kind: 'question',
        fromWorkspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        fromResumeId: 'demo-resume-quant-worker',
        toWorkspaceId: DEMO_CHAT_WORKSPACE_ID,
        toResumeId: DEMO_CHAT_RESUME_ID,
        at: workerAskAt,
        taskId: 'demo-task-1',
        dispatchId: 'demo-dsp-1',
        deliveryStatus: 'acked',
        leasedAt: workerAskAt + 1_200,
        ackedAt: coordReplyAt,
        subject: 'Include 10-delta wings?',
        body: 'Should I decompose 10-delta put/call wings separately from 25-delta risk reversals?',
      },
      {
        id: 'demo-edge-reply',
        kind: 'reply',
        fromWorkspaceId: DEMO_CHAT_WORKSPACE_ID,
        fromResumeId: DEMO_CHAT_RESUME_ID,
        toWorkspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        toResumeId: 'demo-resume-quant-worker',
        at: coordReplyAt,
        taskId: 'demo-task-1',
        dispatchId: 'demo-dsp-1',
        deliveryStatus: 'acked',
        leasedAt: coordReplyAt + 800,
        ackedAt: coordReplyAt + 2_500,
        body: 'Yes — include both 25-delta and 10-delta wings so tail steepening is visible.',
      },
      {
        id: 'demo-edge-done',
        kind: 'worker_done',
        fromWorkspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        fromResumeId: 'demo-resume-quant-worker',
        toWorkspaceId: DEMO_CHAT_WORKSPACE_ID,
        toResumeId: DEMO_CHAT_RESUME_ID,
        at: workerEnd,
        taskId: 'demo-task-1',
        dispatchId: 'demo-dsp-1',
        deliveryStatus: 'acked',
        leasedAt: workerEnd + 900,
        ackedAt: workerEnd + 3_000,
        subject: 'IV skew memo complete',
        body: 'Completed QQQ 30d/60d skew analysis. Put skew steepened +1.8 vols week-over-week.',
        metadata: {
          outcome: 'completed',
          deliverables: [{ path: 'reports/qqq-iv-skew.md', summary: 'QQQ 30d/60d IV skew memo' }],
        },
      },
    ],
    artifacts: [
      {
        id: 'demo-art-report-worker',
        kind: 'report',
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        at: workerEnd,
        path: 'reports/qqq-iv-skew.md',
        action: 'delivered',
        summary: 'QQQ 30d/60d IV skew memo',
        runId: 'demo-span-worker',
        resumeId: 'demo-resume-quant-worker',
      },
      {
        id: 'demo-art-inbox-sched',
        kind: 'inbox',
        entryId: 'demo-inbox-headless-session',
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        at: schedEnd,
        title: 'Morning Cross-Asset Briefing',
        body: '# Morning Cross-Asset Briefing\n\n- S&P 500 breadth narrowed while 2Y yields rose 4 bps.\n- See [[reports/morning-scan.md]] for sector internals.',
        files: ['reports/morning-scan.md'],
        unread: true,
        runId: 'demo-span-sched',
        resumeId: 'demo-resume-quant-sched',
        issueId: 'morning-scan',
      },
      {
        id: 'demo-art-inbox-coord',
        kind: 'inbox',
        entryId: 'demo-inbox-aapl-q1',
        workspaceId: DEMO_CHAT_WORKSPACE_ID,
        at: coordEnd,
        title: 'Volatility Attribution Ready',
        body: '# Volatility Attribution Ready\n\nWorker completed the QQQ 30d/60d IV skew check; put wing premium expanded +1.8 vols.',
        files: [],
        unread: false,
        runId: 'demo-span-coord',
        resumeId: DEMO_CHAT_RESUME_ID,
      },
    ],
    scheduleMarkers: [
      {
        workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        issueId: 'morning-scan',
        title: 'Morning cross-asset scan',
        lastFiredAtMs: schedStart,
        nextDueAtMs: toMs + 18 * 60_000,
      },
      {
        workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
        issueId: 'odds-watch',
        title: 'Macro probability divergence check',
        lastFiredAtMs: predStart,
        nextDueAtMs: toMs + 12 * 60_000,
      },
    ],
    summary: {
      activeWorkspaceCount: 3,
      runningSpanCount: 1,
      totalSpanCount: 5,
      edgeCount: 4,
      artifactCount: 3,
      errorSpanCount: 1,
    },
  }
}

export const dispatchHandlers = [
  http.get('/api/dispatch', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(
      buildDemoDispatchSnapshot(url.searchParams.get('from'), url.searchParams.get('to')),
    )
  }),
]
