// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OfficeBuildingSnapshot } from '../api/office'
import { i18n } from '../i18n'
import { nextOfficeDuty, OfficeBuilding, officeRouteStatusEdge } from './OfficeBuilding'
import { officeCoworkerSpriteForAgent } from './coworker-sprites'
import { officeCoworkerCallsign } from './label'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

describe('OfficeBuilding', () => {
  it('turns pending product activity into one ordered next duty', () => {
    const activity = {
      agent: null,
      inbox: null,
      news: null,
      attention: { agent: true, inbox: true, news: true },
      pending: { agent: 2, inbox: 1, news: 9 },
      freshKind: null,
    }

    expect(nextOfficeDuty(activity)).toEqual({
      kind: 'inbox',
      targetId: 'inbox-service',
      count: 1,
    })
    expect(nextOfficeDuty({
      ...activity,
      attention: { ...activity.attention, inbox: false },
    })).toEqual({
      kind: 'agent',
      targetId: 'operations',
      count: 2,
    })
    expect(nextOfficeDuty({
      ...activity,
      attention: { agent: false, inbox: false, news: false },
    })).toBeNull()
  })

  it('routes Agent review to an exact visible session and otherwise falls back to Operations', () => {
    const activity = {
      agent: {
        seq: 45,
        occurredAt: 4_500,
        subject: {
          kind: 'session' as const,
          workspaceId: 'chat-1',
          resumeId: 'resume-grok',
        },
      },
      inbox: null,
      news: null,
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 3, inbox: 0, news: 0 },
      freshKind: null,
    }
    const exactTarget = 'employee:chat-1:resume-grok'

    expect(nextOfficeDuty(activity, (targetId) => targetId === exactTarget)).toEqual({
      kind: 'agent',
      targetId: exactTarget,
      count: 3,
    })
    expect(nextOfficeDuty(activity, (targetId) => targetId === 'employee:other:resume-grok'))
      .toEqual({ kind: 'agent', targetId: 'operations', count: 3 })
    expect(nextOfficeDuty({
      ...activity,
      agent: { seq: 45, occurredAt: 4_500 },
    }, () => true)).toEqual({ kind: 'agent', targetId: 'operations', count: 3 })
  })

  it('walks the Agent duty to its visible coworker and returns the receipt to that desk', async () => {
    const employee = {
      resumeId: 'resume-duty-grok',
      agent: 'grok',
      name: 'g17',
      title: 'Review the latest Office result',
      awake: false,
      mood: 'review' as const,
      bubble: null,
      latestResult: { text: 'Duty result', at: 4_500 },
      lastSeq: 45,
      lastInteractionAt: 4_500,
      drawers: [],
    }
    const building = {
      config: {
        workspaceSleepAfterMs: 1,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 0, prediction: 0, other: 0 },
      },
      lastSeq: 45,
      firstSeq: 1,
      offices: [{
        workspace: { id: 'chat-duty', tag: 'chat', harness: 'chat' as const },
        lastInteractionAt: 4_500,
        sleeping: false,
        employees: [employee],
      }],
    }
    const activity = {
      agent: {
        seq: 45,
        occurredAt: 4_500,
        eventType: 'runtime.stopped' as const,
        status: 'done' as const,
        subject: {
          kind: 'session' as const,
          workspaceId: 'chat-duty',
          resumeId: 'resume-duty-grok',
        },
      },
      inbox: null,
      news: null,
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 3, inbox: 0, news: 0 },
      freshKind: null,
    }
    const onSelectEmployee = vi.fn()
    const props = {
      building,
      productActivity: activity,
      onSelectEmployee,
      onOpenEmployee: vi.fn(),
      onOpenWorkspace: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenRoster: vi.fn(),
      onOpenLog: vi.fn(),
    }
    const view = render(<OfficeBuilding {...props} />)

    const duty = screen.getByRole('button', { name: /Next duty: .*3 pending/ })
    expect(duty.textContent).not.toContain('Operations board')
    await userEvent.click(duty)
    await waitFor(() => expect(onSelectEmployee).toHaveBeenCalledWith(
      'chat-duty',
      expect.objectContaining({ resumeId: 'resume-duty-grok' }),
    ), { timeout: 5_000 })

    view.rerender(<OfficeBuilding {...props} interactionSuspended />)
    view.rerender(
      <OfficeBuilding
        {...props}
        productActivity={{
          ...activity,
          attention: { ...activity.attention, agent: false },
        }}
      />,
    )
    const desk = screen.getByTestId('office-desk-resume-duty-grok')
    await waitFor(() => expect(desk.dataset.acknowledged).toBe('true'))
    expect(desk.querySelector('.oa-office-landmark-ack')?.textContent).toBe('OK')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps a hidden fifth Agent duty on Operations without reassigning visible desks', () => {
    const employees = Array.from({ length: 5 }, (_, index) => ({
      resumeId: `resume-${index}`,
      agent: 'grok',
      name: `g${index + 1}`,
      title: `Session ${index + 1}`,
      awake: false,
      mood: 'idle' as const,
      bubble: null,
      lastSeq: 45,
      lastInteractionAt: 4_500 - index,
      drawers: [],
    }))
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 45,
          firstSeq: 1,
          offices: [{
            workspace: { id: 'chat-full', tag: 'chat', harness: 'chat' },
            lastInteractionAt: 4_500,
            sleeping: false,
            employees,
          }],
        }}
        productActivity={{
          agent: {
            seq: 45,
            occurredAt: 4_500,
            subject: {
              kind: 'session',
              workspaceId: 'chat-full',
              resumeId: 'resume-4',
            },
          },
          inbox: null,
          news: null,
          attention: { agent: true, inbox: false, news: false },
          pending: { agent: 1, inbox: 0, news: 0 },
          freshKind: null,
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId(/^office-desk-/)).toHaveLength(4)
    expect(screen.queryByTestId('office-desk-resume-4')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next duty: Operations board, 1 pending' }))
      .toBeTruthy()
  })

  it('falls back to Operations when an Agent duty coworker leaves during auto-walk', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    try {
      const employee = {
        resumeId: 'resume-departing-duty',
        agent: 'grok',
        name: 'g19',
        title: 'Depart during route',
        awake: false,
        mood: 'review' as const,
        bubble: null,
        lastSeq: 45,
        lastInteractionAt: 4_500,
        drawers: [],
      }
      const office = {
        workspace: { id: 'chat-duty', tag: 'chat', harness: 'chat' as const },
        lastInteractionAt: 4_500,
        sleeping: false,
        employees: [employee],
      }
      const building = {
        config: {
          workspaceSleepAfterMs: 1,
          harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 0, prediction: 0, other: 0 },
        },
        lastSeq: 45,
        firstSeq: 1,
        offices: [office],
      }
      const productActivity = {
        agent: {
          seq: 45,
          occurredAt: 4_500,
          subject: {
            kind: 'session' as const,
            workspaceId: 'chat-duty',
            resumeId: 'resume-departing-duty',
          },
        },
        inbox: null,
        news: null,
        attention: { agent: true, inbox: false, news: false },
        pending: { agent: 1, inbox: 0, news: 0 },
        freshKind: null,
      }
      const onSelectEmployee = vi.fn()
      const onOpenLog = vi.fn()
      const props = {
        building,
        productActivity,
        initialPlayerState: { position: { x: 480, y: 600 }, direction: 'up' as const },
        onSelectEmployee,
        onOpenEmployee: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onOpenFiles: vi.fn(),
        onOpenRoster: vi.fn(),
        onOpenLog,
      }
      const view = render(<OfficeBuilding {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /Next duty:/ }))
      expect(screen.getByTestId('office-route-status')).toBeTruthy()
      view.rerender(
        <OfficeBuilding
          {...props}
          building={{ ...building, offices: [{ ...office, employees: [] }] }}
        />,
      )
      act(() => vi.advanceTimersByTime(5_000))

      expect(onSelectEmployee).not.toHaveBeenCalled()
      expect(onOpenLog).toHaveBeenCalledWith('operations')
    } finally {
      vi.useRealTimers()
    }
  })

  it('claims the initial keyboard focus so the first direction key enters the game', async () => {
    const onOpenLog = vi.fn()
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 0,
          firstSeq: 0,
          offices: [],
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={onOpenLog}
      />,
    )

    const floor = screen.getByTestId('office-floor')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(document.activeElement).toBe(floor)
    const topBeforeMove = alice.style.top
    await userEvent.keyboard('{ArrowDown}')
    expect(alice.style.top).not.toBe(topBeforeMove)
    await userEvent.keyboard('{Escape}')
    const activityLog = screen.getByRole('menuitem', { name: 'Activity log' })
    await waitFor(() => expect(document.activeElement).toBe(activityLog))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(onOpenLog).toHaveBeenCalledWith('menu')
  })

  it('keeps historical floors visibly in replay mode with a direct return to Live', async () => {
    const onReturnLive = vi.fn()
    const onSelectEmployee = vi.fn()
    const onOpenWorkspace = vi.fn()
    const onOpenFiles = vi.fn()
    const onOpenRoster = vi.fn()
    const onOpenLog = vi.fn()
    const { container } = render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
          },
          lastSeq: 6,
          firstSeq: 1,
          asOfSeq: 2,
          offices: [{
            workspace: { id: 'chat-replay', tag: 'chat', harness: 'chat' },
            lastInteractionAt: 1,
            sleeping: false,
            employees: Array.from({ length: 6 }, (_, index) => ({
              resumeId: `resume-${index}`,
              agent: 'codex',
              name: `x${index + 1}`,
              title: `Session ${index + 1}`,
              awake: index < 2,
              mood: index < 2 ? 'working' as const : 'idle' as const,
              bubble: null,
              lastSeq: 2,
              lastInteractionAt: 1,
              drawers: [],
            })),
          }],
        }}
        replaySeq={2}
        replayFocus={{
          seq: 2,
          workspaceId: 'chat-replay',
          resumeId: 'resume-5',
          targetIds: [
            'employee:chat-replay:resume-5',
            'roster:chat-replay',
            'sign:chat-replay',
          ],
          label: 'Session 6',
          summary: 'Earlier Session completed its assignment.',
          channel: 'agent',
        }}
        onSelectEmployee={onSelectEmployee}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenFiles={onOpenFiles}
        onOpenRoster={onOpenRoster}
        onOpenLog={onOpenLog}
        onReturnLive={onReturnLive}
      />,
    )

    expect(screen.getByTestId('office-building').getAttribute('data-replay')).toBe('true')
    expect(screen.getByText('Replay · Seq 2')).toBeTruthy()
    const replayVisitor = screen.getByTestId('office-replay-visitor')
    const replayAlice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(replayVisitor.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/replay-visitor-v1.png')
    expect(replayVisitor.style.left).toBe(replayAlice.style.left)
    expect(replayVisitor.style.top).toBe(replayAlice.style.top)
    expect(container.querySelector<HTMLImageElement>('.oa-office-hud__signal img')?.src)
      .toContain('/office/hud/occupancy-log-v2.png')
    expect(screen.getByLabelText('Replay floor. Move Alice to inspect the snapshot; use Operations board to review it or Live to return.')).toBeTruthy()

    const workspaceSign = screen.getByRole('button', { name: /Enter chat workspace/ }) as HTMLButtonElement
    const occupiedDesks = screen.getAllByTestId(/^office-desk-/) as HTMLButtonElement[]
    const cabinet = screen.getByRole('button', { name: 'Filing cabinet · chat' }) as HTMLButtonElement
    const roster = screen.getByRole('button', {
      name: 'Team roster · chat · 2 more teammates',
    }) as HTMLButtonElement
    const terminal = screen.getByRole('button', { name: 'Floor terminal' }) as HTMLButtonElement
    const operations = screen.getByRole('button', { name: 'Operations board' }) as HTMLButtonElement
    const map = screen.getByTestId('office-floor')

    expect(map.tabIndex).toBe(0)
    expect([
      workspaceSign,
      ...occupiedDesks,
      cabinet,
      roster,
      terminal,
      operations,
      screen.getByRole('button', { name: 'Inbox station' }),
      screen.getByRole('button', { name: 'News terminal' }),
      screen.getByRole('button', { name: 'Move Alice up' }),
      screen.getByRole('button', { name: 'Move Alice left' }),
      screen.getByRole('button', { name: 'Move Alice right' }),
      screen.getByRole('button', { name: 'Move Alice down' }),
      container.querySelector<HTMLButtonElement>('.oa-office-touch-action'),
    ].every((control) => control?.tabIndex === -1)).toBe(true)
    operations.focus()
    expect(document.activeElement).toBe(operations)
    map.focus()

    expect(workspaceSign.disabled).toBe(true)
    expect(workspaceSign.textContent).toContain('2/6 active')
    expect(workspaceSign.dataset.replayLabel).toBe('Snapshot')
    expect(occupiedDesks.every((desk) => desk.disabled)).toBe(true)
    expect(cabinet.disabled).toBe(true)
    expect(roster.disabled).toBe(true)
    expect(terminal.disabled).toBe(true)
    expect(operations.disabled).toBe(false)
    const replayBeacon = screen.getByRole('status', { name: 'Seq 2 · Session 6' })
    expect(replayBeacon.dataset.kind).toBe('employee')
    expect(screen.getByTestId('office-desk-resume-5').dataset.replayFocus).toBe('true')
    expect(replayBeacon.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-destination-v1.png')
    const replayPrompt = await screen.findByRole('status', {
      name: 'Review Seq 2 in Activity Log · Session 6 · Earlier Session completed its assignment.',
    })
    expect(screen.queryByRole('status', { name: 'Seq 2 · Session 6' })).toBeNull()
    expect(replayPrompt.textContent).toContain('Review event')
    expect(replayPrompt.textContent).toContain('Session 6 · Earlier Session completed its assignment.')
    expect(replayPrompt.dataset.layout).toBe('dialogue')
    expect(replayPrompt.style.width).toBe('320px')
    expect(replayPrompt.dataset.side).not.toBe('above')
    await userEvent.keyboard('{Enter}')
    expect(onOpenLog).toHaveBeenCalledWith('operations')
    expect(onSelectEmployee).not.toHaveBeenCalled()
    expect(screen.queryByRole('status', { name: /Check live operations/ })).toBeNull()
    await userEvent.click(operations)
    fireEvent.click(workspaceSign)
    fireEvent.click(occupiedDesks[0])
    fireEvent.click(cabinet)
    fireEvent.click(roster)
    expect(onOpenWorkspace).not.toHaveBeenCalled()
    expect(onSelectEmployee).not.toHaveBeenCalled()
    expect(onOpenFiles).not.toHaveBeenCalled()
    expect(onOpenRoster).not.toHaveBeenCalled()

    const menuTrigger = screen.getByRole('button', { name: 'Menu' })
    expect(menuTrigger.tabIndex).toBe(0)
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByLabelText('Current floor view: Replay · Seq 2').textContent)
      .toContain('Current')
    expect(screen.queryByLabelText('Current floor view: Live map')).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Live map' }))
    expect(onReturnLive).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(map))

    const returnLive = screen.getByRole('button', { name: 'Return live' })
    expect(returnLive.textContent).toContain('Live')
    expect(returnLive.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/window-back-v2.png')
    await userEvent.click(returnLive)
    expect(onReturnLive).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(document.activeElement).toBe(map))
    const leftBeforeMove = replayAlice.style.left
    await userEvent.keyboard('{ArrowRight}')
    expect(replayAlice.style.left).not.toBe(leftBeforeMove)
  })

  it('restores the Live excursion after moving through Replay without persisting the memory walk', async () => {
    const onPlayerStateChange = vi.fn()
    const building: OfficeBuildingSnapshot = {
      config: {
        workspaceSleepAfterMs: 1,
        harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
      },
      lastSeq: 2,
      firstSeq: 1,
      offices: [],
    }
    const commonProps = {
      onPlayerStateChange,
      onSelectEmployee: vi.fn(),
      onOpenEmployee: vi.fn(),
      onOpenWorkspace: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenRoster: vi.fn(),
      onOpenLog: vi.fn(),
    }
    const { rerender } = render(<OfficeBuilding building={building} {...commonProps} />)
    const floor = screen.getByTestId('office-floor')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })

    await userEvent.keyboard('{ArrowRight}')
    const livePosition = { left: alice.style.left, top: alice.style.top }
    expect(livePosition.left).toBe('504px')
    await waitFor(() => expect(onPlayerStateChange).toHaveBeenLastCalledWith({
      position: { x: 504, y: 336 },
      direction: 'right',
    }))
    onPlayerStateChange.mockClear()

    rerender(<OfficeBuilding building={{ ...building, asOfSeq: 2 }} replaySeq={2} {...commonProps} />)
    floor.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(alice.style.top).toBe('360px')
    expect(onPlayerStateChange).not.toHaveBeenCalled()

    rerender(<OfficeBuilding building={{ ...building, asOfSeq: 3 }} replaySeq={3} {...commonProps} />)
    floor.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(alice.style.left).toBe('480px')
    expect(onPlayerStateChange).not.toHaveBeenCalled()

    rerender(<OfficeBuilding building={building} {...commonProps} />)
    await waitFor(() => {
      expect(alice.style.left).toBe(livePosition.left)
      expect(alice.style.top).toBe(livePosition.top)
    })
    expect(onPlayerStateChange).toHaveBeenLastCalledWith({
      position: { x: 504, y: 336 },
      direction: 'right',
    })
  })

  it('leaves the active Replay menu as the only Live exit while the floor is suspended', () => {
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 6,
          firstSeq: 1,
          asOfSeq: 2,
          offices: [],
        }}
        replaySeq={2}
        interactionSuspended
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
        onReturnLive={vi.fn()}
      />,
    )

    expect(screen.getByText('Replay · Seq 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Return live' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('cancels the historical auto-walk before returning to the Live floor', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const onSelectEmployee = vi.fn()
    const onReturnLive = vi.fn()
    const { container } = render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 2,
          firstSeq: 1,
          asOfSeq: 2,
          offices: [
            {
              workspace: { id: 'prediction-replay', tag: 'prediction', harness: 'prediction' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [],
            },
            {
              workspace: { id: 'quant-replay', tag: 'auto-quant', harness: 'auto-quant' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [],
            },
            {
              workspace: { id: 'chat-replay', tag: 'chat', harness: 'chat' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [{
                resumeId: 'resume-target',
                agent: 'grok',
                name: 'g1',
                title: 'Replay target',
                awake: false,
                mood: 'review',
                bubble: { kind: 'text', text: 'Finished the historical run.' },
                lastSeq: 2,
                lastInteractionAt: 1,
                drawers: [],
              }],
            },
          ],
        }}
        replaySeq={2}
        replayFocus={{
          seq: 2,
          workspaceId: 'chat-replay',
          resumeId: 'resume-target',
          targetIds: ['employee:chat-replay:resume-target'],
          label: 'Replay target',
          summary: 'Finished the historical run.',
          channel: 'agent',
        }}
        onSelectEmployee={onSelectEmployee}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
        onReturnLive={onReturnLive}
      />,
    )

    const target = screen.getByTestId('office-desk-resume-target')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(target.dataset.route).toBe('true')
    expect(container.querySelector('.oa-office-route-trail__step')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Return live' }))
    const positionAfterReturn = `${alice.style.left}:${alice.style.top}`
    expect(onReturnLive).toHaveBeenCalledTimes(1)
    expect(target.dataset.route).toBe('false')
    expect(container.querySelector('.oa-office-route-trail__step')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(`${alice.style.left}:${alice.style.top}`).toBe(positionAfterReturn)
    expect(onSelectEmployee).not.toHaveBeenCalled()
  })

  it.each([
    ['inbox-service', 'Inbox station'],
    ['news-service', 'News terminal'],
  ] as const)('auto-walks to the replayed %s without opening the live service', async (targetId, label) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const onOpenService = vi.fn()
    const { container } = render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 2,
          firstSeq: 1,
          asOfSeq: 2,
          offices: [],
        }}
        replaySeq={2}
        replayFocus={{
          seq: 2,
          targetIds: [targetId],
          label,
          summary: `Historical ${label}`,
          channel: targetId === 'inbox-service' ? 'inbox' : 'news',
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
        onOpenService={onOpenService}
        onReturnLive={vi.fn()}
      />,
    )

    const service = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(service.disabled).toBe(true)
    expect(service.dataset.route).toBe('true')
    expect(container.querySelector('.oa-office-route-trail__step')).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    expect(service.dataset.route).toBeUndefined()
    expect(container.querySelector('.oa-office-route-trail__step')).toBeNull()
    expect(onOpenService).not.toHaveBeenCalled()
  })

  it('keeps an empty Office inside the game world with Alice centered', () => {
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 0,
          firstSeq: 0,
          offices: [],
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    const building = screen.getByTestId('office-building')
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    expect(map.querySelector('.oa-office-map-stage')).toBeTruthy()
    expect(map.querySelector('.oa-office-room-grid')).toBeNull()
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    const spawnInlay = screen.getByTestId('office-spawn-inlay')
    const quietNotice = screen.getByRole('status')
    expect(map).toBeTruthy()
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('336px')
    expect(alice.textContent).toBe('')
    expect(spawnInlay.style.left).toBe(alice.style.left)
    expect(spawnInlay.style.top).toBe(alice.style.top)
    expect(quietNotice.dataset.kind).toBe('empty')
    expect(screen.getByText('No Workspace yet')).toBeTruthy()
    expect(screen.getByText('No one is at a desk in this office. Active Sessions appear here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'All groups' })).toBeNull()
    const unavailableAction = screen.getByRole('button', { name: 'No nearby action' })
    expect((unavailableAction as HTMLButtonElement).disabled).toBe(true)
    expect(unavailableAction.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/action-button-v1.png')
    expect(building.querySelector<HTMLImageElement>('.oa-office-quiet__radar img')?.src)
      .toContain('/office/hud/signal-receiver-v2.png')
    expect(building.querySelector('svg')).toBeNull()
    expect(screen.queryByTestId('office-replay-visitor')).toBeNull()
  })

  it('combines held direction keys into an equal-speed diagonal walk', () => {
    vi.useFakeTimers()
    try {
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
            },
            firstSeq: 0,
            lastSeq: 0,
            offices: [],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const map = screen.getByLabelText(
        'Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.',
      )
      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      fireEvent.keyDown(map, { key: 'w' })
      expect(`${alice.style.left}:${alice.style.top}`).toBe('480px:312px')
      fireEvent.keyDown(map, { key: 'd' })
      expect(`${alice.style.left}:${alice.style.top}`).toBe('497px:319px')
      expect(alice.dataset.direction).toBe('right')
      act(() => vi.advanceTimersByTime(96))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('514px:302px')
      fireEvent.keyUp(map, { key: 'd' })
      fireEvent.keyUp(map, { key: 'w' })
      act(() => vi.advanceTimersByTime(192))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('514px:302px')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses Shift to sprint through collision-safe normalized substeps', () => {
    vi.useFakeTimers()
    try {
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
            },
            firstSeq: 0,
            lastSeq: 0,
            offices: [],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      expect(screen.getByText('WASD/ARROWS · SHIFT RUN · ESC MENU')).toBeTruthy()
      const map = screen.getByTestId('office-floor')
      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      fireEvent.keyDown(map, { key: 'Shift' })
      fireEvent.keyDown(map, { key: 'd', shiftKey: true })
      expect(`${alice.style.left}:${alice.style.top}`).toBe('528px:336px')
      expect(alice.dataset.sprinting).toBe('true')
      fireEvent.keyDown(map, { key: 's', shiftKey: true })
      expect(`${alice.style.left}:${alice.style.top}`).toBe('514px:370px')
      act(() => vi.advanceTimersByTime(96))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('548px:404px')
      fireEvent.keyUp(map, { key: 's', shiftKey: true })
      fireEvent.keyUp(map, { key: 'd', shiftKey: true })
      fireEvent.keyUp(map, { key: 'Shift' })
      act(() => vi.advanceTimersByTime(150))
      expect(alice.dataset.sprinting).toBeUndefined()

      fireEvent.keyDown(map, { key: 'a' })
      fireEvent.keyUp(map, { key: 'a' })
      expect(`${alice.style.left}:${alice.style.top}`).toBe('524px:404px')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a remembered walkable player position and facing', async () => {
    const onPlayerStateChange = vi.fn()
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 0,
          firstSeq: 0,
          offices: [],
        }}
        initialPlayerState={{ position: { x: 456, y: 432 }, direction: 'left' }}
        onPlayerStateChange={onPlayerStateChange}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('456px')
    expect(alice.style.top).toBe('432px')
    expect(alice.dataset.direction).toBe('left')
    await waitFor(() => expect(onPlayerStateChange).toHaveBeenLastCalledWith({
      position: { x: 456, y: 432 },
      direction: 'left',
    }))
  })

  it('gives Prediction its own console and skips departure motion when reduced', async () => {
    const onOpenWorkspace = vi.fn()
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 1, other: 0 },
          },
          lastSeq: 1,
          firstSeq: 1,
          offices: [{
            workspace: { id: 'prediction-1', tag: 'prediction', harness: 'prediction' },
            lastInteractionAt: Date.now(),
            sleeping: false,
            employees: [],
          }],
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    const prop = screen.getByTestId('office-pod-prediction-1')
      .querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')
    expect(prop?.src).toContain('/office/furniture/prediction-console-v1.png')
    expect(screen.getByText('0 working · 0 awake')).toBeTruthy()
    screen.getByRole('button', { name: 'Menu' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.queryByRole('menuitemradio', { name: 'Live map' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'All groups' })).toBeNull()
    expect(screen.getByLabelText('Current floor view: Live map').textContent).toContain('Current')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Activity log' }))
    await userEvent.keyboard('{Escape}')
    const predictionSign = screen.getByRole('button', { name: /Enter prediction workspace/ })
    expect(predictionSign.textContent).toContain('0/0 awake')
    await userEvent.click(predictionSign)
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('prediction-1'))
    expect(screen.queryByTestId('office-departure')).toBeNull()
  })

  it('names each workspace destination before the keyboard interaction hint', () => {
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
          },
          lastSeq: 1,
          firstSeq: 1,
          offices: [
            {
              workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [],
            },
            {
              workspace: { id: 'quant-1', tag: 'quant', harness: 'auto-quant' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [],
            },
            {
              workspace: { id: 'prediction-1', tag: 'prediction', harness: 'prediction' },
              lastInteractionAt: 1,
              sleeping: false,
              employees: [],
            },
          ],
        }}
        initialPlayerState={{ position: { x: 336, y: 336 }, direction: 'down' }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    const prompt = screen.getByRole('status', { name: 'Enter prediction workspace' })
    expect(prompt.querySelector('.oa-office-interact-prompt__copy strong')?.textContent)
      .toBe('Prediction')
    expect(prompt.style.width).toBe('max-content')
    expect(prompt.querySelector('[data-input="keyboard"]')?.textContent).toBe('Enter')
    expect(prompt.textContent).not.toContain('EnterEnter')
  })

  it('moves from the touch pad immediately and repeats while held', () => {
    vi.useFakeTimers()
    try {
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
            },
            lastSeq: 0,
            firstSeq: 0,
            offices: [],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      const moveRight = screen.getByRole('button', { name: 'Move Alice right' })
      fireEvent.pointerDown(moveRight, { pointerId: 3 })
      expect(alice.style.left).toBe('504px')
      act(() => vi.advanceTimersByTime(320))
      expect(alice.style.left).toBe('528px')
      fireEvent.pointerUp(moveRight, { pointerId: 3 })
      act(() => vi.advanceTimersByTime(500))
      expect(alice.style.left).toBe('528px')
    } finally {
      vi.useRealTimers()
    }
  })

  it('combines held touch-pad directions and keeps moving after one pointer lifts', () => {
    vi.useFakeTimers()
    try {
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
            },
            lastSeq: 0,
            firstSeq: 0,
            offices: [],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      const initialTop = Number.parseInt(alice.style.top, 10)
      const moveRight = screen.getByRole('button', { name: 'Move Alice right' })
      const moveDown = screen.getByRole('button', { name: 'Move Alice down' })
      fireEvent.pointerDown(moveRight, { pointerId: 3 })
      fireEvent.pointerDown(moveDown, { pointerId: 4 })
      expect(alice.style.left).toBe('521px')
      expect(alice.style.top).toBe(`${initialTop + 17}px`)

      fireEvent.pointerUp(moveDown, { pointerId: 4 })
      act(() => vi.advanceTimersByTime(320))
      expect(alice.style.left).toBe('545px')
      expect(alice.style.top).toBe(`${initialTop + 17}px`)

      fireEvent.pointerUp(moveRight, { pointerId: 3 })
      act(() => vi.advanceTimersByTime(500))
      expect(alice.style.left).toBe('545px')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restarts and clears a directional impact when movement is blocked', () => {
    vi.useFakeTimers()
    try {
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 0, other: 0 },
            },
            lastSeq: 1,
            firstSeq: 1,
            offices: [
              {
                workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
              {
                workspace: { id: 'quant-1', tag: 'quant', harness: 'auto-quant' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
            ],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const map = screen.getByLabelText(
        'Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.',
      )
      for (let index = 0; index < 9; index += 1) {
        fireEvent.keyDown(map, { key: 'w' })
        fireEvent.keyUp(map, { key: 'w' })
      }
      const firstImpact = screen.getByTestId('office-collision-impact')
      expect(firstImpact.dataset.direction).toBe('up')
      const firstSerial = Number(firstImpact.dataset.serial)
      expect(firstSerial).toBeGreaterThan(0)
      expect(firstImpact.style.left).toBe('480px')
      expect(firstImpact.style.top).toBe('234px')
      expect(firstImpact.querySelector<HTMLElement>('span')?.style.backgroundImage)
        .toContain('/office/furniture/collision-impact-v1.png')

      fireEvent.keyDown(map, { key: 'w' })
      expect(Number(screen.getByTestId('office-collision-impact').dataset.serial)).toBe(firstSerial + 1)
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.pushing).toBe('true')
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.walking).toBe('true')
      act(() => vi.advanceTimersByTime(192))
      expect(Number(screen.getByTestId('office-collision-impact').dataset.serial)).toBe(firstSerial + 1)
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.pushing).toBe('true')
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.walking).toBe('true')
      fireEvent.keyUp(map, { key: 'w' })
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.pushing).toBe('false')
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.walking).toBe('false')
      fireEvent.keyDown(map, { key: 'w' })
      fireEvent.keyUp(map, { key: 'w' })
      expect(Number(screen.getByTestId('office-collision-impact').dataset.serial)).toBe(firstSerial + 2)
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByTestId('office-collision-impact')).toBeNull()
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.bumped).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('executes an off-grid route entry before activating the employee', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    try {
      const onSelectEmployee = vi.fn()
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
            },
            lastSeq: 1,
            firstSeq: 1,
            offices: [
              {
                workspace: { id: 'prediction-route', tag: 'prediction', harness: 'prediction' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
              {
                workspace: { id: 'quant-route', tag: 'quant', harness: 'auto-quant' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
              {
                workspace: { id: 'chat-route', tag: 'chat', harness: 'chat' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: Array.from({ length: 4 }, (_, index) => ({
                  resumeId: index === 0 ? 'resume-route' : `resume-neighbor-${index}`,
                  agent: 'grok',
                  name: `g${index + 1}`,
                  title: index === 0 ? 'Off-grid route target' : `Dense neighbor ${index}`,
                  awake: false,
                  mood: 'idle' as const,
                  bubble: null,
                  lastSeq: 1,
                  lastInteractionAt: 1,
                  drawers: [],
                })),
              },
            ],
          }}
          initialPlayerState={{ position: { x: 325, y: 589 }, direction: 'down' }}
          onSelectEmployee={onSelectEmployee}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onOpenFiles={vi.fn()}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      const target = screen.getByTestId('office-desk-resume-route')
      const closerNeighbor = screen.getByTestId('office-desk-resume-neighbor-2')
      fireEvent.click(target)
      expect(`${alice.style.left}:${alice.style.top}`).toBe('336px:600px')
      expect(target.dataset.route).toBe('true')
      expect(onSelectEmployee).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(600))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('312px:504px')
      expect(target.dataset.route).toBe('false')
      act(() => vi.advanceTimersByTime(100))
      expect(onSelectEmployee).toHaveBeenCalledWith(
        'chat-route',
        expect.objectContaining({ resumeId: 'resume-route' }),
      )
      expect(target.dataset.nearby).toBe('true')
      expect(closerNeighbor.dataset.nearby).toBe('false')

      const map = screen.getByTestId('office-floor')
      fireEvent.keyDown(map, { key: 'a' })
      fireEvent.keyUp(map, { key: 'a' })
      expect(target.dataset.nearby).toBe('false')
      expect(closerNeighbor.dataset.nearby).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('walks Alice to a distant world object before activating it', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    try {
      const onOpenWorkspace = vi.fn()
      const onOpenFiles = vi.fn()
      render(
        <OfficeBuilding
          building={{
            config: {
              workspaceSleepAfterMs: 1,
              harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 0, other: 0 },
            },
            lastSeq: 1,
            firstSeq: 1,
            offices: [
              {
                workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
              {
                workspace: { id: 'quant-1', tag: 'quant', harness: 'auto-quant' },
                lastInteractionAt: 1,
                sleeping: false,
                employees: [],
              },
            ],
          }}
          onSelectEmployee={vi.fn()}
          onOpenEmployee={vi.fn()}
          onOpenWorkspace={onOpenWorkspace}
          onOpenFiles={onOpenFiles}
          onOpenRoster={vi.fn()}
          onOpenLog={vi.fn()}
        />,
      )

      const alice = screen.getByRole('img', { name: 'Alice on the office map' })
      const controls = screen.getByTestId('office-floor').parentElement
        ?.querySelector<HTMLElement>('.oa-office-map-controls')
      expect(controls?.dataset.learned).toBe('false')
      const sign = screen.getByRole('button', { name: /Enter chat workspace/ })
      fireEvent.click(sign)
      expect(controls?.dataset.learned).toBe('false')
      expect(onOpenWorkspace).not.toHaveBeenCalled()
      expect(sign.dataset.route).toBe('true')
      const routeStatus = screen.getByTestId('office-route-status')
      expect(routeStatus.textContent).toContain('Auto move')
      expect(routeStatus.textContent).toContain('Walking to chat')
      expect(routeStatus.dataset.edge).toBe('bottom')
      expect(routeStatus.textContent).toContain('Esc')
      expect(routeStatus.textContent).toContain('Cancel')
      expect(routeStatus.querySelector('.oa-office-route-status__cancel')?.hasAttribute('aria-hidden')).toBe(false)
      expect(routeStatus.querySelector('img')?.getAttribute('src'))
        .toBe('/office/furniture/route-destination-v1.png')
      expect(controls?.dataset.routing).toBe('true')
      const trail = screen.getByTestId('office-route-trail')
      expect(trail.querySelectorAll('.oa-office-route-trail__step').length).toBeGreaterThan(1)
      expect(trail.querySelector('img')?.getAttribute('src'))
        .toBe('/office/furniture/route-footsteps-v1.png')
      const targetPointer = screen.getByTestId('office-route-target-pointer')
      expect(targetPointer.dataset.kind).toBe('sign')
      expect(targetPointer.querySelector('img')?.getAttribute('src'))
        .toBe('/office/furniture/route-destination-v1.png')
      expect(`${alice.style.left}:${alice.style.top}`).not.toBe('480px:336px')
      const routePosition = `${alice.style.left}:${alice.style.top}`
      expect(screen.queryByRole('button', { name: 'Center map on Alice' })).toBeNull()
      expect(`${alice.style.left}:${alice.style.top}`).toBe(routePosition)
      expect(sign.dataset.route).toBe('true')
      expect(screen.getByTestId('office-route-trail')).toBeTruthy()

      const menuTrigger = screen.getByRole('button', { name: 'Menu' })
      fireEvent.click(menuTrigger)
      expect(screen.getByTestId('office-floor').dataset.menuOpen).toBe('true')
      act(() => vi.advanceTimersByTime(1_000))
      expect(`${alice.style.left}:${alice.style.top}`).toBe(routePosition)
      expect(sign.dataset.route).toBe('true')
      expect(screen.getByTestId('office-route-trail')).toBeTruthy()
      fireEvent.click(menuTrigger)
      expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
      act(() => vi.advanceTimersByTime(96))
      expect(`${alice.style.left}:${alice.style.top}`).not.toBe(routePosition)
      expect(sign.dataset.route).toBe('true')

      for (let index = 0; index < 100 && !screen.queryByTestId('office-departure'); index += 1) {
        act(() => vi.advanceTimersToNextTimer())
      }
      const departure = screen.getByTestId('office-departure')
      expect(departure.textContent).toContain('Entering chat')
      expect(departure.querySelector('img')?.getAttribute('src'))
        .toBe('/office/hud/session-portal-v2.png')
      expect(screen.getByTestId('office-floor').getAttribute('aria-busy')).toBe('true')
      expect(onOpenWorkspace).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(519))
      expect(onOpenWorkspace).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onOpenWorkspace).toHaveBeenCalledWith('chat-1')
      expect(controls?.dataset.learned).toBe('false')
      expect(sign.dataset.route).toBe('false')
      expect(screen.queryByTestId('office-route-trail')).toBeNull()
      expect(screen.queryByTestId('office-route-target-pointer')).toBeNull()
      expect(screen.queryByTestId('office-route-status')).toBeNull()
      expect(controls?.dataset.routing).toBeUndefined()

      onOpenWorkspace.mockClear()
      const quantSign = screen.getByRole('button', { name: /Enter quant workspace/ })
      fireEvent.click(quantSign)
      expect(screen.getByTestId('office-route-trail')).toBeTruthy()
      const map = screen.getByLabelText(
        'Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.',
      )
      quantSign.focus()
      expect(document.activeElement).toBe(quantSign)
      fireEvent.keyDown(quantSign, { key: 'Escape' })
      expect(screen.queryByTestId('office-route-status')).toBeNull()
      expect(screen.queryByTestId('office-route-trail')).toBeNull()
      expect(quantSign.dataset.route).toBe('false')
      expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
      expect(document.activeElement).toBe(map)
      expect(alice.dataset.walking).toBe('false')

      fireEvent.click(quantSign)
      expect(screen.getByTestId('office-route-status').textContent).toContain('Walking to quant')
      fireEvent.keyDown(map, { key: 'ArrowDown' })
      fireEvent.keyUp(map, { key: 'ArrowDown' })
      expect(controls?.dataset.learned).toBe('true')
      expect(screen.queryByTestId('office-route-status')).toBeNull()
      expect(screen.queryByTestId('office-route-trail')).toBeNull()
      expect(quantSign.dataset.route).toBe('false')
      act(() => vi.advanceTimersByTime(5_000))
      expect(onOpenWorkspace).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an old route when pods reorder inside the same map dimensions', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    try {
      const onOpenWorkspace = vi.fn()
      const office = (id: 'chat-geometry' | 'quant-geometry') => ({
        workspace: id === 'chat-geometry'
          ? { id, tag: 'chat', harness: 'chat' as const }
          : { id, tag: 'quant', harness: 'auto-quant' as const },
        lastInteractionAt: 1,
        sleeping: false,
        employees: [],
      })
      const building = (order: Array<'chat-geometry' | 'quant-geometry'>) => ({
        config: {
          workspaceSleepAfterMs: 1,
          harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 0, other: 0 },
        },
        lastSeq: 1,
        firstSeq: 1,
        offices: order.map(office),
      })
      const callbacks = {
        onSelectEmployee: vi.fn(),
        onOpenEmployee: vi.fn(),
        onOpenWorkspace,
        onOpenFiles: vi.fn(),
        onOpenRoster: vi.fn(),
        onOpenLog: vi.fn(),
      }
      const { rerender } = render(
        <OfficeBuilding
          building={building(['chat-geometry', 'quant-geometry'])}
          {...callbacks}
        />,
      )

      const map = screen.getByTestId('office-building').querySelector<HTMLElement>('.oa-office-map')
      const initialDimensions = `${map?.style.width}:${map?.style.height}`
      const chatSign = screen.getByRole('button', { name: /Enter chat workspace/ })
      fireEvent.click(chatSign)
      expect(chatSign.dataset.route).toBe('true')
      expect(screen.getByTestId('office-route-trail')).toBeTruthy()

      rerender(
        <OfficeBuilding
          building={building(['quant-geometry', 'chat-geometry'])}
          {...callbacks}
        />,
      )

      expect(`${map?.style.width}:${map?.style.height}`).toBe(initialDimensions)
      expect(screen.queryByTestId('office-route-trail')).toBeNull()
      expect(screen.queryByTestId('office-route-status')).toBeNull()
      expect(screen.getByRole('button', { name: /Enter chat workspace/ }).dataset.route).toBe('false')
      act(() => vi.advanceTimersByTime(5_000))
      expect(onOpenWorkspace).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the auto-route status on the screen edge opposite Alice', () => {
    expect(officeRouteStatusEdge(
      { x: 120, y: 600 },
      { x: 0, y: 0 },
      { width: 960, height: 672 },
      672,
    )).toBe('top')
    expect(officeRouteStatusEdge(
      { x: 840, y: 164 },
      { x: 0, y: 0 },
      { width: 960, height: 672 },
      672,
    )).toBe('bottom')
    expect(officeRouteStatusEdge(
      { x: 480, y: 600 },
      { x: 0, y: -320 },
      { width: 844, height: 390 },
      672,
    )).toBe('top')
  })

  it('offers sleeping groups from the in-world quiet notice', async () => {
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 1,
          firstSeq: 1,
          offices: [{
            workspace: { id: 'sleeping-1', tag: 'sleeping', harness: 'other' },
            lastInteractionAt: 1,
            sleeping: true,
            employees: [],
          }],
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').dataset.kind).toBe('sleeping')
    expect(screen.getByText('All groups are asleep')).toBeTruthy()
    expect(screen.queryByTestId('office-pod-sleeping-1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'All groups' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('office-pod-sleeping-1')).toBeTruthy()
  })

  it('filters sleeping groups and lets Alice move around the continuous map', async () => {
    const onOpenWorkspace = vi.fn()
    const onOpenFiles = vi.fn()
    const onOpenRoster = vi.fn()
    const onSelectEmployee = vi.fn()
    const onOpenLog = vi.fn()
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
            harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
          },
          lastSeq: 1,
          firstSeq: 1,
          offices: [
            {
              workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
              lastInteractionAt: Date.now(),
              sleeping: false,
              employees: [{
                resumeId: 'resume-alice',
                agent: 'codex',
                name: 'c1',
                title: 'Desk mate',
                awake: true,
                mood: 'working',
                bubble: { kind: 'tool', name: 'research' },
                lastSeq: 1,
                lastInteractionAt: Date.now(),
                drawers: [],
              }],
            },
            {
              workspace: { id: 'quant-1', tag: 'auto-quant', harness: 'auto-quant' },
              lastInteractionAt: 2,
              sleeping: true,
              employees: [],
            },
            {
              workspace: { id: 'quant-old', tag: 'auto-quant-old', harness: 'auto-quant' },
              lastInteractionAt: 1,
              sleeping: true,
              employees: [],
            },
          ],
        }}
        onSelectEmployee={onSelectEmployee}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenFiles={onOpenFiles}
        onOpenRoster={onOpenRoster}
        onOpenLog={onOpenLog}
      />,
    )
    expect(screen.getByTestId('office-building').dataset.officeTime).toBe('night')
    expect(screen.getByTestId('office-time-shift').dataset.officeTime).toBe('night')
    expect(screen.getByTestId('office-time-shift').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    expect(screen.getByTestId('office-wall').querySelector('.oa-office-hud__status')?.getAttribute('title'))
      .toBe('2 on floor · 1 recent · 3 total')
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    expect(map).toBeTruthy()
    expect(map.querySelector<HTMLImageElement>('.oa-office-map-service[data-kind="inbox"] img')?.src)
      .toContain('/office/furniture/inbox-terminal-v1.png')
    expect(map.querySelector<HTMLImageElement>('.oa-office-map-service[data-kind="news"] img')?.src)
      .toContain('/office/furniture/news-terminal-v1.png')
    expect(map.querySelector<HTMLElement>('.oa-office-map-service[data-kind="inbox"] .oa-office-map-service__placard')
      ?.getAttribute('style')).toContain('/office/furniture/service-placard-v1.png')
    expect(map.querySelector('.oa-office-map-service[data-kind="inbox"] .oa-office-map-service__placard')?.textContent)
      .toBe('Inbox')
    expect(map.querySelector('.oa-office-map-service[data-kind="news"] .oa-office-map-service__placard')?.textContent)
      .toBe('News')
    const mapWall = map.querySelector<HTMLElement>('.oa-office-map-wall')
    expect(mapWall?.style.getPropertyValue('--office-wall-day'))
      .toContain('/office/furniture/wall-window-v2.png')
    expect(mapWall?.style.getPropertyValue('--office-wall-night'))
      .toContain('/office/furniture/wall-window-night-v2.png')
    const utilityWall = mapWall?.querySelector<HTMLImageElement>('[data-kind="operations-utility"]')
    expect(utilityWall?.src).toContain('/office/furniture/wall-utility-night-v1.png')
    expect(utilityWall?.style.left).toBe('408px')
    const floorEdges = map.querySelectorAll('.oa-office-floor-edge')
    expect(floorEdges).toHaveLength(3)
    expect(map.querySelector('.oa-office-map')?.getAttribute('style'))
      .toContain('/office/furniture/floor-edge-bottom-v1.png')
    expect(map.querySelector('.oa-office-map')?.getAttribute('style'))
      .toContain('/office/furniture/floor-edge-side-v1.png')
    const controls = map.parentElement?.querySelector<HTMLElement>('.oa-office-map-controls')
    expect(controls?.dataset.learned).toBe('false')
    expect(controls?.dataset.actionReady).toBeUndefined()
    expect(controls?.querySelector<HTMLImageElement>('.oa-office-map-controls__move img')?.src)
      .toContain('/office/hud/move-pad-v3.png')
    const touchPad = screen.getByRole('group', { name: 'Move Alice' })
    expect(touchPad.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/move-pad-v3.png')
    expect(screen.getAllByRole('button', { name: /Move Alice (up|right|down|left)/ })).toHaveLength(4)
    expect(screen.getByTestId('office-building').querySelector<HTMLImageElement>('.oa-office-hud__signal img')?.src)
      .toContain('/office/hud/signal-receiver-v2.png')
    expect(screen.getByTestId('office-building').querySelector('svg')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Center map on Alice' })).toBeNull()
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('480px')
    const spawnInlay = screen.getByTestId('office-spawn-inlay')
    expect((spawnInlay as HTMLImageElement).src).toContain('/office/furniture/spawn-inlay-v1.png')
    expect(spawnInlay.style.left).toBe('480px')
    expect(spawnInlay.style.top).toBe(alice.style.top)
    const operations = screen.getByRole('button', { name: 'Operations board' })
    expect(operations.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/operations-board-v2.png')
    const floorTerminal = screen.getByRole('button', { name: 'Floor terminal' })
    expect(floorTerminal.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/terminal-kiosk-v2.png')
    expect(floorTerminal.getAttribute('title')).toBe('Open the complete Office activity log.')
    Object.defineProperties(map, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
    })
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 500,
      top: 0,
      right: 800,
      bottom: 500,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent(window, new Event('resize'))
    expect(map.dataset.pannable).toBe('true')
    fireEvent.pointerDown(map, { pointerId: 2, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 402, clientY: 301 })
    expect(controls?.dataset.learned).toBe('false')
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 404, clientY: 300 })
    expect(controls?.dataset.learned).toBe('true')
    fireEvent.pointerUp(map, { pointerId: 2 })
    expect(document.activeElement).toBe(map)
    fireEvent.keyDown(document.body, { key: 'd' })
    expect(alice.style.left).toBe('504px')
    fireEvent.keyUp(document.body, { key: 'd' })
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(alice.style.left).toBe('480px')
    fireEvent.keyUp(document.body, { key: 'a' })
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true })
    expect(alice.style.left).toBe('480px')
    const initialMenuTrigger = screen.getByRole('button', { name: 'Menu' })
    initialMenuTrigger.focus()
    await userEvent.keyboard('d')
    expect(alice.style.left).toBe('480px')
    operations.focus()
    await userEvent.keyboard('d')
    expect(alice.style.left).toBe('504px')
    expect(document.activeElement).toBe(map)
    await userEvent.keyboard('a')
    expect(alice.style.left).toBe('480px')
    await userEvent.click(map)
    await userEvent.keyboard('d')
    expect(controls?.dataset.learned).toBe('true')
    expect(alice.style.left).toBe('504px')
    expect(alice.dataset.direction).toBe('right')
    expect(alice.dataset.walking).toBe('true')
    expect(alice.querySelector('[data-pose="walk-right"]')).toBeTruthy()
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 300, clientY: 250 })
    expect(map.querySelector<HTMLElement>('.oa-office-map')?.style.transform)
      .toBe('translate3d(-100px, -50px, 0)')
    fireEvent.pointerUp(map, { pointerId: 1 })
    vi.mocked(map.getBoundingClientRect).mockReturnValue({
      width: 390,
      height: 844,
      top: 0,
      right: 390,
      bottom: 844,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent(window, new Event('resize'))
    expect(map.querySelector<HTMLElement>('.oa-office-map')?.style.transform)
      .toBe('translate3d(-210px, 86px, 0)')
    const recenter = screen.getByRole('button', { name: 'Center map on Alice' })
    expect(recenter.querySelector('img')?.src).toContain('/office/hud/reset-compass-v2.png')
    await userEvent.click(recenter)
    expect(map.querySelector<HTMLElement>('.oa-office-map')?.style.transform)
      .toBe('translate3d(-309px, 86px, 0)')
    expect(screen.queryByRole('button', { name: 'Center map on Alice' })).toBeNull()
    expect(document.activeElement).toBe(map)
    vi.mocked(map.getBoundingClientRect).mockReturnValue({
      width: 1200,
      height: 800,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent(window, new Event('resize'))
    expect(map.querySelector<HTMLElement>('.oa-office-map')?.style.transform)
      .toBe('translate3d(120px, 64px, 0)')
    expect(map.dataset.pannable).toBeUndefined()
    expect(map.getAttribute('aria-label'))
      .toBe('Office map. Use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    await userEvent.keyboard('aasss')
    const interactionPrompt = screen.getByRole('status', { name: 'Inspect chat files' })
    expect(controls?.dataset.actionReady).toBe('true')
    expect(controls?.querySelector('.oa-office-map-controls__move')?.getAttribute('aria-hidden'))
      .toBe('true')
    expect(interactionPrompt.classList.contains('oa-office-interact-prompt')).toBe(true)
    expect(interactionPrompt.parentElement?.classList.contains('oa-office-map')).toBe(true)
    expect(interactionPrompt.dataset.side).toBeTruthy()
    expect(interactionPrompt.dataset.kind).toBe('cabinet')
    expect(interactionPrompt.style.width).toBe('max-content')
    expect(interactionPrompt.style.getPropertyValue('--office-prompt-tail-shift')).toMatch(/^-?\d+px$/)
    expect(interactionPrompt.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/drawer-record-v2.png')
    expect(interactionPrompt.textContent).toContain('Files')
    expect(interactionPrompt.textContent).toContain('A')
    expect(screen.queryByRole('button', { name: 'Interact: Inspect chat files' })).toBeNull()
    const touchAction = screen.getByTestId('office-floor')
      .querySelector<HTMLButtonElement>('.oa-office-touch-action')
    if (!touchAction) throw new Error('expected touch action button')
    expect(touchAction.disabled).toBe(false)
    expect(touchAction.dataset.ready).toBe('true')
    expect(touchAction.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/action-button-v1.png')
    await userEvent.click(touchAction)
    expect(onOpenFiles).toHaveBeenCalledWith('chat-1')
    onOpenFiles.mockClear()
    await userEvent.click(map)
    await userEvent.keyboard('{Enter}')
    expect(onOpenFiles).toHaveBeenCalledWith('chat-1')
    const cabinetPosition = `${alice.style.left}:${alice.style.top}`
    expect(screen.queryByRole('button', { name: 'Center map on Alice' })).toBeNull()
    expect(`${alice.style.left}:${alice.style.top}`).toBe(cabinetPosition)
    expect(controls?.dataset.learned).toBe('true')
    await userEvent.click(map)
    await userEvent.keyboard('wwd')
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('336px')
    await userEvent.keyboard('wwww')
    expect(alice.style.top).toBe('264px')
    const operationsPrompt = screen.getByRole('status', { name: 'Check live operations' })
    expect(operationsPrompt.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/occupancy-log-v2.png')
    expect(operationsPrompt.dataset.side).toBe('above')
    expect(operationsPrompt.style.top).toBe('102px')
    expect(operations.dataset.nearby).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(onOpenLog).toHaveBeenCalledWith('operations')
    expect(screen.queryByRole('button', { name: 'Center map on Alice' })).toBeNull()
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('264px')
    await userEvent.click(screen.getByTestId('office-desk-resume-alice'))
    await waitFor(() => expect(onSelectEmployee).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ resumeId: 'resume-alice' }),
    ))
    const talkPrompt = screen.getByRole('status', { name: /Talk to Codex.*Researching…/ })
    expect(talkPrompt.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/talk-bubble-v2.png')
    expect(talkPrompt.textContent).toContain('Talk')
    expect(talkPrompt.textContent).toContain('Researching…')
    expect(talkPrompt.dataset.layout).toBe('dialogue')
    expect(talkPrompt.style.width).toBe('320px')
    expect(screen.getByTestId('office-desk-resume-alice').querySelector('.oa-office-bubble')).toBeNull()
    expect(screen.getByTestId('office-desk-resume-alice').dataset.nearby).toBe('true')
    onSelectEmployee.mockClear()
    await userEvent.click(map)
    await userEvent.keyboard('{Enter}')
    expect(onSelectEmployee).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ resumeId: 'resume-alice' }),
    )
    expect(screen.getByTestId('office-pod-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-chat-1').dataset.powered).toBe('true')
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-1').dataset.powered).toBe('false')
    expect(screen.queryByTestId('office-pod-quant-old')).toBeNull()
    expect(screen.getByTestId('office-pod-chat-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/coffee-station-v2.png')
    expect(screen.getByTestId('office-pod-quant-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/server-rack-v2.png')
    const workspaceSign = screen.getByRole('button', { name: /Enter chat workspace/ })
    await userEvent.click(workspaceSign)
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('chat-1'))
    const menuTrigger = screen.getByRole('button', { name: 'Menu' })
    expect(menuTrigger.getAttribute('aria-keyshortcuts')).toBe('Escape')
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const pauseMenu = screen.getByRole('menu', { name: 'Menu' })
    const alicePositionBeforeMenuInput = `${alice.style.left}:${alice.style.top}`
    const logCallsBeforeMenuInput = onOpenLog.mock.calls.length
    expect(map.dataset.menuOpen).toBe('true')
    expect(map.hasAttribute('inert')).toBe(true)
    expect(map.getAttribute('aria-hidden')).toBe('true')
    expect(Array.from(map.querySelectorAll<HTMLButtonElement>('.oa-office-touch-dpad button'))
      .every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(map, { key: 'd' })
    fireEvent.click(operations)
    expect(`${alice.style.left}:${alice.style.top}`).toBe(alicePositionBeforeMenuInput)
    expect(onOpenLog).toHaveBeenCalledTimes(logCallsBeforeMenuInput)
    expect(pauseMenu.querySelector<HTMLImageElement>('.oa-office-pause-menu__header img')?.src)
      .toContain('/office/hud/menu-terminal-v2.png')
    expect(screen.getByRole('menuitemradio', { name: 'Live map' }).querySelector('img')?.src)
      .toContain('/office/hud/reset-compass-v2.png')
    expect(screen.getByRole('menuitemradio', { name: 'Live map' })
      .querySelector<HTMLImageElement>('.oa-office-pause-menu__selection')?.src)
      .toContain('/office/hud/journal-cursor-v1.png')
    expect(screen.getByRole('menuitemradio', { name: 'All groups' }).querySelector('img')?.src)
      .toContain('/office/hud/group-grid-v2.png')
    expect(screen.getByText('1 sleeping group')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Activity log' }).querySelector('img')?.src)
      .toContain('/office/hud/occupancy-log-v2.png')
    const controlsLegend = screen.getByRole('group', { name: 'Controls' })
    expect(controlsLegend.textContent).toContain('WASD/↑←↓→Move')
    expect(controlsLegend.textContent).toContain('ShiftRun')
    expect(controlsLegend.textContent).toContain('Enter/SpaceInteract')
    expect(controlsLegend.textContent).toContain('EscMenu / cancel')
    expect(controlsLegend.querySelectorAll('kbd')).toHaveLength(6)
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All groups' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(screen.getByTestId('office-pod-quant-old')).toBeTruthy()
    expect(document.activeElement).toBe(map)
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'All groups' })
      .querySelector<HTMLImageElement>('.oa-office-pause-menu__selection')?.src)
      .toContain('/office/hud/journal-cursor-v1.png')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All groups' }))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(map.dataset.menuOpen).toBeUndefined()
    expect(map.hasAttribute('inert')).toBe(false)
    expect(map.hasAttribute('aria-hidden')).toBe(false)
    expect(Array.from(map.querySelectorAll<HTMLButtonElement>('.oa-office-touch-dpad button'))
      .every((button) => !button.disabled)).toBe(true)
    expect(screen.getByTestId('office-pod-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-old')).toBeTruthy()
    expect(document.activeElement).toBe(map)
    onOpenLog.mockClear()
    await userEvent.click(menuTrigger)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Activity log' }))
    expect(onOpenLog).toHaveBeenCalledWith('menu')
    expect(document.activeElement).not.toBe(map)
    onOpenLog.mockClear()
    await userEvent.click(floorTerminal)
    await waitFor(() => expect(onOpenLog).toHaveBeenCalledWith('floor-terminal'))
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Filing cabinet · chat' }))
    await waitFor(() => expect(onOpenFiles).toHaveBeenCalledWith('chat-1'))
    await userEvent.click(operations)
    await waitFor(() => expect(onOpenLog).toHaveBeenCalledWith('operations'))
  }, 15_000)

  it('offers truthful check and review actions for dormant coworkers', async () => {
    vi.useFakeTimers()
    try {
      const building: OfficeBuildingSnapshot = {
        config: {
          workspaceSleepAfterMs: 1,
          harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 1, prediction: 0, other: 0 },
        },
        lastSeq: 1,
        firstSeq: 1,
        offices: [{
          workspace: { id: 'quant-dormant', tag: 'quant-dormant', harness: 'auto-quant' },
          lastInteractionAt: 1,
          sleeping: false,
          employees: [{
            resumeId: 'resume-dormant',
            agent: 'grok',
            name: 'g1',
            title: 'Dormant researcher',
            awake: false,
            mood: 'idle',
            bubble: null,
            lastSeq: 1,
            lastInteractionAt: 1,
            drawers: [],
          }],
        }],
      }
      const callbacks = {
        onSelectEmployee: vi.fn(),
        onOpenEmployee: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onOpenFiles: vi.fn(),
        onOpenRoster: vi.fn(),
        onOpenLog: vi.fn(),
      }
      const dormantEmployee = building.offices[0]!.employees[0]!
      const dormantCallsign = officeCoworkerCallsign(
        dormantEmployee,
        officeCoworkerSpriteForAgent(dormantEmployee.agent, dormantEmployee.resumeId),
      )
      const view = render(
        <OfficeBuilding
          building={building}
          {...callbacks}
        />,
      )

      fireEvent.click(screen.getByTestId('office-desk-resume-dormant'))
      let checkPrompt: HTMLElement | null = null
      for (let step = 0; step < 20 && !checkPrompt; step += 1) {
        act(() => vi.advanceTimersByTime(96))
        checkPrompt = screen.queryByRole('status', { name: `Check ${dormantCallsign}` })
      }

      expect(checkPrompt).not.toBeNull()
      expect(checkPrompt?.querySelector('img')?.getAttribute('src'))
        .toBe('/office/hud/roster-badge-v2.png')
      expect(checkPrompt?.textContent).toContain('Check')
      expect(screen.queryByRole('status', { name: `Talk to ${dormantCallsign}` })).toBeNull()

      view.rerender(
        <OfficeBuilding
          building={{
            ...building,
            offices: building.offices.map((office) => ({
              ...office,
              employees: office.employees.map((employee) => ({ ...employee, mood: 'failed' })),
            })),
          }}
          {...callbacks}
        />,
      )

      const reviewPrompt = screen.getByRole('status', { name: `Review ${dormantCallsign}’s failed run` })
      expect(screen.getByTestId('office-pod-quant-dormant').dataset.powered).toBe('false')
      expect(reviewPrompt.querySelector('img')?.getAttribute('src'))
        .toBe('/office/log/alert-v1.png')
      expect(reviewPrompt.textContent).toContain('Review')
      expect(screen.queryByRole('status', { name: `Check ${dormantCallsign}` })).toBeNull()

      view.rerender(
        <OfficeBuilding
          building={{
            ...building,
            offices: building.offices.map((office) => ({
              ...office,
              employees: office.employees.map((employee) => ({ ...employee, mood: 'review' })),
            })),
          }}
          {...callbacks}
        />,
      )

      const resultPrompt = screen.getByRole('status', { name: `Review ${dormantCallsign}’s latest result` })
      expect(screen.getByTestId('office-pod-quant-dormant').dataset.powered).toBe('false')
      expect(resultPrompt.querySelector('img')?.getAttribute('src'))
        .toBe('/office/coworkers/review-emote-v1.png')
      expect(resultPrompt.textContent).toContain('Review')
      expect(screen.queryByRole('status', { name: /failed run/ })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders an interactive personnel board for groups larger than the four-desk map', async () => {
    const onOpenRoster = vi.fn()
    const building = {
      config: {
        workspaceSleepAfterMs: 1,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 0, prediction: 0, other: 0 },
      },
      lastSeq: 1,
      firstSeq: 1,
      offices: [{
        workspace: { id: 'chat-full', tag: 'chat', harness: 'chat' as const },
        lastInteractionAt: 1,
        sleeping: false,
        employees: Array.from({ length: 6 }, (_, index) => ({
          resumeId: `resume-${index}`,
          agent: 'codex',
          name: `x${index + 1}`,
          title: `Session ${index + 1}`,
          awake: index < 2,
          mood: index < 2 ? 'working' as const : 'idle' as const,
          bubble: null,
          lastSeq: 1,
          lastInteractionAt: 1,
          drawers: [],
        })),
      }],
    }
    const view = render(
      <OfficeBuilding
        building={building}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId(/^office-desk-/)).toHaveLength(4)
    const board = screen.getByRole('button', { name: 'Team roster · chat · 2 more teammates' })
    expect(board.querySelector('img')?.getAttribute('src')).toBe('/office/furniture/personnel-board-v2.png')
    expect(board.querySelector('.oa-office-pod__roster-count')?.textContent).toBe('+2')
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')

    fireEvent.click(screen.getByRole('button', { name: 'Filing cabinet · chat' }))
    expect(screen.getByTestId('office-route-status').textContent)
      .toContain('Walking to Filing cabinet · chat')
    fireEvent.keyDown(map, { key: 'Escape' })
    fireEvent.click(board)
    expect(screen.getByTestId('office-route-status').textContent)
      .toContain('Walking to Team roster · chat')
    fireEvent.keyDown(map, { key: 'Escape' })

    map.focus()
    await userEvent.keyboard('aw')
    const rosterPrompt = screen.getByRole('status', { name: 'View chat roster · 2 more teammates' })
    expect(rosterPrompt.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/roster-badge-v2.png')
    expect(rosterPrompt.textContent).toContain('2 more teammates')
    expect(board.dataset.nearby).toBe('true')

    view.rerender(
      <OfficeBuilding
        building={building}
        interactionSuspended
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
      />,
    )
    const suspendedBuilding = screen.getByTestId('office-building')
    const suspendedControls = suspendedBuilding.querySelector<HTMLElement>('.oa-office-map-controls')
    const suspendedDpad = suspendedBuilding.querySelector<HTMLElement>('.oa-office-touch-dpad')
    expect(suspendedBuilding.dataset.controlsSuspended).toBe('true')
    expect(suspendedControls?.getAttribute('aria-hidden')).toBe('true')
    expect(suspendedControls?.hasAttribute('inert')).toBe(true)
    expect(suspendedDpad?.getAttribute('aria-hidden')).toBe('true')
    expect(suspendedDpad?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()
    expect(board.dataset.nearby).toBe('false')

    view.rerender(
      <OfficeBuilding
        building={building}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
      />,
    )
    expect(screen.getByTestId('office-building').dataset.controlsSuspended).toBeUndefined()
    await userEvent.click(board)
    await waitFor(() => expect(onOpenRoster).toHaveBeenCalledWith('chat-full'))
  })

  it('turns Inbox and News activity into navigable floor landmarks', async () => {
    const onOpenService = vi.fn()
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 12,
          firstSeq: 1,
          offices: [{
            workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
            lastInteractionAt: 1,
            sleeping: false,
            employees: [],
          }],
        }}
        productActivity={{
          agent: {
            seq: 10,
            occurredAt: 1_000,
            source: 'grok',
            eventType: 'runtime.started',
          },
          inbox: {
            seq: 11,
            occurredAt: 1_100,
            detail: 'Agent report delivered',
            source: 'codex',
            inboxEntryId: 'inbox-11',
          },
          news: {
            seq: 12,
            occurredAt: 1_200,
            detail: 'Markets move overnight',
            source: 'Wire',
          },
          attention: { agent: true, inbox: true, news: true },
          pending: { agent: 1, inbox: 2, news: 9 },
          freshKind: 'news',
        }}
        initialPlayerState={{ position: { x: 340, y: 600 }, direction: 'up' }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
        onOpenService={onOpenService}
      />,
    )

    const inbox = screen.getByRole('button', { name: 'Inbox station · 2 pending' })
    const news = screen.getByRole('button', { name: 'News terminal · 9+ pending' })
    const nextDuty = screen.getByRole('button', { name: 'Next duty: Inbox station, 2 pending' })
    expect(nextDuty.dataset.kind).toBe('inbox')
    expect(nextDuty.textContent).toContain('Next duty')
    expect(nextDuty.textContent).toContain('Inbox station')
    const serviceZone = screen.getByTestId('office-service-zone')
    expect(serviceZone.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/workspace-rug-v2.png')
    expect(inbox.dataset.hasActivity).toBe('true')
    expect(inbox.dataset.attention).toBe('true')
    expect(inbox.dataset.fresh).toBeUndefined()
    expect(inbox.querySelector('.oa-office-map-service__signal')?.textContent).toBe('2')
    expect(news.dataset.fresh).toBe('true')
    expect(news.querySelector('.oa-office-map-service__signal')?.textContent).toBe('9+')
    const operations = screen.getByRole('button', { name: 'Operations board · 1 pending' })
    expect(operations.dataset.hasActivity).toBe('true')
    expect(operations.dataset.attention).toBe('true')
    expect(operations.querySelector('.oa-office-operations-board__signal')?.textContent).toBe('1')
    const inboxPrompt = screen.getByRole('status', {
      name: 'Open Inbox · codex · Agent report delivered',
    })
    expect(inboxPrompt.dataset.kind).toBe('inbox-service')
    expect(inboxPrompt.dataset.layout).toBe('service')
    expect(inboxPrompt.style.width).toBe('280px')
    expect(inboxPrompt.textContent).toContain('Check mail')
    expect(inboxPrompt.textContent).toContain('codex · Agent report delivered')

    expect(inbox.dataset.nearby).toBe('true')
    inbox.focus()
    fireEvent.keyDown(inbox, { key: 'Enter' })
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('inbox', 11))
    expect(document.activeElement).toBe(inbox)
    onOpenService.mockClear()
    fireEvent.keyDown(inbox, { key: ' ' })
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('inbox', 11))
    onOpenService.mockClear()

    await userEvent.click(inbox)
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('inbox', 11))
    await userEvent.click(news)
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('news', 12))
    expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.direction)
      .toBe('up')
  })

  it('returns a one-shot landmark receipt after a guided HUD duty is acknowledged', async () => {
    const onOpenService = vi.fn()
    const onOpenDuty = vi.fn()
    const building = {
      config: {
        workspaceSleepAfterMs: 1,
        harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
      },
      lastSeq: 11,
      firstSeq: 1,
      offices: [{
        workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' as const },
        lastInteractionAt: 1,
        sleeping: false,
        employees: [],
      }],
    }
    const activity = {
      agent: null,
      inbox: {
        seq: 11,
        occurredAt: 1_100,
        detail: 'Agent report delivered',
        source: 'codex',
        inboxEntryId: 'inbox-11',
      },
      news: null,
      attention: { agent: false, inbox: true, news: false },
      pending: { agent: 0, inbox: 1, news: 0 },
      freshKind: null,
    }
    const props = {
      building,
      initialPlayerState: { position: { x: 340, y: 600 }, direction: 'up' as const },
      onSelectEmployee: vi.fn(),
      onOpenEmployee: vi.fn(),
      onOpenWorkspace: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenRoster: vi.fn(),
      onOpenLog: vi.fn(),
      onOpenService,
      onOpenDuty,
    }
    const view = render(<OfficeBuilding {...props} productActivity={activity} />)

    const inbox = screen.getByRole('button', { name: 'Inbox station · 1 pending' })
    await userEvent.click(screen.getByRole('button', { name: 'Next duty: Inbox station, 1 pending' }))
    await waitFor(() => expect(onOpenDuty).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inbox',
      targetId: 'inbox-service',
    })))
    expect(onOpenService).not.toHaveBeenCalled()

    const acknowledgedActivity = {
      ...activity,
      attention: { ...activity.attention, inbox: false },
    }
    view.rerender(
      <OfficeBuilding
        {...props}
        interactionSuspended
        productActivity={activity}
      />,
    )
    expect(inbox.querySelector('.oa-office-landmark-ack')).toBeNull()

    // The real receipt closes the modal in the same React batch that clears attention.
    view.rerender(<OfficeBuilding {...props} productActivity={acknowledgedActivity} />)
    await waitFor(() => expect(inbox.dataset.acknowledged).toBe('true'))
    expect(inbox.querySelector('.oa-office-landmark-ack')?.textContent).toBe('OK')
    await waitFor(() => expect(inbox.dataset.acknowledged).toBeUndefined(), { timeout: 1_500 })
  })
})
