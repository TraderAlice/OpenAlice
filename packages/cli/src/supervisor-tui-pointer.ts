/**
 * SGR pointer decoding and terminal mouse-mode lifecycle follow the MIT-licensed
 * Oh My Pi TUI implementation. Keep THIRD_PARTY_NOTICES.md with distributed
 * copies of this module.
 */

import { supervisorTuiBaseStyle } from './supervisor-tui-palette.ts'

export interface SupervisorPointerEvent {
  button: number
  col: number
  row: number
  release: boolean
  wheel: -1 | 1 | null
  motion: boolean
  leftClick: boolean
  leftDrag?: boolean
}

export interface SupervisorTerminalCanvas {
  active: boolean
  mouseEnabled: boolean
  start(): void
  stop(): void
}

interface WritableTerminal {
  write?(chunk: string): unknown
}

const ALT_SCREEN_ENTER = '\u001b[?1049h'
const ALT_SCREEN_EXIT = '\u001b[?1049l'
const CLEAR_SCREEN = '\u001b[2J\u001b[H'
const RESET_STYLE = '\u001b[0m'
const DARK_CANVAS_STYLE = supervisorTuiBaseStyle()
const MOUSE_TRACKING_ON = '\u001b[?1000h\u001b[?1003h\u001b[?1006h'
const MOUSE_TRACKING_OFF = '\u001b[?1006l\u001b[?1003l\u001b[?1000l'

export function parseSupervisorPointer(
  data: string,
): SupervisorPointerEvent | null {
  const match = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/u.exec(data)
  if (!match) return null
  const button = Number(match[1])
  const col = Number(match[2])
  const row = Number(match[3])
  if (![button, col, row].every(Number.isSafeInteger) || col < 1 || row < 1) return null
  const release = match[4] === 'm'
  const wheel = button & 64 ? (button & 1 ? 1 : -1) as 1 | -1 : null
  const motion = (button & 32) !== 0 && wheel === null
  const leftClick = !release && wheel === null && !motion && (button & 3) === 0
  const leftDrag = motion && (button & 3) === 0
  return { button, col, row, release, wheel, motion, leftClick, leftDrag }
}

export function createSupervisorTerminalCanvas(
  output: WritableTerminal,
  env: NodeJS.ProcessEnv = process.env,
): SupervisorTerminalCanvas {
  const canWrite = typeof output.write === 'function'
  const alternateScreen = canWrite
    && env['TERM'] !== 'dumb'
    && env['OPENALICE_TUI_ALT_SCREEN'] !== '0'
  const mouseEnabled = alternateScreen && env['OPENALICE_TUI_MOUSE'] !== '0'
  const darkCanvas = alternateScreen
    && env['NO_COLOR'] === undefined
    && env['OPENALICE_TUI_COLOR'] !== '0'
    && env['OPENALICE_TUI_DARK_CANVAS'] !== '0'
  let active = false
  return {
    get active() { return active },
    mouseEnabled,
    start(): void {
      if (active || !alternateScreen) return
      active = true
      output.write?.(`${ALT_SCREEN_ENTER}${darkCanvas ? DARK_CANVAS_STYLE : ''}${CLEAR_SCREEN}${mouseEnabled ? MOUSE_TRACKING_ON : ''}`)
    },
    stop(): void {
      if (!active) return
      active = false
      output.write?.(`${mouseEnabled ? MOUSE_TRACKING_OFF : ''}${RESET_STYLE}${ALT_SCREEN_EXIT}`)
    },
  }
}
