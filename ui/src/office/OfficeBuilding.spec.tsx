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
    expect(screen.getByTestId('office-building')).toBeTruthy()
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice; press Enter or Space to interact nearby.')
    expect(map).toBeTruthy()
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('480px')
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
    await userEvent.click(map)
    await userEvent.keyboard('d')
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
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menu', { name: 'Floor view' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Floor view' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'All groups' }))
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
    render(
      <OfficeBuilding
        building={{
          config: {
            workspaceSleepAfterMs: 1,
            harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 0, prediction: 0, other: 0 },
          },
          lastSeq: 1,
          firstSeq: 1,
          offices: [{
            workspace: { id: 'chat-full', tag: 'chat', harness: 'chat' },
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
        }}
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
    await userEvent.click(board)
    expect(onOpenRoster).toHaveBeenCalledWith('chat-full')
  })
})
