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
              employees: [],
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
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenFiles={onOpenFiles}
      />,
    )
    expect(screen.getByTestId('office-building')).toBeTruthy()
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    const map = screen.getByLabelText('Office map. Drag to pan; use arrows or WASD to move Alice.')
    expect(map).toBeTruthy()
    const alice = screen.getByRole('img', { name: 'Alice on the office map' })
    expect(alice.style.left).toBe('480px')
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
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 300, clientY: 250 })
    expect(map.querySelector<HTMLElement>('.oa-office-map')?.style.transform)
      .toBe('translate3d(-100px, -50px, 0)')
    fireEvent.pointerUp(map, { pointerId: 1 })
    expect(screen.getByTestId('office-pod-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-pod-quant-1')).toBeTruthy()
    expect(screen.queryByTestId('office-pod-quant-old')).toBeNull()
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
  })
})
