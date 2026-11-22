// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DispatchBoardSnapshot } from '../../api/dispatch'
import type { IssueSnapshot } from '../../api/issues'
import { i18n } from '../../i18n'
import { IssuesBoard } from '../IssuesBoard'
import { collectConnectedTraceIds, packSpansIntoTracks } from './layout'

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

    // 2) Inspect orchestration question message
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
})
