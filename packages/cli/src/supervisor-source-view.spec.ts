import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorSourceLaunchBay,
  renderSupervisorSourceLaunchBay,
  supervisorSourceFieldWidth,
} from './supervisor-source-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Runtime Source Launch Bay', () => {
  it('pairs the complete source route with a focused inspector', () => {
    const rendered = renderSupervisorSourceLaunchBay({
      phase: 'select',
      projectName: 'Default AliceProject',
      provenance: 'project config',
      fieldLines: ['> /Users/alice/OpenAlice'],
      detail: 'Choose the OpenAlice source checkout.',
      contract: 'Validate before saving; launch only follows a saved checkout.',
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Source route · SELECT CHECKOUT')
    expect(output).toContain('Runtime Source · AliceProject setting')
    expect(output).toContain('◆ 01 Select')
    expect(output).toContain('· 04 Launch')
    expect(output).toContain('◆ [ Enter ] Save & start  │  [ Esc ] Cancel')
    expect(output).toContain('Launch contract · SELECT CHECKOUT')
    expect(output).not.toContain('…')
    expect(rendered.lines.every((line) => displayWidth(line) <= 100)).toBe(true)
    expect(supervisorSourceFieldWidth(100)).toBe(59)
  })

  it('keeps rejection and the whole route visible at the narrow baseline', () => {
    const rendered = renderSupervisorSourceLaunchBay({
      phase: 'error',
      projectName: 'Default AliceProject',
      provenance: 'automatic',
      fieldLines: ['> /not/openalice'],
      detail: 'Could not use that checkout.',
      contract: 'Validate before saving; launch only follows a saved checkout.',
    }, 72)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Source Launch Bay · REJECTED')
    expect(output).toContain('✓ Select  ! Validate  · Save  · Launch')
    expect(output).toContain('◆ CONTRACT')
    expect(rendered.lines.every((line) => displayWidth(line) <= 72)).toBe(true)
    expect(supervisorSourceFieldWidth(72)).toBe(68)
  })

  it('keeps whole-action hover visible with and without color', () => {
    const line = '│ ◆ [ Enter ] Save & start  │  [ Esc ] Cancel │'
    const color = decorateSupervisorSourceLaunchBay(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorSourceLaunchBay(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Save & start')
    expect(plain).toContain('│ › [ Enter ] Save & start')
  })
})
