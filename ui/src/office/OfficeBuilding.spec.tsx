// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeBuilding } from './OfficeBuilding'

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
  it('keeps historical floors visibly in replay mode with a direct return to Live', async () => {
    const onReturnLive = vi.fn()
    const onSelectEmployee = vi.fn()
    const onOpenWorkspace = vi.fn()
    const onOpenFiles = vi.fn()
    const onOpenRoster = vi.fn()
    const { container } = render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 0, 'auto-quant': 0, prediction: 0, other: 0 },
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
          targetIds: [
            'employee:chat-replay:resume-5',
            'roster:chat-replay',
            'sign:chat-replay',
          ],
          label: 'Session 6',
        }}
        onSelectEmployee={onSelectEmployee}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenFiles={onOpenFiles}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
        onReturnLive={onReturnLive}
      />,
    )

    expect(screen.getByTestId('office-building').getAttribute('data-replay')).toBe('true')
    expect(screen.getByText('Replay floor · Seq 2')).toBeTruthy()
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

    expect(workspaceSign.disabled).toBe(true)
    expect(workspaceSign.textContent).toContain('2/6 active')
    expect(workspaceSign.dataset.replayLabel).toBe('Snapshot')
    expect(occupiedDesks.every((desk) => desk.disabled)).toBe(true)
    expect(cabinet.disabled).toBe(true)
    expect(roster.disabled).toBe(true)
    expect(terminal.disabled).toBe(true)
    expect(operations.disabled).toBe(false)
    const replayBeacon = screen.getByRole('status', { name: 'Seq 2 · Session 6' })
    expect(replayBeacon.dataset.kind).toBe('roster')
    expect(replayBeacon.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-destination-v1.png')
    fireEvent.click(workspaceSign)
    fireEvent.click(occupiedDesks[0])
    fireEvent.click(cabinet)
    fireEvent.click(roster)
    expect(onOpenWorkspace).not.toHaveBeenCalled()
    expect(onSelectEmployee).not.toHaveBeenCalled()
    expect(onOpenFiles).not.toHaveBeenCalled()
    expect(onOpenRoster).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(onReturnLive).toHaveBeenCalledTimes(1)
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

    expect(screen.getByText('Replay floor · Seq 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Live$/ })).toBeNull()
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
    const spawnCompass = screen.getByTestId('office-spawn-compass')
    const quietNotice = screen.getByRole('status')
    expect(map).toBeTruthy()
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('336px')
    expect(alice.textContent).toBe('')
    expect(spawnCompass.style.left).toBe(alice.style.left)
    expect(spawnCompass.style.top).toBe(alice.style.top)
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
      expect(`${alice.style.left}:${alice.style.top}`).toBe('497px:295px')
      expect(alice.dataset.direction).toBe('right')
      act(() => vi.advanceTimersByTime(96))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('514px:278px')
      fireEvent.keyUp(map, { key: 'd' })
      fireEvent.keyUp(map, { key: 'w' })
      act(() => vi.advanceTimersByTime(192))
      expect(`${alice.style.left}:${alice.style.top}`).toBe('514px:278px')
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
    expect(prompt.style.width).toBe('200px')
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
      fireEvent.keyUp(map, { key: 'w' })
      expect(Number(screen.getByTestId('office-collision-impact').dataset.serial)).toBe(firstSerial + 1)
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByTestId('office-collision-impact')).toBeNull()
      expect(screen.getByRole('img', { name: 'Alice on the office map' }).dataset.bumped).toBe('false')
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
      fireEvent.click(screen.getByRole('button', { name: 'Center map on Alice' }))
      expect(`${alice.style.left}:${alice.style.top}`).toBe(routePosition)
      expect(sign.dataset.route).toBe('true')
      expect(screen.getByTestId('office-route-trail')).toBeTruthy()
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
      fireEvent.keyDown(map, { key: 'Escape' })
      expect(screen.queryByTestId('office-route-status')).toBeNull()
      expect(screen.queryByTestId('office-route-trail')).toBeNull()
      expect(quantSign.dataset.route).toBe('false')

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
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    expect(map).toBeTruthy()
    expect(map.querySelector<HTMLImageElement>('.oa-office-map-service[data-kind="inbox"] img')?.src)
      .toContain('/office/furniture/inbox-terminal-v1.png')
    expect(map.querySelector<HTMLImageElement>('.oa-office-map-service[data-kind="news"] img')?.src)
      .toContain('/office/furniture/news-terminal-v1.png')
    const mapWall = map.querySelector<HTMLElement>('.oa-office-map-wall')
    expect(mapWall?.style.getPropertyValue('--office-wall-day'))
      .toContain('/office/furniture/wall-window-v2.png')
    expect(mapWall?.style.getPropertyValue('--office-wall-night'))
      .toContain('/office/furniture/wall-window-night-v2.png')
    const utilityWall = mapWall?.querySelector<HTMLImageElement>('[data-kind="operations-utility"]')
    expect(utilityWall?.src).toContain('/office/furniture/wall-utility-night-v1.png')
    expect(utilityWall?.style.left).toBe('408px')
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
    expect(screen.getByRole('button', { name: 'Center map on Alice' }).querySelector('img')?.src)
      .toContain('/office/hud/reset-compass-v2.png')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('480px')
    const spawnCompass = screen.getByTestId('office-spawn-compass')
    expect((spawnCompass as HTMLImageElement).src).toContain('/office/furniture/spawn-compass-v2.png')
    expect(spawnCompass.style.left).toBe('480px')
    expect(spawnCompass.style.top).toBe(alice.style.top)
    const operations = screen.getByRole('button', { name: 'Operations board' })
    expect(operations.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/operations-board-v2.png')
    const floorTerminal = screen.getByRole('button', { name: 'Floor terminal' })
    expect(floorTerminal.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/terminal-kiosk-v2.png')
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
    expect(document.activeElement).toBe(document.body)
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
    expect(interactionPrompt.style.width).toBe('176px')
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
    await userEvent.click(screen.getByRole('button', { name: 'Center map on Alice' }))
    expect(`${alice.style.left}:${alice.style.top}`).toBe(cabinetPosition)
    expect(controls?.dataset.learned).toBe('true')
    await userEvent.click(map)
    await userEvent.keyboard('wwd')
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('336px')
    await userEvent.keyboard('wwww')
    expect(alice.style.top).toBe('264px')
    expect(screen.getByRole('status', { name: 'Check live operations' }).querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/occupancy-log-v2.png')
    expect(operations.dataset.nearby).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(onOpenLog).toHaveBeenCalledWith('operations')
    await userEvent.click(screen.getByRole('button', { name: 'Center map on Alice' }))
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
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.queryByTestId('office-pod-quant-old')).toBeNull()
    expect(screen.getByTestId('office-pod-chat-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/coffee-station-v2.png')
    expect(screen.getByTestId('office-pod-quant-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/server-rack-v2.png')
    const workspaceSign = screen.getByRole('button', { name: /Enter chat workspace/ })
    await userEvent.click(workspaceSign)
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('chat-1'))
    const menuTrigger = screen.getByRole('button', { name: 'Menu' })
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
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All groups' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(screen.getByTestId('office-pod-quant-old')).toBeTruthy()
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
    await userEvent.click(floorTerminal)
    await waitFor(() => {
      expect(screen.getByRole('menu', { name: 'Menu' })).toBeTruthy()
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    }, { timeout: 10_000 })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(floorTerminal))
    onOpenLog.mockClear()
    await userEvent.click(floorTerminal)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Activity log' }))
    expect(onOpenLog).toHaveBeenCalledWith('floor-terminal')
    await userEvent.click(screen.getByRole('button', { name: 'Filing cabinet · chat' }))
    await waitFor(() => expect(onOpenFiles).toHaveBeenCalledWith('chat-1'))
    await userEvent.click(operations)
    await waitFor(() => expect(onOpenLog).toHaveBeenCalledWith('operations'))
  }, 15_000)

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
    const { container } = render(
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
          freshKind: 'news',
        }}
        initialPlayerState={{ position: { x: 340, y: 570 }, direction: 'down' }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
        onOpenService={onOpenService}
      />,
    )

    const inbox = screen.getByRole('button', { name: 'Inbox station · New activity' })
    const news = screen.getByRole('button', { name: 'News terminal · New activity' })
    const serviceZone = screen.getByTestId('office-service-zone')
    expect(serviceZone.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/workspace-rug-v2.png')
    expect(inbox.dataset.hasActivity).toBe('true')
    expect(inbox.dataset.attention).toBe('true')
    expect(inbox.dataset.fresh).toBeUndefined()
    expect(inbox.querySelector('.oa-office-map-service__signal')?.textContent).toBe('!')
    expect(news.dataset.fresh).toBe('true')
    expect(news.querySelector('.oa-office-map-service__signal')?.textContent).toBe('!')
    const operations = screen.getByRole('button', { name: 'Operations board · New activity' })
    expect(operations.dataset.hasActivity).toBe('true')
    expect(operations.dataset.attention).toBe('true')
    expect(operations.querySelector('.oa-office-operations-board__signal')?.textContent).toBe('!')
    const inboxPrompt = screen.getByRole('status', {
      name: 'Open Inbox · codex · Agent report delivered',
    })
    expect(inboxPrompt.dataset.kind).toBe('inbox-service')
    expect(inboxPrompt.style.width).toBe('280px')
    expect(inboxPrompt.textContent).toContain('Check mail')
    expect(inboxPrompt.textContent).toContain('codex · Agent report delivered')

    await userEvent.click(inbox)
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('inbox', 11))
    await userEvent.click(news)
    await waitFor(() => expect(onOpenService).toHaveBeenCalledWith('news', 12))
    expect(container.querySelector('[data-kind="news-service"]')).toBeTruthy()
  })
})
