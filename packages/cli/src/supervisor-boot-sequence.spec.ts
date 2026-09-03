import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  renderSupervisorBootSequence,
  supervisorBootSequenceEnabled,
  SUPERVISOR_BOOT_LAST_FRAME,
} from './supervisor-boot-sequence.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/gu, '')

describe('Supervisor Boot Sequence', () => {
  it('runs only for an animated color product session with explicit test opt-in', () => {
    expect(supervisorBootSequenceEnabled({ TERM: 'xterm-256color' })).toBe(true)
    expect(supervisorBootSequenceEnabled({ TERM: 'xterm-256color', NODE_ENV: 'test' })).toBe(false)
    expect(supervisorBootSequenceEnabled({
      TERM: 'xterm-256color', NODE_ENV: 'test', OPENALICE_TUI_BOOT: '1',
    })).toBe(true)
    expect(supervisorBootSequenceEnabled({ OPENALICE_TUI_BOOT: '0' })).toBe(false)
    expect(supervisorBootSequenceEnabled({}, false, true)).toBe(false)
    expect(supervisorBootSequenceEnabled({}, true, false)).toBe(false)
  })

  it('owns a complete wide viewport while advancing truthful control stages', () => {
    const theme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const first = renderSupervisorBootSequence(120, 32, 0, theme)
    const last = renderSupervisorBootSequence(120, 32, SUPERVISOR_BOOT_LAST_FRAME, theme)
    const firstPlain = first.map(stripAnsi)
    const lastPlain = last.map(stripAnsi)

    expect(first).toHaveLength(32)
    expect(firstPlain.every((line) => displayWidth(line) === 120)).toBe(true)
    expect(firstPlain.join('\n')).toContain('O P E N A L I C E')
    expect(firstPlain.join('\n')).toContain('◆ ALICEPROJECT')
    expect(firstPlain.join('\n')).toContain('◇ CONTROL')
    expect(lastPlain.join('\n')).toContain('◇ ALICEPROJECT')
    expect(lastPlain.join('\n')).toContain('◆ CONTROL')
    expect(lastPlain.join('\n')).toContain('press any key or click to enter')
    expect(last).not.toEqual(first)
  })

  it('keeps compact and short terminals complete without wrapping', () => {
    const theme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    for (const [width, height] of [[48, 14], [46, 12], [32, 7], [1, 1]] as const) {
      const lines = renderSupervisorBootSequence(width, height, 7, theme)
      expect(lines).toHaveLength(height)
      expect(lines.map(stripAnsi).every((line) => displayWidth(line) === width)).toBe(true)
    }
  })
})
