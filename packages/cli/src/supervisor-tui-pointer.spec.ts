import { describe, expect, it, vi } from 'vitest'

import { supervisorTuiBaseStyle } from './supervisor-tui-palette.ts'
import { createSupervisorTerminalCanvas, parseSupervisorPointer } from './supervisor-tui-pointer.ts'

describe('Supervisor TUI pointer', () => {
  it('decodes click, hover, release, and wheel SGR reports', () => {
    expect(parseSupervisorPointer('\u001b[<0;12;4M')).toMatchObject({
      col: 12, row: 4, leftClick: true, motion: false, release: false, wheel: null,
    })
    expect(parseSupervisorPointer('\u001b[<35;8;9M')).toMatchObject({ motion: true, leftClick: false })
    expect(parseSupervisorPointer('\u001b[<32;8;9M')).toMatchObject({
      motion: true, leftClick: false, leftDrag: true,
    })
    expect(parseSupervisorPointer('\u001b[<0;12;4m')).toMatchObject({ release: true, leftClick: false })
    expect(parseSupervisorPointer('\u001b[<64;3;7M')?.wheel).toBe(-1)
    expect(parseSupervisorPointer('\u001b[<65;3;7M')?.wheel).toBe(1)
    expect(parseSupervisorPointer('up')).toBeNull()
  })

  it('enters and restores alternate-screen and mouse modes idempotently', () => {
    const write = vi.fn()
    const canvas = createSupervisorTerminalCanvas({ write }, { TERM: 'xterm-256color' })
    canvas.start()
    canvas.start()
    expect(canvas.active).toBe(true)
    expect(canvas.mouseEnabled).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0]).toContain('\u001b[?1049h')
    expect(write.mock.calls[0]![0]).toContain(`${supervisorTuiBaseStyle()}\u001b[2J`)
    expect(write.mock.calls[0]![0]).toContain('\u001b[?1006h')
    canvas.stop()
    canvas.stop()
    expect(canvas.active).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1]![0]).toContain('\u001b[?1006l')
    expect(write.mock.calls[1]![0]).toContain('\u001b[0m')
    expect(write.mock.calls[1]![0]).toContain('\u001b[?1049l')
  })

  it('respects dumb terminals and explicit mouse opt-out', () => {
    const dumbWrite = vi.fn()
    const dumb = createSupervisorTerminalCanvas({ write: dumbWrite }, { TERM: 'dumb' })
    dumb.start()
    expect(dumb.active).toBe(false)
    expect(dumbWrite).not.toHaveBeenCalled()
    const write = vi.fn()
    const keyboardOnly = createSupervisorTerminalCanvas({ write }, {
      TERM: 'xterm-256color', OPENALICE_TUI_MOUSE: '0',
    })
    keyboardOnly.start()
    expect(keyboardOnly.mouseEnabled).toBe(false)
    expect(write.mock.calls[0]![0]).not.toContain('\u001b[?1006h')
    keyboardOnly.stop()

    const lightCanvasWrite = vi.fn()
    const lightCanvas = createSupervisorTerminalCanvas({ write: lightCanvasWrite }, {
      TERM: 'xterm-256color', OPENALICE_TUI_DARK_CANVAS: '0',
    })
    lightCanvas.start()
    expect(lightCanvasWrite.mock.calls[0]![0]).not.toContain(supervisorTuiBaseStyle())
    lightCanvas.stop()
  })
})
