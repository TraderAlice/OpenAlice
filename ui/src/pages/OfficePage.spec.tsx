// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import type { OfficeInboxDutyEvidence } from '../office/duty-registry'
import { inboxUnreadDutyRegistration, type OfficeInboxDutyCandidate } from '../office/duty-registry'
import { useInboxSelection } from '../live/inbox-selection'
import { OFFICE_COWORKER_CAST_STORAGE_KEY } from '../office/coworker-cast-storage'
import {
  markOfficeInboxDutyPresented,
  readOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from '../office/inbox-duty-excursion'
import { clearOfficePlayerState } from '../office/office-excursion'
import { OfficePage } from './OfficePage'

const {
  acknowledgeMock,
  navigateMock,
  issuesMock,
  issueDetailMock,
  inboxDutiesMock,
  markInboxReadMock,
  officeFloorMock,
  openOrFocusMock,
  productActivityMock,
  refreshMock,
  routineCarryMock,
  routineFollowUpsMock,
  routineResolveMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  navigateMock: vi.fn(),
  issuesMock: vi.fn(),
  issueDetailMock: vi.fn(),
  inboxDutiesMock: vi.fn(),
  markInboxReadMock: vi.fn(async () => 'acknowledged'),
  officeFloorMock: vi.fn(),
  openOrFocusMock: vi.fn(),
  productActivityMock: vi.fn(),
  refreshMock: vi.fn(async () => undefined),
  routineCarryMock: vi.fn(async () => undefined),
  routineFollowUpsMock: vi.fn(),
  routineResolveMock: vi.fn(async () => undefined),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigateMock,
}))

vi.mock('./OfficeRuntimeSection', () => ({
  OfficeRuntimeSection: ({
    initialChannel,
    initialSelectedSeq,
    replaySeq,
    dutyReview,
    onConfirmDuty,
    onOpenInboxDuty,
    onReplay,
  }: {
    initialChannel?: string
    initialSelectedSeq?: number | null
    replaySeq?: number | null
    dutyReview?: {
      kind: string
      throughSeq: number
      count: number
      inboxDelivery?: { phase: 'required' | 'returned'; inboxEntryId: string }
    }
    onConfirmDuty?: () => void
    onOpenInboxDuty?: () => void
    onReplay?: (focus: {
      seq: number
      targetIds: readonly string[]
      label: string
      summary: string
      channel: 'news'
    }) => void
  }) => (
    <div
      data-testid="office-runtime-section"
      data-channel={initialChannel}
      data-selected-seq={initialSelectedSeq ?? undefined}
      data-replay-seq={replaySeq ?? undefined}
      data-duty-kind={dutyReview?.kind}
      data-duty-through-seq={dutyReview?.throughSeq}
      data-duty-count={dutyReview?.count}
      data-duty-inbox-phase={dutyReview?.inboxDelivery?.phase}
      data-duty-inbox-entry={dutyReview?.inboxDelivery?.inboxEntryId}
    >
      Office occupancy
      {dutyReview && onConfirmDuty && dutyReview.inboxDelivery?.phase !== 'required' && (
        <button type="button" onClick={onConfirmDuty}>Mock confirm duty</button>
      )}
      {dutyReview?.inboxDelivery?.phase === 'required' && onOpenInboxDuty && (
        <button type="button" onClick={onOpenInboxDuty}>Mock review exact delivery</button>
      )}
      <button
        type="button"
        onClick={() => onReplay?.({
          seq: 12,
          targetIds: ['news-service'],
          label: 'Wire',
          summary: 'Market opens',
          channel: 'news',
        })}
      >
        Mock find news on floor
      </button>
    </div>
  ),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [
      { id: 'chat-1', tag: 'chat' },
      { id: 'prediction-1', tag: 'prediction' },
    ],
    hasLoaded: true,
  }),
}))

vi.mock('../hooks/useOfficeFloor', () => ({
  useOfficeFloor: officeFloorMock,
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: issuesMock,
}))

vi.mock('../hooks/useIssueDetail', () => ({
  useIssueDetail: issueDetailMock,
}))

vi.mock('../office/useOfficeProductActivity', () => ({
  useOfficeProductActivity: productActivityMock,
}))

vi.mock('../office/useOfficeInboxDuties', () => ({
  useOfficeInboxDuties: inboxDutiesMock,
}))

vi.mock('../office/useOfficeRoutineFollowUps', () => ({
  useOfficeRoutineFollowUps: routineFollowUpsMock,
}))

const defaultOfficeFloor = () => ({
  building: {
    config: {
      workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
      harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
    },
    lastSeq: 1,
    firstSeq: 1,
    offices: [{
      workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
      lastInteractionAt: Date.now(),
      sleeping: false,
      employees: [],
    }],
  },
  loading: false,
  error: null,
  refresh: refreshMock,
})

const blockedCadenceHealth = {
  state: 'blocked',
  message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
} as const

function cadenceIssue(automationHealth: {
  readonly state: 'blocked' | 'failed' | 'healthy'
  readonly message: string
  readonly latestTaskId?: string
}) {
  return {
    id: 'weekly-review',
    title: '检查周报排期',
    what: '检查本周周报。',
    status: 'todo' as const,
    priority: 'high' as const,
    assignee: '@new-each-run',
    when: { kind: 'every' as const, every: '1w' },
    lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
    nextDueAtMs: Date.UTC(2026, 8, 7, 11),
    automationHealth,
  }
}

function cadenceIssues(
  automationHealth: Parameters<typeof cadenceIssue>[0],
  error: string | null = null,
) {
  return {
    data: {
      workspaces: [{
        wsId: 'chat-1',
        tag: 'chat',
        status: 'ok' as const,
        issues: [cadenceIssue(automationHealth)],
      }],
    },
    error,
    loading: false,
  }
}

function cadenceIssueDetail(automationHealth: Parameters<typeof cadenceIssue>[0]) {
  return {
    data: { issue: cadenceIssue(automationHealth), runs: [] },
    error: null,
    loading: false,
    mutate: vi.fn(),
  }
}

function inboxEvidence(
  id: string,
  title: string,
  ts = Date.UTC(2026, 7, 31, 12),
): OfficeInboxDutyEvidence {
  return {
    title,
    entry: {
      id,
      ts,
      workspaceId: 'chat-1',
      workspaceLabel: '研究台',
      comments: title,
      docs: [{ path: `reports/${id}.md`, revision: `rev-${id}` }],
    },
  }
}

function inboxCandidate(evidence: OfficeInboxDutyEvidence): OfficeInboxDutyCandidate {
  return inboxUnreadDutyRegistration([evidence], 'ready').candidates[0] as OfficeInboxDutyCandidate
}

