import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorReleaseObservatory,
  renderSupervisorReleaseObservatory,
} from './supervisor-release-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Release Observatory', () => {
  it('renders a wide lane map and selected Channel Brief', () => {
    const rendered = renderSupervisorReleaseObservatory({
      installedVersion: '0.91.0-beta.3',
      currentLane: 'beta',
      selected: 2,
    }, 92)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Release Observatory · 3 LANES')
    expect(output).toContain('Channel Brief · 3/3 · INSTALLED BETA')
    expect(output).toContain('› Dev')
    expect(output).toContain('◆ Dev · ◆ EDGE')
    expect(output).toContain('Installed · 0.91.0-beta.3 · BETA LANE')
    expect(output).toContain('◆ [ Enter ] Check  │  [ Esc ] Cancel')
    expect(output).not.toContain('…')
    expect(rendered.targets[2]).toEqual({ row: 4, startColumn: 2, endColumn: 41, index: 2 })
    expect(rendered.lines.every((line) => displayWidth(line) <= 92)).toBe(true)
  })

  it('stacks the same complete model within an 80-column overlay', () => {
    const rendered = renderSupervisorReleaseObservatory({
      installedVersion: '0.91.0',
      currentLane: 'stable',
      selected: 1,
    }, 72)
    const output = rendered.lines.join('\n')
    expect(output).toContain('CURRENT·STABLE')
    expect(output).toContain('◆ Beta · ◈ PREVIEW')
    expect(output).toContain('Update contract · Beta')
    expect(rendered.lines).toHaveLength(18)
    expect(rendered.lines.every((line) => displayWidth(line) <= 72)).toBe(true)
  })

  it('keeps whole-action hover visible with and without color', () => {
    const line = '│ ◆ [ Enter ] Check  │  [ Esc ] Cancel │'
    const color = decorateSupervisorReleaseObservatory(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorReleaseObservatory(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Check')
    expect(plain).toContain('│ › [ Enter ] Check')
  })
})
