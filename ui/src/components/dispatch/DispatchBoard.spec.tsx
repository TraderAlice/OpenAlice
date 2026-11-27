// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DispatchSpan } from '../../api/dispatch'
import type { DispatchBoardSnapshot } from './useDispatchBoard'
import type { IssueSnapshot } from '../../api/issues'
import { i18n } from '../../i18n'
import { IssuesBoard } from '../IssuesBoard'
import { DispatchToolbarControls } from './DispatchBoard'
import {
  buildDispatchEpisodes,
  clusterLaneSpans,
  collectConnectedTraceIds,
  formatTickTime,
  formatWindowRange,
  layoutEdgeGeometries,
  packSpansIntoTracks,
} from './layout'

const mocks = vi.hoisted(() => ({
  getDispatch: vi.fn<(opts?: { from?: number; to?: number }) => Promise<DispatchBoardSnapshot>>(),
  useIssues: vi.fn<() => { data: IssueSnapshot | null; error: string | null; loading: boolean; updateIssue: ReturnType<typeof vi.fn> }>(),
  useScheduleSnapshot: vi.fn(() => ({ snapshot: null, refresh: vi.fn().mockResolvedValue(undefined) })),
  openHeadlessRun: vi.fn().mockResolvedValue(undefined),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  selectInboxEntry: vi.fn(),
  markInboxRead: vi.fn(),
  updateIssue: vi.fn(),
}))

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      dispatch: {
        get: (opts?: { from?: number; to?: number }) => mocks.getDispatch(opts),
      },
    },
  }
})

vi.mock('../../hooks/useIssues', () => ({
  useIssues: () => mocks.useIssues(),
}))

vi.mock('../../hooks/useSchedules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useSchedules')>()
  return {
    ...actual,
    useScheduleSnapshot: () => mocks.useScheduleSnapshot(),
  }
})

vi.mock('../../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    agents: [
      { id: 'claude', displayName: 'Claude Code', kind: 'agent' },
      { id: 'codex', displayName: 'Codex', kind: 'agent' },
      { id: 'omp', displayName: 'OMP', kind: 'agent' },
    ],
    defaultAgent: 'claude',
    issueDefaultAgent: null,
    workspaces: [{ id: 'ws-chat' }, { id: 'ws-quant' }],
    openHeadlessRun: mocks.openHeadlessRun,
  }),
}))

vi.mock('../../contexts/workspace-actions-context', () => ({
  useWorkspaceActions: () => ({
    openHeadlessRun: mocks.openHeadlessRun,
  }),
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: unknown) => unknown) =>
    selector({
      openOrFocus: mocks.openOrFocus,
      setSidebar: mocks.setSidebar,
    }),
}))

vi.mock('../../live/inbox-selection', () => ({
  useInboxSelection: (selector: (state: unknown) => unknown) =>
    selector({ select: mocks.selectInboxEntry }),
}))

vi.mock('../../live/inbox-read', () => ({
  useInboxRead: (selector: (state: unknown) => unknown) =>
    selector({ markRead: mocks.markInboxRead }),
}))

const BASE = 1_700_000_000_000
const FROM = BASE - 3_600_000

function sampleSnapshot(): DispatchBoardSnapshot {
  return {
    fromMs: FROM,
    toMs: BASE,
    generatedAt: BASE,
    lanes: [
      { workspaceId: 'ws-chat', tag: 'chat-main', label: 'Chat', template: 'chat', templateKind: 'chat' },
      { workspaceId: 'ws-quant', tag: 'quant-main', label: 'Auto Quant', template: 'auto-quant-v2', templateKind: 'auto-quant' },
    ],
    spans: [
      {
        id: 'span-coord',
        kind: 'interactive',
        workspaceId: 'ws-chat',
        resumeId: 'res-coord',
        sessionLabel: 'Portfolio Coordinator',
        agent: 'claude',
        status: 'done',
        startedAt: FROM + 400_000,
        finishedAt: FROM + 2_200_000,
        durationMs: 1_800_000,
        trigger: { kind: 'interactive', surface: 'webpi' },
        prompt: 'Injected coordinator prompt',
        originalPrompt: 'Check QQQ IV skew',
        assistantPreview: 'Compiled QQQ skew memo',
        toolCalls: 3,
        toolFailures: 0,
      },
      {
        id: 'span-worker',
        kind: 'headless',
        workspaceId: 'ws-quant',
        resumeId: 'res-worker',
        sessionLabel: 'IV Worker',
        agent: 'codex',
        model: 'gpt-5.3-codex',
        status: 'done',
        startedAt: FROM + 700_000,
        finishedAt: FROM + 1_700_000,
        durationMs: 1_000_000,
        trigger: {
          kind: 'orchestration',
          dispatchId: 'dsp-1',
          parentWorkspaceId: 'ws-chat',
          parentResumeId: 'res-coord',
        },
        prompt: '[Preamble] Compute QQQ IV skew',
        originalPrompt: 'Compute QQQ IV skew',
        assistantPreview: 'IV skew done',
        toolCalls: 5,
        toolFailures: 0,
      },
      {
        id: 'span-sched',
        kind: 'headless',
        workspaceId: 'ws-quant',
        resumeId: 'res-sched',
        sessionLabel: 'Morning Scan',
        agent: 'claude',
        status: 'done',
        startedAt: FROM + 900_000,
        finishedAt: FROM + 1_500_000,
        durationMs: 600_000,
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: 'ws-quant',
          issueId: 'morning-scan',
          issueTitle: 'Morning Market Scan',
        },
        prompt: 'Run morning market scan',
        toolCalls: 2,
        toolFailures: 0,
      },
    ],
    edges: [
      {
        id: 'edge-dispatch',
        kind: 'dispatch',
        fromWorkspaceId: 'ws-chat',
        fromResumeId: 'res-coord',
        toWorkspaceId: 'ws-quant',
        toResumeId: 'res-worker',
        at: FROM + 700_000,
        taskId: 'span-worker',
        dispatchId: 'dsp-1',
        taskStatus: 'done',
        spec: 'Compute implied volatility skew across 30d/60d tenors.',
        deliverables: [{ path: 'reports/iv-skew.md', summary: 'IV skew memo' }],
      },
      {
        id: 'edge-question',
        kind: 'question',
        fromWorkspaceId: 'ws-quant',
        fromResumeId: 'res-worker',
        toWorkspaceId: 'ws-chat',
        toResumeId: 'res-coord',
        at: FROM + 1_100_000,
        taskId: 'span-worker',
        dispatchId: 'dsp-1',
        deliveryStatus: 'acked',
        ackedAt: FROM + 1_120_000,
        subject: 'Include 10-delta wings?',
        body: 'Should I include 10-delta OTM strikes in the skew table?',
      },
    ],
    artifacts: [
      {
        id: 'art-inbox-1',
        kind: 'inbox',
        entryId: 'inbox-entry-1',
        workspaceId: 'ws-quant',
        at: FROM + 1_500_000,
        title: 'Morning Briefing Ready',
        body: '# Morning Briefing Ready\n\nBreadth narrowed overnight.',
        files: ['reports/morning.md'],
        unread: true,
        runId: 'span-sched',
        resumeId: 'res-sched',
        issueId: 'morning-scan',
      },
      {
        id: 'art-report-1',
        kind: 'report',
        workspaceId: 'ws-quant',
        at: FROM + 1_700_000,
        path: 'reports/iv-skew.md',
        action: 'delivered',
        summary: 'IV skew memo',
        runId: 'span-worker',
        resumeId: 'res-worker',
      },
    ],
    scheduleMarkers: [
      {
        workspaceId: 'ws-quant',
        issueId: 'morning-scan',
        title: 'Morning Market Scan',
        lastFiredAtMs: FROM + 900_000,
        nextDueAtMs: BASE + 600_000,
      },
    ],
    summary: {
      activeWorkspaceCount: 2,
      runningSpanCount: 0,
      totalSpanCount: 3,
      edgeCount: 2,
      artifactCount: 2,
      errorSpanCount: 0,
    },
  }
}

