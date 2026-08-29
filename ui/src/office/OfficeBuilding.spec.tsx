// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
        onOpenFiles={vi.fn()}
        onOpenRoster={vi.fn()}
        onOpenLog={vi.fn()}
      />,
    )

    const building = screen.getByTestId('office-building')
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    const spawnCompass = screen.getByTestId('office-spawn-compass')
    const quietNotice = screen.getByRole('status')
    expect(map).toBeTruthy()
    expect(alice.style.left).toBe('480px')
    expect(alice.style.top).toBe('336px')
    expect(spawnCompass.style.left).toBe(alice.style.left)
    expect(spawnCompass.style.top).toBe(alice.style.top)
    expect(quietNotice.dataset.kind).toBe('empty')
    expect(screen.getByText('No Workspace yet')).toBeTruthy()
    expect(screen.getByText('No one is at a desk in this office. Active Sessions appear here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'All groups' })).toBeNull()
    expect(building.querySelector<HTMLImageElement>('.oa-office-quiet__radar img')?.src)
      .toContain('/office/hud/signal-receiver-v1.png')
    expect(building.querySelector('svg')).toBeNull()
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
                mood: 'working',
                bubble: null,
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
        onOpenFiles={onOpenFiles}
        onOpenRoster={onOpenRoster}
        onOpenLog={onOpenLog}
      />,
    )
    expect(screen.getByTestId('office-building').dataset.officeTime).toBe('night')
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    expect(map).toBeTruthy()
    const mapWall = map.querySelector<HTMLElement>('.oa-office-map-wall')
    expect(mapWall?.style.getPropertyValue('--office-wall-day'))
      .toContain('/office/furniture/wall-window-v1.png')
    expect(mapWall?.style.getPropertyValue('--office-wall-night'))
      .toContain('/office/furniture/wall-window-night-v1.png')
    const controls = map.parentElement?.querySelector<HTMLElement>('.oa-office-map-controls')
    expect(controls?.dataset.learned).toBe('false')
    expect(controls?.querySelector<HTMLImageElement>('.oa-office-map-controls__move img')?.src)
      .toContain('/office/hud/move-pad-v1.png')
    expect(screen.getByTestId('office-building').querySelector<HTMLImageElement>('.oa-office-hud__signal img')?.src)
      .toContain('/office/hud/signal-receiver-v1.png')
    expect(screen.getByTestId('office-building').querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset map view' }).querySelector('img')?.src)
      .toContain('/office/hud/reset-compass-v1.png')
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('480px')
    const spawnCompass = screen.getByTestId('office-spawn-compass')
    expect((spawnCompass as HTMLImageElement).src).toContain('/office/furniture/spawn-compass-v1.png')
    expect(spawnCompass.style.left).toBe('480px')
    expect(spawnCompass.style.top).toBe(alice.style.top)
    const operations = screen.getByRole('button', { name: 'Operations board' })
    expect(operations.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/operations-board-v1.png')
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
    fireEvent.pointerDown(map, { pointerId: 2, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 402, clientY: 301 })
    expect(controls?.dataset.learned).toBe('false')
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 404, clientY: 300 })
    expect(controls?.dataset.learned).toBe('true')
    fireEvent.pointerUp(map, { pointerId: 2 })
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
    await userEvent.keyboard('aasss')
    expect(screen.getByText('Open chat files')).toBeTruthy()
    const interactionPrompt = screen.getByRole('status')
    expect(interactionPrompt.classList.contains('oa-office-interact-prompt')).toBe(true)
    expect(interactionPrompt.parentElement?.classList.contains('oa-office-map')).toBe(true)
    expect(interactionPrompt.dataset.side).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    expect(onOpenFiles).toHaveBeenCalledWith('chat-1')
    await userEvent.click(screen.getByRole('button', { name: 'Reset map view' }))
    expect(controls?.dataset.learned).toBe('true')
    await userEvent.click(map)
    await userEvent.keyboard('wwww')
    expect(alice.style.top).toBe('264px')
    expect(screen.getByText('Check live operations')).toBeTruthy()
    expect(operations.dataset.nearby).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(onOpenLog).toHaveBeenCalledWith('operations')
    await userEvent.click(screen.getByRole('button', { name: 'Reset map view' }))
    await userEvent.click(map)
    await userEvent.keyboard('wwwaaaaaaaasss')
    expect(alice.style.left).toBe('288px')
    expect(alice.style.top).toBe('288px')
    expect(screen.getByText('Talk to Desk mate')).toBeTruthy()
    expect(screen.getByTestId('office-desk-resume-alice').dataset.nearby).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(onSelectEmployee).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ resumeId: 'resume-alice' }),
    )
    expect(screen.getByTestId('office-pod-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.queryByTestId('office-pod-quant-old')).toBeNull()
    expect(screen.getByTestId('office-pod-chat-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/coffee-station-v1.png')
    expect(screen.getByTestId('office-pod-quant-1').querySelector<HTMLImageElement>('.oa-office-pod__harness-prop')?.src)
      .toContain('/office/furniture/server-rack-v1.png')
    const workspaceSign = screen.getByRole('button', { name: 'Open chat files' })
    await userEvent.click(workspaceSign)
    expect(onOpenFiles).toHaveBeenCalledWith('chat-1')
    const menuTrigger = screen.getByRole('button', { name: 'Menu' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const pauseMenu = screen.getByRole('menu', { name: 'Menu' })
    expect(pauseMenu.querySelector<HTMLImageElement>('.oa-office-pause-menu__header img')?.src)
      .toContain('/office/hud/menu-terminal-v1.png')
    expect(screen.getByRole('menuitemradio', { name: 'Live map' }).querySelector('img')?.src)
      .toContain('/office/hud/reset-compass-v1.png')
    expect(screen.getByRole('menuitemradio', { name: 'All groups' }).querySelector('img')?.src)
      .toContain('/office/hud/group-grid-v1.png')
    expect(screen.getByRole('menuitem', { name: 'Occupancy log' }).querySelector('img')?.src)
      .toContain('/office/hud/occupancy-log-v1.png')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All groups' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(screen.getByTestId('office-pod-quant-old')).toBeTruthy()
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All groups' }))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Live map' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull()
    expect(screen.getByTestId('office-pod-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-old')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Filing cabinet · chat' }))
    expect(onOpenFiles).toHaveBeenCalledWith('chat-1')
    await userEvent.click(operations)
    expect(onOpenLog).toHaveBeenCalledWith('operations')
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
        onOpenFiles={vi.fn()}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId(/^office-desk-/)).toHaveLength(4)
    const board = screen.getByRole('button', { name: 'Team roster · chat' })
    expect(board.querySelector('img')?.getAttribute('src')).toBe('/office/furniture/personnel-board-v1.png')
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    map.focus()
    await userEvent.keyboard('aw')
    expect(screen.getByText('View chat roster')).toBeTruthy()
    expect(board.dataset.nearby).toBe('true')

    view.rerender(
      <OfficeBuilding
        building={building}
        interactionSuspended
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenFiles={vi.fn()}
        onOpenRoster={onOpenRoster}
        onOpenLog={vi.fn()}
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(board.dataset.nearby).toBe('false')

    await userEvent.click(board)
    expect(onOpenRoster).toHaveBeenCalledWith('chat-full')
  })
})
