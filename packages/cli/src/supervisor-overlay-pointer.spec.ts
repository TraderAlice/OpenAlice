import { describe, expect, it, vi } from 'vitest'

import {
  resolveSupervisorOverlayPosition,
  SupervisorOverlayPointerRouter,
  supervisorVisibleListIndexes,
} from './supervisor-overlay-pointer.ts'

const pointer = (col: number, row: number, kind: 'click' | 'motion' | 'down' = 'click') => ({
  button: kind === 'down' ? 65 : kind === 'motion' ? 32 : 0,
  col,
  row,
  release: false,
  wheel: kind === 'down' ? 1 as const : null,
  motion: kind === 'motion',
  leftClick: kind === 'click',
})

describe('Supervisor overlay pointer routing', () => {
  it('matches centered pi-tui overlay placement with margins', () => {
    expect(resolveSupervisorOverlayPosition(72, 10, 100, 30, {
      anchor: 'center', margin: 1,
    })).toEqual({ col: 14, row: 10 })
    expect(resolveSupervisorOverlayPosition(100, 40, 80, 24, {
      anchor: 'center', margin: 1,
    })).toEqual({ col: 1, row: 1 })
    expect(resolveSupervisorOverlayPosition(20, 6, 80, 24, {
      anchor: 'left-center', margin: { left: 3, top: 2, bottom: 2 }, offsetY: 1,
    })).toEqual({ col: 3, row: 10 })
  })

  it('routes hover, click, wheel, and rendered command keycaps', () => {
    const select = vi.fn()
    const activate = vi.fn()
    const move = vi.fn()
    const input = vi.fn()
    const router = new SupervisorOverlayPointerRouter()
    router.capture({
      lines: ['╭ Picker ╮', '│ one    │', '│ two    │', '│ [ Esc ]│', '╰────────╯'],
      width: 10,
      terminalWidth: 20,
      terminalHeight: 9,
      options: { anchor: 'center', margin: 1 },
      list: { firstRow: 2, indexes: [3, 4], select, activate, move },
      input,
    })

    expect(router.route(pointer(7, 5, 'motion'))).toBe(true)
    expect(select).toHaveBeenLastCalledWith(4)
    expect(router.route(pointer(7, 4))).toBe(true)
    expect(select).toHaveBeenLastCalledWith(3)
    expect(activate).toHaveBeenCalledOnce()
    expect(router.route(pointer(7, 4, 'down'))).toBe(true)
    expect(move).toHaveBeenCalledWith(1)
    expect(router.route(pointer(10, 6))).toBe(true)
    expect(input).toHaveBeenCalledWith('\u001b')
  })

  it('tracks the same centered window as SelectList and SettingsList', () => {
    expect(supervisorVisibleListIndexes(0, 10, 5)).toEqual([0, 1, 2, 3, 4])
    expect(supervisorVisibleListIndexes(5, 10, 5)).toEqual([3, 4, 5, 6, 7])
    expect(supervisorVisibleListIndexes(9, 10, 5)).toEqual([5, 6, 7, 8, 9])
  })
})