function makeRetryBurstSnapshot(): {
  snapshot: DispatchBoardSnapshot
  fromMs: number
  toMs: number
} {
  const toMs = new Date(2026, 10, 22, 20, 39, 0).getTime()
  const fromMs = toMs - 24 * 3_600_000
  const burstStart = new Date(2026, 10, 22, 14, 35, 0).getTime()

  const failedSpans: DispatchSpan[] = Array.from({ length: 10 }, (_, idx) => {
    const startedAt = burstStart + idx * 40_000
    const finishedAt = startedAt + 12_000
    return {
      id: `burst-fail-${idx + 1}`,
      kind: 'headless',
      workspaceId: 'ws-chat',
      resumeId: `res-burst-${idx + 1}`,
      agent: 'omp',
      status: 'failed',
      startedAt,
      finishedAt,
      durationMs: 12_000,
      trigger: {
        kind: 'scheduled-issue',
        workspaceId: 'ws-chat',
        issueId: 'weekly-liquidity',
        issueTitle: 'Weekly liquidity and macro backdrop',
      },
      prompt: 'Analyze global dollar liquidity and Fed balance sheet.',
      error: `Upstream market data timeout (attempt ${idx + 1})`,
      toolCalls: 1,
      toolFailures: 1,
    }
  })

  const longInteractiveSpan: DispatchSpan = {
    id: 'span-chat-session',
    kind: 'interactive',
    workspaceId: 'ws-chat',
    resumeId: 'res-chat-main',
    sessionLabel: 'Desk Review',
    agent: 'claude',
    status: 'done',
    startedAt: fromMs + 4 * 3_600_000,
    finishedAt: fromMs + 20 * 3_600_000,
    durationMs: 16 * 3_600_000,
    trigger: { kind: 'interactive', surface: 'webpi' },
    assistantPreview: 'Reviewed portfolio risk limits.',
    toolCalls: 4,
    toolFailures: 0,
  }

  return {
    fromMs,
    toMs,
    snapshot: {
      fromMs,
      toMs,
      generatedAt: toMs,
      lanes: [
        // tag === label intentionally to verify no duplicate label/tag line renders
        { workspaceId: 'ws-chat', tag: 'chat-jun15', label: 'chat-jun15', template: 'chat', templateKind: 'chat' },
        { workspaceId: 'ws-quant', tag: 'quant-main', label: 'Auto Quant', template: 'auto-quant-v2', templateKind: 'auto-quant' },
      ],
      spans: [longInteractiveSpan, ...failedSpans],
      edges: [],
      artifacts: [],
      scheduleMarkers: [],
      summary: {
        activeWorkspaceCount: 2,
        runningSpanCount: 0,
        totalSpanCount: 11,
        edgeCount: 0,
        artifactCount: 0,
        errorSpanCount: 10,
      },
    },
  }
}