function routineInboxEvidence(input: {
  id: string
  title: string
  issueId: string
  ts: number
  issueWorkspaceId?: string
  deliveryWorkspaceId?: string
}): OfficeInboxDutyEvidence {
  const evidence = inboxEvidence(input.id, input.title, input.ts)
  return {
    ...evidence,
    entry: {
      ...evidence.entry,
      workspaceId: input.deliveryWorkspaceId ?? evidence.entry.workspaceId,
      origin: {
        kind: 'headless',
        runId: `run-${input.id}`,
        issueId: input.issueId,
        issueWorkspaceId: input.issueWorkspaceId ?? 'chat-1',
      },
    },
  }
}

function healthyRoutineIssue(id: string, title: string) {
  return {
    id,
    title,
    what: `Produce ${title}.`,
    status: 'todo' as const,
    priority: 'medium' as const,
    assignee: '@new-each-run',
    when: { kind: 'every' as const, every: '1d' },
    lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
    nextDueAtMs: Date.UTC(2026, 8, 1, 11),
    automationHealth: {
      state: 'healthy' as const,
      message: 'Latest run completed.',
    },
  }
}

async function leaveCadenceDossierForFullIssue() {
  const view = render(<OfficePage />)
  await userEvent.click(screen.getByRole('button', {
    name: /本班第 1\/1 项：.*检查周报排期/,
  }))
  await screen.findByRole('dialog', { name: '检查周报排期' })
  await userEvent.click(screen.getByRole('button', { name: '复核证据' }))
  await userEvent.click(screen.getByRole('button', { name: '打开完整 Issue' }))
  view.unmount()
}

vi.mock('../tabs/store', () => ({
  useWorkspace: (select: (state: { openOrFocus: () => void }) => unknown) =>
    select({ openOrFocus: openOrFocusMock }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  officeFloorMock.mockReturnValue(defaultOfficeFloor())
  navigateMock.mockClear()
  openOrFocusMock.mockClear()
  acknowledgeMock.mockClear()
  markInboxReadMock.mockReset()
  markInboxReadMock.mockResolvedValue('acknowledged')
  routineCarryMock.mockReset()
  routineCarryMock.mockResolvedValue(undefined)
  routineResolveMock.mockReset()
  routineResolveMock.mockResolvedValue(undefined)
  routineFollowUpsMock.mockReset()
  routineFollowUpsMock.mockReturnValue({
    status: 'ready',
    followUps: [],
    carry: routineCarryMock,
    resolve: routineResolveMock,
    refresh: vi.fn(async () => undefined),
  })
  refreshMock.mockClear()
  useInboxSelection.getState().select(null)
  issuesMock.mockReturnValue({ data: { workspaces: [] }, error: null, loading: false })
  inboxDutiesMock.mockReturnValue({
    status: 'ready',
    deliveries: [],
    evidenceByEntryId: new Map(),
    markReadConfirmed: markInboxReadMock,
  })
  issueDetailMock.mockReturnValue({
    data: {
      issue: {
        id: 'weekly-review',
        title: '检查周报排期',
        what: '检查本周周报。',
        status: 'todo',
        priority: 'high',
        assignee: '@new-each-run',
        when: { kind: 'every', every: '1w' },
        lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
        nextDueAtMs: Date.UTC(2026, 8, 7, 11),
        automationHealth: {
          state: 'blocked',
          message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
        },
      },
      runs: [],
    },
    error: null,
    loading: false,
    mutate: vi.fn(),
  })
  productActivityMock.mockReturnValue({
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    pending: { agent: 0, inbox: 0, news: 0 },
    freshKind: null,
    acknowledgeThrough: acknowledgeMock,
  })
  clearOfficePlayerState()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OfficePage localization', () => {
  it('opens with an in-world receiver screen while the floor synchronizes', () => {
    officeFloorMock.mockReturnValue({
      building: null,
      loading: true,
      error: null,
      refresh: refreshMock,
    })

    const { container } = render(<OfficePage />)

    const screenState = screen.getByTestId('office-connection-screen')
    expect(screenState.getAttribute('role')).toBe('status')
    expect(screenState.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('楼层接收机')).toBeTruthy()
    expect(screen.getByText('正在同步房间、工位与 Agent 信号。')).toBeTruthy()
    expect(screenState.querySelector<HTMLImageElement>('.oa-office-connection-screen__receiver img')?.src)
      .toContain('/office/hud/signal-receiver-v2.png')
    expect(container.querySelector('.oa-office-main')).toBeTruthy()
  })

  it('offers an in-world reconnect command when the first floor request fails', async () => {
    officeFloorMock.mockReturnValue({
      building: null,
      loading: false,
      error: '503 receiver unavailable',
      refresh: refreshMock,
    })

    render(<OfficePage />)

    expect(screen.getByRole('alert').textContent).toContain('无法连接 Office 楼层')
    expect(screen.getByRole('alert').textContent).toContain('503 receiver unavailable')
    await userEvent.click(screen.getByRole('button', { name: '重新连接' }))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the last playable floor visible when a live refresh loses signal', () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      error: 'socket interrupted',
    })

    render(<OfficePage />)

    expect(screen.getByRole('img', { name: 'Office 地图上的 Alice' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('楼层信号中断')
    expect(screen.getByRole('alert').textContent).toContain('socket interrupted')
  })

  it('renders an empty Office as a game floor instead of page copy', () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 0,
        firstSeq: 0,
        offices: [],
      },
    })

    render(<OfficePage />)

    expect(screen.getByLabelText('Office 地图。拖动查看地图，使用方向键或 WASD 移动 Alice，靠近对象后按回车或空格互动。')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Office 地图上的 Alice' })).toBeTruthy()
    expect(screen.getByText('还没有 Workspace')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '所有小组' })).toBeNull()
  })

  it('restores Alice after the Office view unmounts for an excursion', async () => {
    const firstVisit = render(<OfficePage />)
    const firstAlice = screen.getByRole('img', { name: 'Office 地图上的 Alice' })
    const spawnTop = firstAlice.style.top

    fireEvent.keyDown(document.body, { key: 's' })
    await waitFor(() => expect(firstAlice.style.top).not.toBe(spawnTop))
    const rememberedTop = firstAlice.style.top
    firstVisit.unmount()

    render(<OfficePage />)
    const returnedAlice = screen.getByRole('img', { name: 'Office 地图上的 Alice' })
    expect(returnedAlice.style.top).toBe(rememberedTop)
    expect(returnedAlice.dataset.direction).toBe('down')
  })

  it('restores a coworker identity from the persistent Office cast', () => {
    window.localStorage.setItem(OFFICE_COWORKER_CAST_STORAGE_KEY, JSON.stringify({
      version: 1,
      workspaces: {
        'chat-1': { 'resume-grok': 'grok-analyst' },
      },
    }))
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees: [{
            resumeId: 'resume-grok',
            agent: 'grok',
            name: 'g8',
            title: 'Office identity QA',
            mood: 'idle' as const,
            awake: false,
            bubble: null,
            lastSeq: 1,
            lastInteractionAt: 1,
            drawers: [],
          }],
        }],
      },
    })

    render(<OfficePage />)

    expect(screen.getByTestId('office-desk-resume-grok').getAttribute('aria-label'))
      .toContain('Grok Analyst')
  })

  it('returns a map Agent file to the floor so the next action follows the nearby prompt', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees: [{
            resumeId: 'resume-codex',
            agent: 'codex',
            name: 'x1',
            title: 'Inspect the Office return loop',
            mood: 'idle' as const,
            awake: false,
            bubble: null,
            lastSeq: 1,
            lastInteractionAt: 1,
            drawers: [],
          }],
        }],
      },
    })

    render(<OfficePage />)

    const floor = screen.getByTestId('office-floor')
    await userEvent.click(screen.getByTestId('office-desk-resume-codex'))
    expect(await screen.findByRole('dialog', { name: /Codex/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    await vi.waitFor(() => expect(document.activeElement).toBe(floor))

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: /Codex/ })).toBeTruthy()
  })

  it('opens a failed coworker activity at its last event and returns to the Agent file', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 42,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees: [{
            resumeId: 'resume-grok-failed',
            agent: 'grok',
            name: 'g20',
            title: 'Inspect failed Office work',
            mood: 'failed' as const,
            awake: false,
            surface: 'headless' as const,
            bubble: null,
            lastSeq: 37,
            lastInteractionAt: 1,
            drawers: [],
          }],
        }],
      },
    })

    render(<OfficePage />)

    await userEvent.click(screen.getByTestId('office-desk-resume-grok-failed'))
    const reviewActivity = await screen.findByRole(
      'button',
      { name: '查看活动' },
      { timeout: 10_000 },
    )
    expect(document.activeElement).toBe(reviewActivity)
    await userEvent.keyboard('{Enter}')

    const runtime = screen.getByTestId('office-runtime-section')
    expect(runtime.dataset.channel).toBe('agent')
    expect(runtime.dataset.selectedSeq).toBe('37')
    expect(acknowledgeMock).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: /Grok/ })).toBeTruthy()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '查看活动' }))
    })
  })

  it('keeps an aged latest result connected to its activity evidence', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 46,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees: [{
            resumeId: 'resume-grok-complete',
            agent: 'grok',
            name: 'g29',
            title: 'Finish the Night Office visual pass',
            mood: 'idle' as const,
            awake: false,
            surface: 'headless' as const,
            bubble: null,
            latestResult: {
              text: 'NIGHT SHIFT COMPLETE.',
              at: Date.now() - 60_000,
            },
            lastSeq: 45,
            lastInteractionAt: 1,
            drawers: [],
          }],
        }],
      },
    })

    render(<OfficePage />)

    await userEvent.click(screen.getByTestId('office-desk-resume-grok-complete'))
    await screen.findByRole('dialog', { name: /Grok/ }, { timeout: 10_000 })
    expect(screen.getByText('NIGHT SHIFT COMPLETE.')).toBeTruthy()
    const reviewActivity = await screen.findByRole('button', { name: '查看活动' })
    expect(document.activeElement).toBe(reviewActivity)
    await userEvent.keyboard('{Enter}')

    const runtime = screen.getByTestId('office-runtime-section')
    expect(runtime.dataset.channel).toBe('agent')
    expect(runtime.dataset.selectedSeq).toBe('45')
    expect(acknowledgeMock).not.toHaveBeenCalled()
  })

  it('localizes the Office HUD and opens logs on request', async () => {
    const { container } = render(<OfficePage />)

    expect(screen.getByRole('heading', { name: '办公室' })).toBeTruthy()
    expect(screen.getByText('把分散的工作信号排成下一项正确行动，让该做的检查变成日常习惯。')).toBeTruthy()
    expect(screen.queryByText('Office occupancy')).toBeNull()
    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(screen.getByRole('menuitem', { name: '活动日志' }))
    expect(screen.getByText('Office occupancy')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '活动日志' }).querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/occupancy-log-v2.png')
    expect(screen.getByRole('button', { name: '关闭' }).querySelector('.oa-office-window__close-mark'))
      .toBeTruthy()
    expect(container.querySelector<HTMLImageElement>('.oa-office-replay-panel summary img')?.src)
      .toContain('/office/hud/replay-latch-v1.png')
    const replayPanel = container.querySelector<HTMLDetailsElement>('.oa-office-replay-panel')
    expect(replayPanel?.open).toBe(false)
    expect(replayPanel?.querySelector('.oa-office-replay-panel__state')?.textContent).toBe('直播')
    await userEvent.click(replayPanel!.querySelector('summary')!)
    await vi.waitFor(() => expect(replayPanel?.open).toBe(true))
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)
    fireEvent.keyDown(replayPanel!, { key: 'Escape' })
    await vi.waitFor(() => expect(replayPanel?.open).toBe(false))
    expect(screen.queryByText('Office occupancy')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByText('Office occupancy')).toBeNull())
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    const floor = screen.getByTestId('office-floor')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '活动日志' }))
    })
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.activeElement).toBe(floor))
    const alice = container.querySelector<HTMLElement>('.oa-office-alice')!
    const leftBeforeResume = alice.style.left
    await userEvent.keyboard('{ArrowRight}')
    expect(alice.style.left).not.toBe(leftBeforeResume)

    const operations = screen.getByRole('button', { name: '行动看板' })
    await userEvent.click(operations)
    await vi.waitFor(() => expect(screen.getByText('Office occupancy')).toBeTruthy())
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(operations)
    })

    const floorTerminal = screen.getByRole('button', { name: '楼层终端' })
    await userEvent.click(floorTerminal)
    expect(await screen.findByText('Office occupancy')).toBeTruthy()
    expect(screen.queryByRole('menu', { name: '菜单' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(floorTerminal)
    })
  })

  it('offers an Agent receipt only from the pending Operations duty', async () => {
    productActivityMock.mockReturnValue({
      agent: { seq: 45, occurredAt: 4_500, eventType: 'runtime.stopped' },
      inbox: null,
      news: null,
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 3, inbox: 0, news: 0 },
      freshKind: null,
      acknowledgeThrough: acknowledgeMock,
    })
    render(<OfficePage />)

    const operations = screen.getByRole('button', { name: '行动看板 · 待处理 3 条' })
    await userEvent.click(operations)
    let runtime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(runtime.dataset.channel).toBe('agent')
    expect(runtime.dataset.selectedSeq).toBe('45')
    expect(runtime.dataset.dutyKind).toBe('agent')
    expect(runtime.dataset.dutyThroughSeq).toBe('45')
    expect(runtime.dataset.dutyCount).toBe('3')
    expect(acknowledgeMock).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.activeElement).toBe(operations))
    expect(acknowledgeMock).not.toHaveBeenCalled()

    const floorTerminal = screen.getByRole('button', { name: '楼层终端' })
    await userEvent.click(floorTerminal)
    runtime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(runtime.dataset.channel).toBe('overview')
    expect(runtime.dataset.dutyKind).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Mock confirm duty' })).toBeNull()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(operations)
    await userEvent.click(await screen.findByRole('button', { name: 'Mock confirm duty' }))
    expect(acknowledgeMock).toHaveBeenCalledWith('agent', 45)
  })

  it('guides exact durable Inbox A, waits for its server receipt, then advances to B', async () => {
    const deliveryA = inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)
    const deliveryB = inboxEvidence('inbox-b', 'Risk desk follow-up', 5_200)
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [deliveryA, deliveryB],
      markReadConfirmed: markInboxReadMock,
    })
    const first = render(<OfficePage />)

    await userEvent.click(screen.getByRole('button', {
      name: /本班第 1\/2 项：.*NVDA weekly evidence brief/,
    }))
    await waitFor(() => expect(openOrFocusMock).toHaveBeenLastCalledWith({ kind: 'inbox', params: {} }), {
      timeout: 10_000,
    })
    expect(readOfficeInboxDutyExcursion()).toMatchObject({
      duty: { id: 'inbox-unread:inbox-a' },
      purpose: 'review',
      phase: 'away',
    })
    expect(useInboxSelection.getState().selectedEntryId).toBe('inbox-a')
    expect(navigateMock).toHaveBeenLastCalledWith('/office/return', {
      state: { officeExcursion: true },
    })
    expect(markInboxReadMock).not.toHaveBeenCalled()

    first.unmount()
    expect(markOfficeInboxDutyPresented({
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-a',
    })).toBe(true)

    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [deliveryA, deliveryB],
      markReadConfirmed: markInboxReadMock,
    })
    issuesMock.mockReturnValue({ data: null, error: null, loading: true })
    const returning = render(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeTruthy()
    expect(screen.getByText('Inbox 共有 2 条待阅')).toBeTruthy()
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('returned')

    markInboxReadMock.mockImplementationOnce(async () => {
      inboxDutiesMock.mockReturnValue({
        status: 'ready',
        deliveries: [deliveryB],
        markReadConfirmed: markInboxReadMock,
      })
      return 'acknowledged'
    })
    await userEvent.click(screen.getByRole('button', { name: '盖章：已复核' }))

    await waitFor(() => expect(markInboxReadMock).toHaveBeenCalledWith('inbox-a'))
    expect(acknowledgeMock).not.toHaveBeenCalledWith('inbox', expect.anything())
    expect(readOfficeInboxDutyExcursion()).toBeNull()
    issuesMock.mockReturnValue({ data: { workspaces: [] }, error: null, loading: false })
    returning.rerender(<OfficePage />)
    expect(await screen.findByRole('button', {
      name: /本班第 2\/2 项：.*Risk desk follow-up/,
    })).toBeTruthy()
    returning.unmount()
  })

  it('starts with the latest report from four distinct declared routines before older versions', async () => {
    const deliveries = [
      routineInboxEvidence({
        id: 'asia-old',
        title: 'Asia close · older report',
        issueId: 'asia-close',
        ts: 5_100,
      }),
      routineInboxEvidence({
        id: 'us-close',
        title: 'US close · latest report',
        issueId: 'us-close',
        ts: 5_200,
      }),
      routineInboxEvidence({
        id: 'metals',
        title: 'Metals watch · latest report',
        issueId: 'metals-watch',
        ts: 5_300,
      }),
      routineInboxEvidence({
        id: 'macro',
        title: 'Macro backdrop · latest report',
        issueId: 'macro-backdrop',
        ts: 5_400,
      }),
      routineInboxEvidence({
        id: 'asia-new',
        title: 'Asia close · newest report',
        issueId: 'asia-close',
        ts: 5_500,
      }),
    ]
    const routineIssues = {
      data: {
        workspaces: [{
          wsId: 'chat-1',
          tag: 'chat',
          status: 'ok',
          issues: [
            healthyRoutineIssue('asia-close', 'Asia close routine'),
            healthyRoutineIssue('us-close', 'US close routine'),
            healthyRoutineIssue('metals-watch', 'Metals watch routine'),
            healthyRoutineIssue('macro-backdrop', 'Macro backdrop routine'),
          ],
        }],
      },
      error: null,
      loading: false,
    }
    issuesMock.mockReturnValue(routineIssues)
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries,
      markReadConfirmed: markInboxReadMock,
    })

    render(<OfficePage />)

    const firstRoutine = screen.getByRole('button', {
      name: /本班第 1\/4 项：.*Asia close routine/,
    })
    expect(firstRoutine.textContent).toContain('Asia close routine')
    expect(firstRoutine.textContent).not.toContain('Asia close · older report')
    await userEvent.click(firstRoutine)

    await waitFor(() => expect(openOrFocusMock).toHaveBeenLastCalledWith({
      kind: 'inbox',
      params: {},
    }), { timeout: 10_000 })
    expect(useInboxSelection.getState().selectedEntryId).toBe('asia-new')
    expect(readOfficeInboxDutyExcursion()).toMatchObject({
      duty: {
        id: 'inbox-unread:asia-new',
        delivery: {
          declaredIssue: {
            issueId: 'asia-close',
            olderUnreadCount: 1,
          },
        },
      },
      purpose: 'review',
      phase: 'away',
    })
    expect(markInboxReadMock).not.toHaveBeenCalled()
  })

  it('persists an exact cross-Workspace decision carry before filing the report receipt', async () => {
    const delivery = routineInboxEvidence({
      id: 'cross-workspace-report',
      title: '跨台例行报告',
      issueId: 'weekly-cross-asset',
      issueWorkspaceId: 'issue-home',
      deliveryWorkspaceId: 'execution-desk',
      ts: 5_600,
    })
    const crossWorkspaceIssues = {
      data: {
        workspaces: [{
          wsId: 'issue-home',
          tag: 'macro',
          status: 'ok',
          issues: [healthyRoutineIssue('weekly-cross-asset', '每周跨资产复核')],
        }],
      },
      error: null,
      loading: false,
    }
    issuesMock.mockReturnValue(crossWorkspaceIssues)
    let carried = false
    routineFollowUpsMock.mockImplementation(() => ({
      status: 'ready',
      followUps: carried ? [{
        inboxEntryId: 'cross-workspace-report',
        reportTs: 5_600,
        issueWorkspaceId: 'issue-home',
        issueId: 'weekly-cross-asset',
        createdAt: 5_700,
      }] : [],
      carry: routineCarryMock,
      resolve: routineResolveMock,
      refresh: vi.fn(async () => undefined),
    }))
    routineCarryMock.mockImplementationOnce(async () => {
      carried = true
    })
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [delivery],
      evidenceByEntryId: new Map([['cross-workspace-report', delivery]]),
      markReadConfirmed: markInboxReadMock,
    })
    markInboxReadMock.mockImplementationOnce(async () => {
      inboxDutiesMock.mockReturnValue({
        status: 'ready',
        deliveries: [],
        evidenceByEntryId: new Map([['cross-workspace-report', {
          ...delivery,
          entry: { ...delivery.entry, readAt: 5_800 },
        }]]),
        markReadConfirmed: markInboxReadMock,
      })
      return 'acknowledged'
    })

    const first = render(<OfficePage />)
    await userEvent.click(screen.getByRole('button', {
      name: /本班第 1\/1 项：.*每周跨资产复核/,
    }))
    await waitFor(() => expect(openOrFocusMock).toHaveBeenLastCalledWith({
      kind: 'inbox',
      params: {},
    }), { timeout: 10_000 })
    expect(readOfficeInboxDutyExcursion()).toMatchObject({
      purpose: 'review',
      phase: 'away',
      duty: { id: 'inbox-unread:cross-workspace-report' },
    })
    first.unmount()

    expect(markOfficeInboxDutyPresented({
      workspaceId: 'execution-desk',
      inboxEntryId: 'cross-workspace-report',
    })).toBe(true)
    issuesMock.mockReturnValue({ data: null, error: null, loading: true })
    const returnedFromReport = render(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: '跨台例行报告' })).toBeTruthy()
    expect(screen.getByText(
      '正在核对定时任务。带入决策台需要等待；“没有变化”仍可确认。',
    )).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '决定下一步' }))
    expect(screen.getByRole('button', { name: '带到决策台' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '没有变化 · 标记已复核' }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '返回' }))

    issuesMock.mockReturnValue(crossWorkspaceIssues)
    returnedFromReport.rerender(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: '跨台例行报告' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '决定下一步' }))
    await userEvent.click(screen.getByRole('button', { name: '带到决策台' }))

    await waitFor(() => expect(routineCarryMock).toHaveBeenCalledWith('cross-workspace-report'))
    await waitFor(() => expect(markInboxReadMock).toHaveBeenCalledWith('cross-workspace-report'))
    expect(routineCarryMock.mock.invocationCallOrder[0])
      .toBeLessThan(markInboxReadMock.mock.invocationCallOrder[0]!)
    expect(openOrFocusMock).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'issue-detail',
    }))
    expect(readOfficeInboxDutyExcursion()).toBeNull()
    expect(screen.queryByRole('dialog', { name: '跨台例行报告' })).toBeNull()
    expect(routineResolveMock).not.toHaveBeenCalled()

    const decisionDuty = await screen.findByRole('button', {
      name: '决策台 · 1 项待处理',
    })
    await userEvent.click(decisionDuty)
    expect(await screen.findByRole('dialog', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '处理已带入的跟进' })).toBeTruthy()
    expect(screen.getByText('跨台例行报告')).toBeTruthy()
    expect(screen.getByText('研究台')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '打开准确报告' }))
    expect(useInboxSelection.getState().selectedEntryId).toBe('cross-workspace-report')
    expect(openOrFocusMock).toHaveBeenLastCalledWith({ kind: 'inbox', params: {} })
    expect(routineResolveMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', {
      name: '决策台 · 1 项待处理',
    }))
    expect(await screen.findByRole('dialog', {}, { timeout: 10_000 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '打开准确 Issue' }))
    expect(openOrFocusMock).toHaveBeenLastCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'issue-home', id: 'weekly-cross-asset' },
    })
    expect(routineResolveMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', {
      name: '决策台 · 1 项待处理',
    }))
    expect(await screen.findByRole('dialog', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '处理已带入的跟进' })).toBeTruthy()
    routineResolveMock.mockImplementationOnce(async () => {
      carried = false
    })
    await userEvent.click(screen.getByRole('button', { name: '判断已完成 · 移出决策台' }))
    await waitFor(() => expect(routineResolveMock).toHaveBeenCalledWith('cross-workspace-report'))
    returnedFromReport.rerender(<OfficePage />)
    expect(await screen.findByText('决策台已清空')).toBeTruthy()
    returnedFromReport.unmount()
  }, 15_000)

  it('recovers a saved carry without allowing a contradictory no-change receipt', async () => {
    const delivery = routineInboxEvidence({
      id: 'recover-carry-report',
      title: '需要恢复交接的报告',
      issueId: 'recover-carry-issue',
      ts: 6_000,
    })
    const captured = inboxCandidate(delivery)
    const dutyWithRoutine: OfficeInboxDutyCandidate = {
      ...captured,
      delivery: {
        ...captured.delivery,
        declaredIssue: {
          workspaceId: 'chat-1',
          issueId: 'recover-carry-issue',
          title: '恢复交接例行任务',
          priority: 'high',
          nextDueAtMs: 7_000,
          unreadSiblingCount: 0,
          olderUnreadCount: 0,
        },
      },
    }
    rememberOfficeInboxDutyExcursion({
      duty: dutyWithRoutine,
      purpose: 'review',
      phase: 'presented',
    })
    issuesMock.mockReturnValue({
      data: {
        workspaces: [{
          wsId: 'chat-1',
          tag: 'chat',
          status: 'ok',
          issues: [healthyRoutineIssue('recover-carry-issue', '恢复交接例行任务')],
        }],
      },
      error: null,
      loading: false,
    })
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [delivery],
      markReadConfirmed: markInboxReadMock,
    })

    let carried = false
    routineFollowUpsMock.mockImplementation(() => ({
      status: 'ready',
      followUps: carried ? [{
        inboxEntryId: 'recover-carry-report',
        reportTs: 6_000,
        issueWorkspaceId: 'chat-1',
        issueId: 'recover-carry-issue',
        createdAt: 6_100,
      }] : [],
      carry: routineCarryMock,
      resolve: routineResolveMock,
      refresh: vi.fn(async () => undefined),
    }))
    routineCarryMock.mockImplementation(async () => {
      carried = true
    })
    markInboxReadMock
      .mockRejectedValueOnce(new Error('receipt temporarily unavailable'))
      .mockImplementationOnce(async () => {
        inboxDutiesMock.mockReturnValue({
          status: 'ready',
          deliveries: [],
          markReadConfirmed: markInboxReadMock,
        })
        return 'acknowledged'
      })

    const view = render(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: '需要恢复交接的报告' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '决定下一步' }))
    await userEvent.click(screen.getByRole('button', { name: '带到决策台' }))
    expect((await screen.findByRole('alert')).textContent).toContain('尚未完成')

    view.unmount()
    issuesMock.mockReturnValue({ data: null, error: null, loading: true })
    render(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: '需要恢复交接的报告' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('决策台已保留这份报告')
    expect(screen.queryByRole('button', { name: '没有变化 · 标记已复核' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '完成交接 · 标记已复核' }))
    const finishRecovery = screen.getByRole('button', { name: '完成交接 · 标记已复核' })
    expect(finishRecovery.hasAttribute('disabled')).toBe(false)
    await userEvent.click(finishRecovery)

    await waitFor(() => expect(routineCarryMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(markInboxReadMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: '需要恢复交接的报告' })).toBeNull()
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })

  it('advances an externally resolved Inbox duty without forging a reviewed receipt', async () => {
    const delivery = inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)
    rememberOfficeInboxDutyExcursion({
      duty: inboxCandidate(delivery),
      purpose: 'review',
      phase: 'presented',
    })
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [delivery],
      markReadConfirmed: markInboxReadMock,
    })
    markInboxReadMock.mockImplementationOnce(async () => {
      inboxDutiesMock.mockReturnValue({
        status: 'ready',
        deliveries: [],
        markReadConfirmed: markInboxReadMock,
      })
      return 'already-resolved'
    })
    render(<OfficePage />)

    expect(await screen.findByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '盖章：已复核' }))

    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'NVDA weekly evidence brief',
    })).toBeNull())
    expect(markInboxReadMock).toHaveBeenCalledWith('inbox-a')
    expect(document.querySelector('.oa-office-landmark-ack')).toBeNull()
    expect(document.querySelector('.oa-office-page > p[role="status"]')).toBeNull()
    expect(screen.getByText('值班已清')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('office-floor')))
  })

  it('dismisses a returned durable Inbox duty on Escape without changing its order or read state', async () => {
    const delivery = inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)
    rememberOfficeInboxDutyExcursion({
      duty: inboxCandidate(delivery),
      purpose: 'review',
      phase: 'presented',
    })
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [delivery],
      markReadConfirmed: markInboxReadMock,
    })
    render(<OfficePage />)

    expect(await screen.findByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeNull()
    expect(readOfficeInboxDutyExcursion()).toBeNull()
    expect(markInboxReadMock).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', {
        name: 'Inbox 收件台 · 待处理 1 条',
      }))
    })
    expect(screen.getByRole('button', {
      name: /本班第 1\/1 项：.*NVDA weekly evidence brief/,
    })).toBeTruthy()
  })

  it('rotates a returned Inbox duty to the end on Later without marking it read', async () => {
    const deliveryA = inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)
    const deliveryB = inboxEvidence('inbox-b', 'Risk desk follow-up', 5_200)
    rememberOfficeInboxDutyExcursion({
      duty: inboxCandidate(deliveryA),
      purpose: 'review',
      phase: 'presented',
    })
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [deliveryA, deliveryB],
      markReadConfirmed: markInboxReadMock,
    })
    render(<OfficePage />)

    expect(await screen.findByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '稍后处理' }))

    expect(screen.queryByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeNull()
    expect(markInboxReadMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', {
      name: /本班第 1\/2 项：.*Risk desk follow-up/,
    })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inbox 收件台 · 待处理 2 条' })).toBeTruthy()
  })

  it('guides a scheduled Issue exception through evidence and an explicit Office receipt', async () => {
    issuesMock.mockReturnValue({
      data: {
        workspaces: [{
          wsId: 'chat-1',
          tag: 'chat',
          status: 'ok',
          issues: [{
            id: 'weekly-review',
            title: '检查周报排期',
            status: 'todo',
            priority: 'high',
            assignee: '@new-each-run',
            when: { kind: 'every', every: '1w' },
            lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
            nextDueAtMs: Date.UTC(2026, 8, 7, 11),
            automationHealth: {
              state: 'blocked',
              message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
            },
          }],
        }],
      },
      error: null,
      loading: false,
    })

    const view = render(<OfficePage />)

    const operations = screen.getByRole('button', { name: '行动看板 · 待处理 1 条' })
    await userEvent.click(operations)
    expect(await screen.findByRole('dialog', { name: '检查周报排期' }, { timeout: 10_000 })).toBeTruthy()
    expect(view.container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    expect(acknowledgeMock).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull()

    await userEvent.click(screen.getByRole('button', {
      name: /本班第 1\/1 项：.*检查周报排期/,
    }))
    await screen.findByRole('dialog', { name: '检查周报排期' })

    await userEvent.click(screen.getByRole('button', { name: '复核证据' }))
    expect(screen.getByText('检查本周周报。')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '打开完整 Issue' }))
    expect(navigateMock).toHaveBeenCalledWith('/office/return', {
      state: { officeExcursion: true },
    })
    expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'chat-1', id: 'weekly-review' },
    })
    expect(acknowledgeMock).not.toHaveBeenCalled()
    view.unmount()
    render(<OfficePage />)
    expect(await screen.findByRole('dialog', { name: '检查周报排期' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '第 2 步 · 证据' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '盖章：本次值班已复核' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull())
    expect(screen.getByRole('button', {
      name: '本班已复核，仍有 1 项定时 Issue 未解决。跟进 chat 的“检查周报排期”。',
    })).toBeTruthy()
    expect(screen.getByText('已复核')).toBeTruthy()
    expect(screen.getByText(
      '已复核“检查周报排期”。本班完成；仍有 1 项定时 Issue 待跟进。',
    )).toBeTruthy()
    expect(acknowledgeMock).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('openalice:office-duty:evidence-receipts:v2'))
      .toContain('weekly-review')
  })

  it('keeps a reviewed cadence exception as an exact follow-up without stealing the active Inbox duty', async () => {
    const delivery = inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)
    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(blockedCadenceHealth))
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [delivery],
      markReadConfirmed: markInboxReadMock,
    })
    const view = render(<OfficePage />)

    await userEvent.click(screen.getByRole('button', {
      name: /本班第 1\/2 项：.*检查周报排期/,
    }))
    await screen.findByRole('dialog', { name: '检查周报排期' })
    await userEvent.click(screen.getByRole('button', { name: '复核证据' }))
    await userEvent.click(screen.getByRole('button', { name: '盖章：本次值班已复核' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull())
    expect(screen.getByRole('button', {
      name: /本班第 2\/2 项：.*NVDA weekly evidence brief/,
    })).toBeTruthy()
    expect(markInboxReadMock).not.toHaveBeenCalled()
    const receiptAfterReview = window.sessionStorage.getItem(
      'openalice:office-duty:evidence-receipts:v2',
    )
    expect(receiptAfterReview).toContain('weekly-review')

    openOrFocusMock.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /行动看板/ }))
    await waitFor(() => expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'chat-1', id: 'weekly-review' },
    }))
    expect(screen.queryByRole('dialog', { name: '活动日志' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull()
    expect(window.sessionStorage.getItem('openalice:office-duty:evidence-receipts:v2'))
      .toBe(receiptAfterReview)
    expect(markInboxReadMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', {
      name: /本班第 2\/2 项：.*NVDA weekly evidence brief/,
    })).toBeTruthy()

    const healthy = { state: 'healthy', message: 'Schedule healthy.' } as const
    issuesMock.mockReturnValue(cadenceIssues(healthy))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(healthy))
    openOrFocusMock.mockClear()
    view.rerender(<OfficePage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '行动看板' })).toBeTruthy()
    })
    await userEvent.click(screen.getByRole('button', { name: '行动看板' }))
    expect(await screen.findByRole('dialog', { name: '活动日志' })).toBeTruthy()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(markInboxReadMock).not.toHaveBeenCalled()
  })

  it('hands a deferred cadence duty to Inbox without letting Operations bypass the shift lead', async () => {
    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth))
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      deliveries: [inboxEvidence('inbox-a', 'NVDA weekly evidence brief', 5_100)],
      markReadConfirmed: markInboxReadMock,
    })
    render(<OfficePage />)

    await userEvent.click(screen.getByRole('button', {
      name: /本班第 1\/2 项：.*检查周报排期/,
    }))
    await screen.findByRole('dialog', { name: '检查周报排期' })
    await userEvent.click(screen.getByRole('button', { name: '稍后处理' }))

    expect(screen.getByRole('button', {
      name: /本班第 1\/2 项：.*NVDA weekly evidence brief/,
    })).toBeTruthy()
    const operationsPrompt = document.querySelector<HTMLElement>(
      '.oa-office-interaction-prompt[data-kind="operations"]',
    )
    expect(operationsPrompt?.textContent ?? '').not.toContain('检查周报排期')
    expect(screen.getByTestId('office-duty-target-beacon').dataset.kind).toBe('inbox-service')
    expect(screen.getByText(
      '已将“检查周报排期”排到本班稍后。下一项是“NVDA weekly evidence brief”，进度仍为 1/2。',
    )).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('office-floor')))

    await userEvent.click(screen.getByRole('button', { name: '行动看板 · 待处理 1 条' }))
    expect(await screen.findByRole('dialog', { name: '活动日志' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull()
    const runtime = screen.getByTestId('office-runtime-section')
    expect(runtime.dataset.channel).toBe('overview')
    expect(runtime.dataset.dutyKind).toBeUndefined()
    expect(markInboxReadMock).not.toHaveBeenCalled()
  })

  it('returns from a full Issue to the captured evidence when the live exception changed', async () => {
    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(blockedCadenceHealth))
    await leaveCadenceDossierForFullIssue()

    const changedHealth = {
      state: 'failed',
      message: 'Latest scheduled run failed.',
      latestTaskId: 'run-b',
    } as const
    issuesMock.mockReturnValue(cadenceIssues(changedHealth))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(changedHealth))
    render(<OfficePage />)

    expect(await screen.findByRole('heading', { name: '第 2 步 · 证据' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('证据已变化')
    expect(screen.queryByRole('button', { name: '盖章：本次值班已复核' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '复核最新证据' }))
    expect(screen.queryByText(/证据已变化/)).toBeNull()
    expect(screen.getByRole('button', { name: '盖章：本次值班已复核' })).toBeTruthy()
  })

  it('returns from a full Issue with an explicit resolved state instead of dropping the dossier', async () => {
    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(blockedCadenceHealth))
    await leaveCadenceDossierForFullIssue()

    const healthy = { state: 'healthy', message: 'Schedule healthy.' } as const
    issuesMock.mockReturnValue(cadenceIssues(healthy))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(healthy))
    render(<OfficePage />)

    expect(await screen.findByRole('heading', { name: '第 2 步 · 证据' })).toBeTruthy()
    expect(screen.getByText('这个 Issue 已不再是定时异常。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '盖章：本次值班已复核' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '返回下一值班项' }))
    expect(screen.queryByRole('dialog', { name: '检查周报排期' })).toBeNull()
    expect(screen.getByText('值班已清')).toBeTruthy()
  })

  it('restores captured evidence but refuses a receipt while the cadence source is stale', async () => {
    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth))
    issueDetailMock.mockReturnValue(cadenceIssueDetail(blockedCadenceHealth))
    await leaveCadenceDossierForFullIssue()

    issuesMock.mockReturnValue(cadenceIssues(blockedCadenceHealth, 'scanner unavailable'))
    render(<OfficePage />)

    expect(await screen.findByRole('heading', { name: '第 2 步 · 证据' })).toBeTruthy()
    expect(screen.getByText('Issue 信号不可用，这份证据可能已过时；当前无法确认值班已清。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '盖章：本次值班已复核' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('keeps exact visible Agent activity ambient instead of turning it into mandatory shift work', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 45,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees: [{
            resumeId: 'resume-grok-duty',
            agent: 'grok',
            name: 'g18',
            title: 'Deliver the Office duty result',
            mood: 'idle' as const,
            awake: false,
            bubble: null,
            lastSeq: 45,
            lastInteractionAt: 4_500,
            drawers: [],
          }],
        }],
      },
    })
    productActivityMock.mockReturnValue({
      agent: {
        seq: 45,
        occurredAt: 4_500,
        eventType: 'runtime.stopped',
        status: 'done',
        subject: {
          kind: 'session',
          workspaceId: 'chat-1',
          resumeId: 'resume-grok-duty',
        },
      },
      inbox: null,
      news: null,
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 3, inbox: 0, news: 0 },
      freshKind: null,
      acknowledgeThrough: acknowledgeMock,
    })
    render(<OfficePage />)

    expect(screen.getByText('本班暂无到期功课')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /本班第 .* 项/ })).toBeNull()

    await userEvent.click(screen.getByTestId('office-desk-resume-grok-duty'))
    const file = await screen.findByRole('dialog', { name: /Grok/ }, { timeout: 10_000 })
    expect(file.querySelector<HTMLElement>('.oa-office-inspect__actions')?.dataset.dutyPending)
      .toBe('true')
    expect(screen.getByRole('button', { name: '复核这次结果' })).toBeTruthy()
    expect(acknowledgeMock).not.toHaveBeenCalled()
  })

  it('keeps ambient Inbox and News station visits inside the Office journal', async () => {
    productActivityMock.mockReturnValue({
      agent: null,
      inbox: { seq: 11, occurredAt: 1_100, inboxEntryId: 'inbox-11' },
      news: { seq: 12, occurredAt: 1_200 },
      attention: { agent: false, inbox: true, news: true },
      pending: { agent: 0, inbox: 1, news: 2 },
      freshKind: 'news',
      acknowledgeThrough: acknowledgeMock,
    })
    const { container } = render(<OfficePage />)

    const inbox = screen.getByRole('button', { name: 'Inbox 收件台' })
    await userEvent.click(inbox)
    const runtime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(runtime.dataset.channel).toBe('inbox')
    expect(runtime.dataset.selectedSeq).toBe('11')
    expect(runtime.dataset.dutyKind).toBeUndefined()
    expect(runtime.dataset.dutyThroughSeq).toBeUndefined()
    expect(runtime.dataset.dutyCount).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Mock confirm duty' })).toBeNull()
    expect(acknowledgeMock).not.toHaveBeenCalled()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)

    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.activeElement).toBe(inbox))

    const news = screen.getByRole('button', { name: '新闻终端' })
    await userEvent.click(news)
    const newsRuntime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(newsRuntime.dataset.channel).toBe('news')
    expect(newsRuntime.dataset.selectedSeq).toBe('12')
    expect(newsRuntime.dataset.dutyKind).toBeUndefined()
    expect(newsRuntime.dataset.dutyThroughSeq).toBeUndefined()
    expect(newsRuntime.dataset.dutyCount).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Mock confirm duty' })).toBeNull()
    expect(acknowledgeMock).not.toHaveBeenCalled()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()

    const focusedNewsRow = screen.getByRole('button', { name: 'Mock find news on floor' })
    focusedNewsRow.focus()
    await userEvent.keyboard('{ArrowDown}{Escape}')
    await vi.waitFor(() => expect(screen.queryByTestId('office-runtime-section')).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(news))
  })

  it('reopens the exact replayed event and channel from the Operations board', async () => {
    const { container } = render(<OfficePage />)

    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(await screen.findByRole('menuitem', { name: '活动日志' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mock find news on floor' }))

    expect(container.querySelector<HTMLElement>('[data-replay="true"]')).toBeTruthy()
    expect(screen.queryByRole('menu', { name: '菜单' })).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('office-floor')))
    await userEvent.click(screen.getByRole('button', { name: '行动看板' }))

    const runtime = await screen.findByTestId('office-runtime-section')
    expect(runtime.dataset.channel).toBe('news')
    expect(runtime.dataset.selectedSeq).toBe('12')
    const replayPanel = container.querySelector<HTMLDetailsElement>('.oa-office-replay-panel')
    expect(replayPanel?.open).toBe(true)
    expect(replayPanel?.querySelector('.oa-office-replay-panel__state')?.textContent).toBe('序号 12')
  })

  it('does not offer an empty Replay drawer before the floor has history', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 0,
        firstSeq: 0,
      },
    })
    const { container } = render(<OfficePage />)

    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(await screen.findByRole('menuitem', { name: '活动日志' }))

    expect(container.querySelector('.oa-office-replay-panel')).toBeNull()
  })

  it('enters from the Workspace sign while keeping filed records on the cabinet', async () => {
    const { container } = render(<OfficePage />)

    const sign = screen.getByRole('button', { name: /进入 chat Workspace/ })
    await userEvent.click(sign)
    await vi.waitFor(() => expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1', source: 'chat' },
    }))
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenLastCalledWith('/office/return', {
      state: { officeExcursion: true },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(false)

    openOrFocusMock.mockClear()
    const cabinet = screen.getByRole('button', { name: '档案柜 · chat' })
    await userEvent.click(cabinet)
    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: '档案柜 · chat' })).toBeTruthy()
    }, { timeout: 10_000 })
    expect(screen.getByText('这里还没有归档任何工位记录。')).toBeTruthy()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '档案柜 · chat' })).toBeNull()
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cabinet)
    })

    await userEvent.click(cabinet)
    await userEvent.click(await screen.findByRole('button', { name: '进入 Workspace 文件' }))
    expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1', source: 'chat' },
    })
    expect(navigateMock).toHaveBeenCalledTimes(2)
  })

  it('enters Prediction through its own Workspace source', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          workspace: { id: 'prediction-1', tag: 'prediction', harness: 'prediction' },
          lastInteractionAt: Date.now(),
          sleeping: false,
          employees: [],
        }],
      },
    })

    render(<OfficePage />)
    await userEvent.click(screen.getByRole('button', { name: /进入 prediction Workspace/ }))

    await vi.waitFor(() => expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'prediction-1', source: 'prediction' },
    }))
  })

  it('returns from an Agent file to the originating roster member', async () => {
    const employees = Array.from({ length: 6 }, (_, index) => ({
      resumeId: `resume-${index}`,
      agent: index % 2 === 0 ? 'codex' : 'claude',
      name: `x${index + 1}`,
      title: `研究同事 ${index + 1}`,
      mood: index < 2 ? 'working' as const : 'idle' as const,
      bubble: null,
      lastSeq: 1,
      lastInteractionAt: 1,
      drawers: [],
    }))
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees,
        }],
      },
    })

    const { container } = render(<OfficePage />)

    const rosterBoard = screen.getByRole('button', { name: '小组名册 · chat · 还有 2 位同事' })
    await userEvent.click(rosterBoard)
    expect(screen.getByRole('dialog', { name: '小组名册 · chat' })).toBeTruthy()
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)

    const member = screen.getByRole('button', { name: /Claude.*x2.*研究同事 2/i })
    await userEvent.click(member)
    expect(screen.getByRole('dialog', { name: 'Claude' })).toBeTruthy()
    expect(screen.getByText('当前委托')).toBeTruthy()
    expect(screen.getByText('研究同事 2')).toBeTruthy()
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)
    const back = screen.getByRole('button', { name: '返回小组名册' })
    expect(back.querySelector('img')?.getAttribute('src')).toBe('/office/hud/window-back-v2.png')

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '小组名册 · chat' })).toBeTruthy()
    const restoredMember = screen.getByRole('button', { name: /Claude.*x2.*研究同事 2/i })
    expect(document.activeElement).toBe(restoredMember)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rosterBoard)
    })
  })
})