beforeEach(async () => {
  localStorage.removeItem('openalice-issue-list-view')
  await i18n.changeLanguage('en')
  mocks.getDispatch.mockResolvedValue(sampleSnapshot())
  mocks.useIssues.mockReturnValue({
    data: {
      workspaces: [
        {
          wsId: 'ws-quant',
          tag: 'quant-main',
          status: 'ok',
          issues: [
            {
              id: 'morning-scan',
              title: 'Morning Market Scan',
              status: 'todo',
              priority: 'high',
              assignee: '@new-each-run',
            },
          ],
        },
      ],
    },
    error: null,
    loading: false,
    updateIssue: mocks.updateIssue,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dispatch layout helpers', () => {
  it('packs overlapping spans into distinct tracks and reuses track 0 for sequential spans', () => {
    const snap = sampleSnapshot()
    const quantSpans = snap.spans.filter((s) => s.workspaceId === 'ws-quant')
    const packed = packSpansIntoTracks(quantSpans, FROM, BASE)
    expect(packed.trackCount).toBe(2)
    expect(packed.packed.map((p) => [p.span.id, p.track])).toEqual([
      ['span-worker', 0],
      ['span-sched', 1],
    ])

    const sequential = packSpansIntoTracks(
      [
        { ...quantSpans[0]!, id: 'seq-1', startedAt: FROM + 100_000, finishedAt: FROM + 300_000 },
        { ...quantSpans[1]!, id: 'seq-2', startedAt: FROM + 600_000, finishedAt: FROM + 800_000 },
      ],
      FROM,
      BASE,
    )
    expect(sequential.trackCount).toBe(1)
    expect(sequential.packed.every((p) => p.track === 0)).toBe(true)
  })

  it('collects only the connected causal component for a focused span', () => {
    const snap = sampleSnapshot()
    const trace = collectConnectedTraceIds(snap.spans, snap.edges, snap.artifacts, {
      kind: 'span',
      id: 'span-coord',
    })
    expect([...trace.spanIds]).toEqual(expect.arrayContaining(['span-coord', 'span-worker']))
    expect(trace.spanIds.has('span-sched')).toBe(false)
    expect([...trace.edgeIds]).toEqual(expect.arrayContaining(['edge-dispatch', 'edge-question']))
    expect([...trace.artifactIds]).toEqual(['art-report-1'])
  })

  it('clusters dense bursts within 2.5% window width while capping tracks to maxTracks = 2', () => {
    const { snapshot, fromMs, toMs } = makeRetryBurstSnapshot()
    const chatSpans = snapshot.spans.filter((s) => s.workspaceId === 'ws-chat')

    const clustered = clusterLaneSpans(chatSpans, fromMs, toMs, { maxTracks: 2 })
    expect(clustered.trackCount).toBe(2)
    // Long interactive session stays intact on track 0; 10 failed retries collapse into 1 cluster pill on track 1
    expect(clustered.spans).toHaveLength(1)
    expect(clustered.spans[0]!.span.id).toBe('span-chat-session')
    expect(clustered.spans[0]!.track).toBe(0)

    expect(clustered.clusters).toHaveLength(1)
    expect(clustered.clusters[0]!.count).toBe(10)
    expect(clustered.clusters[0]!.worstStatus).toBe('failed')
    expect(clustered.clusters[0]!.track).toBe(1)

    // Without the long ongoing span, 10 clustered runs collapse cleanly onto track 0
    const burstOnly = chatSpans.filter((s) => s.id.startsWith('burst-fail-'))
    const soloClustered = clusterLaneSpans(burstOnly, fromMs, toMs, { maxTracks: 2 })
    expect(soloClustered.trackCount).toBe(1)
    expect(soloClustered.spans).toHaveLength(0)
    expect(soloClustered.clusters).toHaveLength(1)
    expect(soloClustered.clusters[0]!.count).toBe(10)
    expect(soloClustered.clusters[0]!.track).toBe(0)
  })

  it('computes worst status in mixed clusters (failed > interrupted > running > done) and keeps distant bursts separate', () => {
    const toMs = BASE
    const fromMs = BASE - 24 * 3_600_000
    const makeSpan = (id: string, offsetMin: number, status: DispatchSpan['status']): DispatchSpan => ({
      id,
      kind: 'headless',
      workspaceId: 'ws-chat',
      resumeId: `r-${id}`,
      agent: 'claude',
      status,
      startedAt: fromMs + offsetMin * 60_000,
      finishedAt: status === 'running' ? null : fromMs + offsetMin * 60_000 + 15_000,
      durationMs: 15_000,
      trigger: { kind: 'manual' },
      toolCalls: 0,
      toolFailures: 0,
    })

    const spans: DispatchSpan[] = [
      // Cluster A around minute 120: done + interrupted + done -> worst is interrupted
      makeSpan('a1', 120, 'done'),
      makeSpan('a2', 121, 'interrupted'),
      makeSpan('a3', 122, 'done'),
      // Standalone span at minute 600
      makeSpan('c1', 600, 'done'),
      // Cluster B near live edge (minute 1434..1436): done + running (finishedAt: null) + failed -> worst is failed
      makeSpan('b1', 1434, 'done'),
      makeSpan('b2', 1435, 'running'),
      makeSpan('b3', 1436, 'failed'),
    ]

    const clustered = clusterLaneSpans(spans, fromMs, toMs, { maxTracks: 2 })
    expect(clustered.trackCount).toBeLessThanOrEqual(2)
    expect(clustered.clusters).toHaveLength(2)
    expect(clustered.clusters[0]!.worstStatus).toBe('interrupted')
    expect(clustered.clusters[0]!.count).toBe(3)
    expect(clustered.clusters[1]!.worstStatus).toBe('failed')
    expect(clustered.clusters[1]!.count).toBe(3)
    expect(clustered.spans.map((p) => p.span.id)).toEqual(['c1'])

    // Conservation invariant: every input span appears exactly once across spans + clusters
    const totalOutSpans =
      clustered.spans.length + clustered.clusters.reduce((acc, c) => acc + c.spans.length, 0)
    expect(totalOutSpans).toBe(spans.length)

    // Running > done when no failed/interrupted exists in a live cluster
    const liveCluster = clusterLaneSpans(
      [makeSpan('r1', 1434, 'done'), makeSpan('r2', 1435, 'running'), makeSpan('r3', 1436, 'done')],
      fromMs,
      toMs,
      { maxTracks: 2 },
    )
    expect(liveCluster.clusters).toHaveLength(1)
    expect(liveCluster.clusters[0]!.worstStatus).toBe('running')
  })

  it('formats 24h and cross-day window ranges with short dates while keeping same-day short windows compact', () => {
    const sameDayFrom = new Date(2026, 10, 22, 19, 39, 0).getTime()
    const sameDayTo = new Date(2026, 10, 22, 20, 39, 0).getTime()
    expect(formatWindowRange(sameDayFrom, sameDayTo, 'en-US')).toBe('19:39 – 20:39')

    const dayBefore = new Date(2026, 10, 21, 20, 39, 0).getTime()
    const dayAfter = new Date(2026, 10, 22, 20, 39, 0).getTime()
    expect(formatWindowRange(dayBefore, dayAfter, 'en-US')).toBe('Nov 21, 20:39 – Nov 22, 20:39')

    // Even < 12h spanning midnight includes short date
    const midnightFrom = new Date(2026, 10, 21, 23, 30, 0).getTime()
    const midnightTo = new Date(2026, 10, 22, 0, 30, 0).getTime()
    expect(formatWindowRange(midnightFrom, midnightTo, 'en-US')).toBe('Nov 21, 23:30 – Nov 22, 00:30')

    // 24h ruler ticks include numeric month/day
    expect(formatTickTime(dayAfter, 24 * 3_600_000, dayBefore, dayAfter, 'en-US')).toBe('11/22, 20:39')
    expect(formatTickTime(sameDayTo, 3_600_000, sameDayFrom, sameDayTo, 'en-US')).toBe('20:39')
  })

  it('builds structured orchestration, collapsed consecutive burst, execution, and standalone artifact episodes newest-first', () => {
    const snap = sampleSnapshot()
    const extraStandaloneArtifact = {
      id: 'art-standalone-report',
      kind: 'report' as const,
      workspaceId: 'ws-quant',
      at: BASE - 60_000,
      path: 'reports/close-summary.md',
      action: 'written',
      summary: 'Close summary generated externally',
    }

    const episodes = buildDispatchEpisodes(
      snap.spans,
      snap.edges,
      [...snap.artifacts, extraStandaloneArtifact],
    )

    // Newest-first: standalone report (BASE - 60s), orchestration (FROM + 2_200_000), sched execution (FROM + 1_500_000)
    expect(episodes.map((e) => e.kind)).toEqual(['artifact', 'orchestration', 'execution'])
    const orch = episodes[1]!
    expect(orch.kind).toBe('orchestration')
    if (orch.kind === 'orchestration') {
      expect(orch.coordinator?.span.id).toBe('span-coord')
      expect(orch.workers.map((w) => w.span.id)).toEqual(['span-worker'])
      expect(orch.edges.map((e) => e.id)).toEqual(['edge-dispatch', 'edge-question'])
      expect(orch.artifacts.map((a) => a.id)).toEqual(['art-report-1'])
    }

    // Consecutive retry burst collapsing (does not break across other workspaces, breaks on status change)
    const { snapshot: burstSnap } = makeRetryBurstSnapshot()
    const recoveryRun: DispatchSpan = {
      ...burstSnap.spans[1]!,
      id: 'burst-recover-11',
      resumeId: 'res-recover-11',
      status: 'done',
      startedAt: burstSnap.spans[10]!.finishedAt! + 60_000,
      finishedAt: burstSnap.spans[10]!.finishedAt! + 90_000,
      durationMs: 30_000,
      error: undefined,
      assistantPreview: 'Recovered successfully.',
    }
    const unrelatedQuantRun: DispatchSpan = {
      id: 'quant-interleaved',
      kind: 'headless',
      workspaceId: 'ws-quant',
      resumeId: 'res-q-1',
      agent: 'claude',
      status: 'done',
      startedAt: burstSnap.spans[5]!.startedAt,
      finishedAt: burstSnap.spans[5]!.finishedAt,
      durationMs: 12_000,
      trigger: {
        kind: 'scheduled-issue',
        workspaceId: 'ws-quant',
        issueId: 'other-scan',
        issueTitle: 'Other Workspace Scan',
      },
      toolCalls: 1,
      toolFailures: 0,
    }

    const burstEpisodes = buildDispatchEpisodes(
      [...burstSnap.spans, unrelatedQuantRun, recoveryRun],
      [],
      [],
    )
    const burstEp = burstEpisodes.find((e) => e.kind === 'burst')
    expect(burstEp).toBeDefined()
    if (burstEp?.kind === 'burst') {
      expect(burstEp.runs).toHaveLength(10)
      expect(burstEp.status).toBe('failed')
      expect(burstEp.title).toBe('Weekly liquidity and macro backdrop')
      expect(burstEp.agent).toBe('omp')
      expect(burstEp.error).toContain('Upstream market data timeout')
    }
    expect(burstEpisodes.some((e) => e.kind === 'execution' && e.execution.span.id === 'burst-recover-11')).toBe(true)
    expect(burstEpisodes.some((e) => e.kind === 'execution' && e.execution.span.id === 'quant-interleaved')).toBe(true)
  })

  it('collapses >= 3 consecutive same-workspace same-status standalone runs within 120s into a wave burst while keeping pairs individual', () => {
    const waveAt = new Date(2026, 10, 22, 13, 49, 4).getTime()
    const laterAt = new Date(2026, 10, 22, 17, 50, 3).getTime()

    const waveSpans: DispatchSpan[] = Array.from({ length: 11 }, (_, idx) => ({
      id: `wave-${idx + 1}`,
      kind: 'headless',
      workspaceId: 'ws-chat',
      resumeId: `res-wave-${idx + 1}`,
      sessionLabel: `# Issue ${idx + 1} Maintain this as a falsifiable thesis...`,
      agent: 'omp',
      model: 'opencode-go/muse-spark-1.3-contributor',
      status: 'failed',
      startedAt: waveAt + idx * 500,
      finishedAt: waveAt + idx * 500 + 6_000,
      durationMs: 6_000,
      trigger: {
        kind: 'scheduled-issue',
        workspaceId: 'ws-chat',
        issueId: `issue-${idx + 1}`,
        issueTitle: `Scheduled Issue ${idx + 1}`,
      },
      error: '403 This model is not available in your country (type=RegionError)',
      toolCalls: 0,
      toolFailures: 0,
    }))

    const laterPair: DispatchSpan[] = ['telegram-phone-desk', 'feishu-phone-desk'].map((issueId, idx) => ({
      id: `pair-${idx + 1}`,
      kind: 'headless',
      workspaceId: 'ws-chat',
      resumeId: `res-pair-${idx + 1}`,
      agent: 'omp',
      model: 'opencode-go/muse-spark-1.3-contributor',
      status: 'failed',
      startedAt: laterAt + idx * 1_000,
      finishedAt: laterAt + idx * 1_000 + 5_000,
      durationMs: 5_000,
      trigger: {
        kind: 'scheduled-issue',
        workspaceId: 'ws-chat',
        issueId,
        issueTitle: `#${issueId}`,
      },
      error: '403 This model is not available in your country (type=RegionError)',
      toolCalls: 0,
      toolFailures: 0,
    }))

    const episodes = buildDispatchEpisodes([...waveSpans, ...laterPair], [], [])
    // 11-issue wave collapses into 1 wave burst; 2-issue pair stays 2 individual execution rows -> 3 total rows!
    expect(episodes).toHaveLength(3)
    expect(episodes.map((e) => e.kind)).toEqual(['execution', 'execution', 'burst'])
    const waveEp = episodes[2]!
    expect(waveEp.kind).toBe('burst')
    if (waveEp.kind === 'burst') {
      expect(waveEp.burstKind).toBe('wave')
      expect(waveEp.distinctIssueCount).toBe(11)
      expect(waveEp.runs).toHaveLength(11)
      expect(waveEp.title).toBe('Scheduled wave (11 issues)')
      expect(waveEp.error).toContain('RegionError')
    }
  })

  it('staggers parallel SVG edge Bezier curves and pill midpoints so stacked lane-pair edges do not collide', () => {
    const snap = sampleSnapshot()
    const baseEdge = snap.edges[0]!
    const endpoints = (['dispatch', 'question', 'reply', 'worker_done'] as const).map((kind, i) => ({
      edge: { ...baseEdge, id: `e-${i}`, kind, at: FROM + 700_000 + i * 5_000 },
      x1: 400 + i * 2,
      y1: 36,
      x2: 400 + i * 2,
      y2: 108,
    }))

    const laidOut = layoutEdgeGeometries(endpoints, 900)
    expect(laidOut).toHaveLength(4)

    for (let i = 0; i < laidOut.length; i += 1) {
      expect(laidOut[i]!.mx).toBeGreaterThanOrEqual(28)
      expect(laidOut[i]!.mx).toBeLessThanOrEqual(900 - 28)
      for (let j = i + 1; j < laidOut.length; j += 1) {
        const dist = Math.hypot(laidOut[i]!.mx - laidOut[j]!.mx, laidOut[i]!.my - laidOut[j]!.my)
        expect(dist).toBeGreaterThanOrEqual(24)
      }
    }
  })
})

describe('Issues -> Dispatch integration & Inspector', () => {
  it('switches into Dispatch from next to All issues, renders active lanes, and inspects spans, messages, and Inbox outputs', async () => {
    const user = userEvent.setup()
    render(<IssuesBoard />)

    // Enter Dispatch view from button beside All issues
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByTestId('dispatch-board')).toBeTruthy())

    expect(screen.getByTestId('dispatch-lane-ws-chat')).toBeTruthy()
    expect(screen.getByTestId('dispatch-lane-ws-quant')).toBeTruthy()

    // No redundant 'active' badge on lanes
    expect(screen.queryByText('active')).toBeNull()

    // 1) Inspect worker span: Original vs Delivered prompt toggle & Open Session
    await user.click(screen.getByTestId('dispatch-span-span-worker'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('[Preamble] Compute QQQ IV skew')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Original' }))
    expect(within(dialog).getByText('Compute QQQ IV skew')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Open Session' }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('chat')
    expect(mocks.openHeadlessRun).toHaveBeenCalledWith('ws-quant', 'res-worker', { title: 'IV Worker' })

    // Close drawer before clicking edge chip
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 2) Inspect orchestration question message inside Zone 2 feed
    await user.click(screen.getByTestId('dispatch-edge-chip-edge-question'))
    const edgeDialog = await screen.findByRole('dialog')
    expect(within(edgeDialog).getByText('Include 10-delta wings?')).toBeTruthy()
    expect(within(edgeDialog).getByText('Should I include 10-delta OTM strikes in the skew table?')).toBeTruthy()
    expect(within(edgeDialog).getByText(/Delivered/)).toBeTruthy()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 3) Inspect Inbox artifact and jump to Inbox
    await user.click(screen.getByTestId('dispatch-artifact-art-inbox-1'))
    const inboxDialog = await screen.findByRole('dialog')
    expect(within(inboxDialog).getByText(/Breadth narrowed overnight\./)).toBeTruthy()
    await user.click(within(inboxDialog).getByRole('button', { name: 'Open in Inbox' }))
    expect(mocks.selectInboxEntry).toHaveBeenCalledWith('inbox-entry-1')
    expect(mocks.markInboxRead).toHaveBeenCalledWith('inbox-entry-1')
    expect(mocks.setSidebar).toHaveBeenCalledWith('inbox')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'inbox', params: {} })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Switch back to All issues
    await user.click(screen.getByRole('button', { name: 'All issues' }))
    expect(screen.queryByTestId('dispatch-board')).toBeNull()
    expect(screen.getByText('Morning Market Scan')).toBeTruthy()
  })

  it('renders 24h range with short dates, suppresses duplicate workspace tag, collapses/expands retry bursts, and links map cluster -> feed -> inspector', async () => {
    const user = userEvent.setup()
    const { snapshot, fromMs, toMs } = makeRetryBurstSnapshot()
    mocks.getDispatch.mockResolvedValue(snapshot)

    // Exact 24h toolbar formatting check
    const { unmount: unmountToolbar } = render(
      <DispatchToolbarControls
        board={{
          snapshot,
          loading: false,
          error: null,
          preset: '24h',
          live: true,
          fromMs,
          toMs,
          setPreset: vi.fn(),
          setLive: vi.fn(),
          stepWindow: vi.fn(),
          refresh: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    )
    expect(screen.getByText('Nov 21, 20:39 – Nov 22, 20:39')).toBeTruthy()
    unmountToolbar()

    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    render(<IssuesBoard />)
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByTestId('dispatch-board')).toBeTruthy())

    // Switch to 24h preset and verify toolbar date range shows distinct calendar dates (not HH:mm - HH:mm)
    await user.click(screen.getByRole('button', { name: '24h' }))
    await waitFor(() => expect(mocks.getDispatch).toHaveBeenCalled())
    expect(screen.getByText(/[A-Z][a-z]{2} \d+, \d{2}:\d{2} – [A-Z][a-z]{2} \d+, \d{2}:\d{2}/)).toBeTruthy()

    // Left lane header: chat-jun15 appears only once (tag === label suppressed) and no redundant active pill
    const chatLane = screen.getByTestId('dispatch-lane-ws-chat')
    expect(within(chatLane).getAllByText('chat-jun15')).toHaveLength(1)
    expect(within(chatLane).queryByText('active')).toBeNull()

    // Cluster pill renders on map instead of 10 individual failure bars
    const clusterPill = within(chatLane).getByTestId(/^dispatch-cluster-/)
    expect(clusterPill.textContent).toContain('×10')
    expect(within(chatLane).queryByTestId('dispatch-span-burst-fail-1')).toBeNull()
    expect(within(chatLane).getByTestId('dispatch-span-span-chat-session')).toBeTruthy()

    // Zone 2 shows collapsed burst summary row with Show 10 runs toggle
    const burstEp = screen.getByTestId(/^dispatch-episode-burst:/)
    expect(within(burstEp).getByText('Failed ×10')).toBeTruthy()
    expect(within(burstEp).getByText('Weekly liquidity and macro backdrop')).toBeTruthy()
    expect(within(burstEp).getByText('omp')).toBeTruthy()
    expect(within(burstEp).getByText('14:35–14:41')).toBeTruthy()

    // Individual runs are collapsed until expanded
    expect(within(burstEp).queryByTestId('dispatch-feed-span-burst-fail-10')).toBeNull()

    // Manual expand & collapse
    await user.click(within(burstEp).getByRole('button', { name: /Show 10 runs/i }))
    expect(within(burstEp).getByTestId('dispatch-feed-span-burst-fail-10')).toBeTruthy()
    expect(within(burstEp).getByTestId('dispatch-feed-span-burst-fail-1')).toBeTruthy()
    await user.click(within(burstEp).getByRole('button', { name: /Collapse/i }))
    expect(within(burstEp).queryByTestId('dispatch-feed-span-burst-fail-10')).toBeNull()

    // Clicking cluster pill on map focuses & expands burst in Feed and scrolls into view
    await user.click(clusterPill)
    expect(scrollIntoViewMock).toHaveBeenCalled()
    expect(within(burstEp).getByTestId('dispatch-feed-span-burst-fail-10')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()

    // Clicking the already-focused cluster pill a second time opens the latest run in Inspector
    await user.click(clusterPill)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Upstream market data timeout (attempt 10)')).toBeTruthy()
    expect(within(dialog).getByText('Run 1 of 10 in burst')).toBeTruthy()

    // Navigate to previous run right inside Inspector
    await user.click(within(dialog).getByRole('button', { name: 'Previous' }))
    expect(within(dialog).getByText('Upstream market data timeout (attempt 9)')).toBeTruthy()
    expect(within(dialog).getByText('Run 2 of 10 in burst')).toBeTruthy()
  })

  it('supports bidirectional hover highlighting and preserves coordinator + worker under Orchestration filter', async () => {
    const user = userEvent.setup()
    render(<IssuesBoard />)
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByTestId('dispatch-board')).toBeTruthy())

    // Hovering the orchestration episode in Zone 2 emphasizes coordinator & worker spans on Map while dimming unrelated span-sched
    const orchEpisode = screen.getByTestId('dispatch-episode-orch:span-coord')
    const schedSpanBar = screen.getByTestId('dispatch-span-span-sched')
    const coordSpanBar = screen.getByTestId('dispatch-span-span-coord')
    expect(schedSpanBar.className).toContain('opacity-100')

    await user.hover(orchEpisode)
    expect(coordSpanBar.className).toContain('ring-2')
    expect(schedSpanBar.className).toContain('opacity-30')

    await user.unhover(orchEpisode)
    expect(schedSpanBar.className).toContain('opacity-100')

    // Orchestration filter preserves BOTH coordinator and worker spans while hiding scheduled-only runs
    await user.click(screen.getByRole('button', { name: 'Orchestration' }))
    expect(screen.getByTestId('dispatch-span-span-coord')).toBeTruthy()
    expect(screen.getByTestId('dispatch-span-span-worker')).toBeTruthy()
    expect(screen.queryByTestId('dispatch-span-span-sched')).toBeNull()
  })

  it('groups scheduled waves cleanly, resets cluster focus on escape/other clicks, and clamps prompt-like sessionLabel in Inspector', async () => {
    const user = userEvent.setup()
    const toMs = new Date(2026, 10, 22, 21, 45, 0).getTime()
    const fromMs = toMs - 24 * 3_600_000
    const waveAt = new Date(2026, 10, 22, 13, 49, 4).getTime()
    const pairAt = new Date(2026, 10, 22, 17, 50, 3).getTime()

    const longPromptSessionLabel =
      '# Semis, oil and policy-cover thesis Maintain this as a falsifiable working hypothesis, never as an established claim: semiconductor/AI political support may strengthen when oil optics rise.'

    const waveSpans: DispatchSpan[] = Array.from({ length: 11 }, (_, idx) => ({
      id: `wave-span-${idx + 1}`,
      kind: 'headless',
      workspaceId: 'ws-chat',
      resumeId: `res-semis-${idx + 1}`,
      sessionLabel: idx === 10 ? longPromptSessionLabel : `# Thesis ${idx + 1} raw prompt...`,
      agent: 'omp',
      model: 'opencode-go/muse-spark-1.3-contributor',
      status: 'failed',
      startedAt: waveAt + idx * 400,
      finishedAt: waveAt + idx * 400 + 6_000,
      durationMs: 6_000,
      trigger: {
        kind: 'scheduled-issue',
        workspaceId: 'ws-chat',
        issueId: idx === 10 ? 'trump-semis-oil-thesis' : `issue-${idx + 1}`,
        issueTitle: idx === 10 ? 'Semis, oil and policy-cover thesis' : `Issue ${idx + 1}`,
      },
      prompt: longPromptSessionLabel,
      error: '403 This model is not available in your country (type=RegionError)',
      toolCalls: 0,
      toolFailures: 0,
    }))

    const pairSpans: DispatchSpan[] = [
      {
        id: 'pair-1',
        kind: 'headless',
        workspaceId: 'ws-chat',
        resumeId: 'res-tg',
        agent: 'omp',
        model: 'opencode-go/muse-spark-1.3-contributor',
        status: 'failed',
        startedAt: pairAt,
        finishedAt: pairAt + 5_000,
        durationMs: 5_000,
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: 'ws-chat',
          issueId: 'telegram-phone-desk',
          issueTitle: '#telegram-phone-desk',
        },
        error: '403 This model is not available in your country (type=RegionError)',
        toolCalls: 0,
        toolFailures: 0,
      },
      {
        id: 'pair-2',
        kind: 'headless',
        workspaceId: 'ws-chat',
        resumeId: 'res-fs',
        agent: 'omp',
        model: 'opencode-go/muse-spark-1.3-contributor',
        status: 'failed',
        startedAt: pairAt + 1_000,
        finishedAt: pairAt + 5_000,
        durationMs: 4_000,
        trigger: {
          kind: 'scheduled-issue',
          workspaceId: 'ws-chat',
          issueId: 'feishu-phone-desk',
          issueTitle: '#feishu-phone-desk',
        },
        error: '403 This model is not available in your country (type=RegionError)',
        toolCalls: 0,
        toolFailures: 0,
      },
    ]

    mocks.getDispatch.mockResolvedValue({
      fromMs,
      toMs,
      generatedAt: toMs,
      lanes: [{ workspaceId: 'ws-chat', tag: 'chat-jun15', label: 'chat-jun15', template: 'chat', templateKind: 'chat' }],
      spans: [...waveSpans, ...pairSpans],
      edges: [],
      artifacts: [],
      scheduleMarkers: [],
      summary: {
        activeWorkspaceCount: 1,
        runningSpanCount: 0,
        totalSpanCount: 13,
        edgeCount: 0,
        artifactCount: 0,
        errorSpanCount: 13,
      },
    })

    Element.prototype.scrollIntoView = vi.fn()

    render(<IssuesBoard />)
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByTestId('dispatch-board')).toBeTruthy())

    // 13 runs collapse into 3 crisp feed rows (2 individual + 1 scheduled wave)
    expect(screen.getAllByTestId(/^dispatch-episode-/)).toHaveLength(3)
    const waveEp = screen.getByTestId(/^dispatch-episode-burst:/)
    expect(within(waveEp).getByText('Failed ×11')).toBeTruthy()
    expect(within(waveEp).getByText('Scheduled wave (11 issues)')).toBeTruthy()

    // Click cluster pill once -> highlights cluster & wave episode; Escape clears stuck ring cleanly!
    const clusterPill = screen.getByTestId(/^dispatch-cluster-/)
    await user.click(clusterPill)
    expect(clusterPill.className).toContain('ring-primary/50')
    expect(waveEp.className).toContain('ring-1')

    await user.keyboard('{Escape}')
    expect(clusterPill.className).not.toContain('ring-primary/50')
    expect(waveEp.className).not.toContain('ring-1')

    // Click cluster pill once, then click an unrelated Feed execution row -> cluster ring clears before/after closing Inspector!
    await user.click(clusterPill)
    expect(clusterPill.className).toContain('ring-primary/50')
    await user.click(screen.getByTestId('dispatch-feed-span-pair-1'))
    const pairDialog = await screen.findByRole('dialog')
    expect(within(pairDialog).getByText('chat-jun15 · #telegram-phone-desk')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(clusterPill.className).not.toContain('ring-primary/50')

    // Click cluster pill twice -> opens newest run (wave-span-11) with clean Inspector header, compact Session, nowrap Open Issue
    await user.click(clusterPill)
    expect(clusterPill.className).toContain('ring-primary/50')
    await user.click(clusterPill)
    const dialog = await screen.findByRole('dialog')

    // Header subtitle uses clean issue title, NOT 200-char prompt excerpt
    expect(within(dialog).getByText('chat-jun15 · Semis, oil and policy-cover thesis')).toBeTruthy()
    // Session MetaRow displays resumeId instead of 6-line raw prompt, preserving full label in title
    expect(within(dialog).getByText('res-semis-11').getAttribute('title')).toBe(longPromptSessionLabel)
    // Open Issue button never wraps
    expect(within(dialog).getByRole('button', { name: 'Open Issue' }).className).toContain('whitespace-nowrap')
    // Sibling cluster navigation works across all 11 wave runs
    expect(within(dialog).getByText('Run 1 of 11 in burst')).toBeTruthy()

    // Closing Inspector leaves ZERO stuck cluster focus rings!
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(clusterPill.className).not.toContain('ring-primary/50')
    expect(waveEp.className).not.toContain('ring-1')
  })

  it('renders pinned Commander control-plane swimlane, Scheduled Thread -> Commander report wake, Commander -> Worker dispatch, and safe Inspector actions', async () => {
    const user = userEvent.setup()
    const commanderSnapshot: DispatchBoardSnapshot = {
      fromMs: FROM,
      toMs: BASE,
      generatedAt: BASE,
      lanes: [
        {
          workspaceId: 'commander',
          tag: 'Commander',
          label: 'Commander',
          template: 'commander',
          templateKind: 'commander',
        },
        {
          workspaceId: 'ws-chat',
          tag: 'chat-main',
          label: 'Chat',
          template: 'chat',
          templateKind: 'chat',
        },
        {
          workspaceId: 'ws-quant',
          tag: 'quant-main',
          label: 'Auto Quant',
          template: 'auto-quant-v2',
          templateKind: 'auto-quant',
        },
      ],
      spans: [
        {
          id: 'span-sched-report',
          kind: 'headless',
          workspaceId: 'ws-quant',
          resumeId: 'res-sched-report',
          sessionLabel: 'Morning Scan',
          agent: 'claude',
          status: 'done',
          startedAt: FROM + 500_000,
          finishedAt: FROM + 620_000,
          durationMs: 120_000,
          trigger: {
            kind: 'scheduled-issue',
            workspaceId: 'ws-quant',
            issueId: 'morning-scan',
            issueTitle: 'Morning Market Scan',
          },
          assistantPreview: 'Detected 2.1 sigma spread widening in QQQ.',
          toolCalls: 3,
          toolFailures: 0,
        },
        {
          id: 'span-cmd-wake',
          kind: 'headless',
          workspaceId: 'commander',
          resumeId: 'res-commander',
          sessionLabel: 'Commander',
          agent: 'claude',
          status: 'done',
          startedAt: FROM + 630_000,
          finishedAt: FROM + 720_000,
          durationMs: 90_000,
          trigger: { kind: 'manual' },
          prompt: 'You have 1 pending schedule report. Run alice conversation check.',
          assistantPreview: 'Dispatched follow-up quant worker and pushed alert to Inbox.',
          toolCalls: 2,
          toolFailures: 0,
        },
        {
          id: 'span-cmd-worker',
          kind: 'headless',
          workspaceId: 'ws-quant',
          resumeId: 'res-cmd-worker',
          sessionLabel: 'Spread Deep Dive',
          agent: 'codex',
          status: 'done',
          startedAt: FROM + 660_000,
          finishedAt: FROM + 840_000,
          durationMs: 180_000,
          trigger: {
            kind: 'orchestration',
            dispatchId: 'dsp-cmd-1',
            parentWorkspaceId: 'commander',
            parentResumeId: 'res-commander',
          },
          prompt: 'Verify whether QQQ spread widening is ETF rebalance noise.',
          assistantPreview: 'Confirmed ETF rebalance flow.',
          toolCalls: 4,
          toolFailures: 0,
        },
      ],
      edges: [
        {
          id: 'report-mail-1',
          kind: 'conversation',
          messageKind: 'scheduled_report',
          fromWorkspaceId: 'ws-quant',
          fromResumeId: 'res-sched-report',
          toWorkspaceId: 'commander',
          toResumeId: 'res-commander',
          at: FROM + 625_000,
          taskId: 'span-sched-report',
          deliveryStatus: 'acked',
          ackedAt: FROM + 635_000,
          subject: 'Morning Market Scan',
          body: 'Detected 2.1 sigma spread widening in QQQ.',
          outcome: 'completed',
          summary: 'Morning Market Scan (done)',
        },
        {
          id: 'dsp-dsp-cmd-1',
          kind: 'dispatch',
          fromWorkspaceId: 'commander',
          fromResumeId: 'res-commander',
          toWorkspaceId: 'ws-quant',
          toResumeId: 'res-cmd-worker',
          at: FROM + 660_000,
          taskId: 'span-cmd-worker',
          dispatchId: 'dsp-cmd-1',
          taskStatus: 'done',
          spec: 'Verify whether QQQ spread widening is ETF rebalance noise.',
        },
      ],
      artifacts: [
        {
          id: 'art-cmd-inbox',
          kind: 'inbox',
          entryId: 'inbox-cmd-1',
          workspaceId: 'commander',
          at: FROM + 715_000,
          title: 'QQQ Spread Alert',
          body: '# QQQ Spread Alert\nCommander escalated verified spread anomaly.',
          files: ['ws-quant/reports/spread.md'],
          unread: true,
          runId: 'span-cmd-wake',
          resumeId: 'res-commander',
        },
      ],
      scheduleMarkers: [],
      summary: {
        activeWorkspaceCount: 2,
        runningSpanCount: 0,
        totalSpanCount: 3,
        edgeCount: 2,
        artifactCount: 1,
        errorSpanCount: 0,
      },
    }

    mocks.getDispatch.mockResolvedValue(commanderSnapshot)

    render(<IssuesBoard />)
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    await waitFor(() => expect(screen.getByTestId('dispatch-board')).toBeTruthy())

    // Commander lane is pinned first at index 0 with control-plane styling & badge
    const lanes = screen.getAllByTestId(/^dispatch-lane-/)
    expect(lanes.map((el) => el.getAttribute('data-testid'))).toEqual([
      'dispatch-lane-commander',
      'dispatch-lane-ws-chat',
      'dispatch-lane-ws-quant',
    ])
    const commanderLane = lanes[0]!
    expect(commanderLane.getAttribute('data-lane-kind')).toBe('commander')
    const commanderBadge = within(commanderLane).getByTestId('dispatch-commander-badge')
    expect(commanderBadge.textContent).toBe('Commander')
    expect(commanderBadge.className).toContain('text-primary')
    expect(commanderBadge.className).toContain('border-primary/30')
    expect(commanderBadge.className).toContain('bg-primary/10')

    // Causal episode feed includes both the Scheduled Thread -> Commander report chip and Commander -> Worker dispatch chip
    expect(screen.getByTestId('dispatch-edge-chip-report-mail-1').textContent).toContain('Report')
    expect(screen.getByTestId('dispatch-edge-chip-dsp-dsp-cmd-1')).toBeTruthy()
    expect(screen.getByTestId('dispatch-artifact-art-cmd-inbox')).toBeTruthy()

    // Inspecting a Commander span displays Commander badge cleanly without invalid business-workspace Open Session button
    await user.click(screen.getByTestId('dispatch-span-span-cmd-wake'))
    const cmdSpanDialog = await screen.findByRole('dialog')
    expect(within(cmdSpanDialog).queryByRole('button', { name: 'Open Session' })).toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Inspecting the scheduled-report edge displays full label, summary, and keeps Commander resume non-business-clickable
    await user.click(screen.getByTestId('dispatch-edge-chip-report-mail-1'))
    const reportDialog = await screen.findByRole('dialog')
    expect(within(reportDialog).getByText('Scheduled report')).toBeTruthy()
    expect(within(reportDialog).getByText('Morning Market Scan (done)')).toBeTruthy()
    expect(within(reportDialog).queryByRole('button', { name: 'res-commander' })).toBeNull()
    expect(within(reportDialog).getByText('res-commander')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Inspecting Commander -> Inbox artifact preserves Open in Inbox without invalid business Open Session
    await user.click(screen.getByTestId('dispatch-artifact-art-cmd-inbox'))
    const inboxDialog = await screen.findByRole('dialog')
    expect(within(inboxDialog).getByRole('button', { name: 'Open in Inbox' })).toBeTruthy()
    expect(within(inboxDialog).queryByRole('button', { name: 'Open Session' })).toBeNull()
  })
})
