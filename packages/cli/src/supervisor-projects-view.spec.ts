import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorProjectSwitchboard,
  renderSupervisorProjectSwitchboard,
  type SupervisorProjectSwitchboardItem,
} from './supervisor-projects-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor AliceProject Switchboard', () => {
  const items: SupervisorProjectSwitchboardItem[] = [
    { key: 'default', label: 'Default AliceProject', kind: 'project', home: '/Users/alice/.openalice', port: 47331, portAutomatic: true, current: true, isDefault: true },
    { key: 'research', label: 'Research', kind: 'project', home: '/Users/alice/.openalice-research', port: 48001, portAutomatic: false },
    { key: '__create__', label: '+ Create AliceProject…', kind: 'create' },
  ]

  it('renders a wide project map and Inspector with split-pane targets', () => {
    const rendered = renderSupervisorProjectSwitchboard({
      currentProjectName: 'Default AliceProject',
      message: 'Selecting an AliceProject also makes it the next bare-start default.',
      locked: false,
      items,
      selected: 1,
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('AliceProject Switchboard · 2 PROJECTS')
    expect(output).toContain('Inspector · 2/3 · SELECT & CREATE')
    expect(output).toContain('› Research')
    expect(output).toContain('Home · /Users/alice/.openalice-research')
    expect(output).toContain('◆ [ Enter ] Select  │  [ Esc ] Done')
    expect(rendered.targets[1]).toEqual({ row: 3, startColumn: 2, endColumn: 48, index: 1 })
    expect(rendered.lines.every((line) => displayWidth(line) <= 100)).toBe(true)
  })

  it('stacks the complete read-only model at the 80-column baseline', () => {
    const rendered = renderSupervisorProjectSwitchboard({
      currentProjectName: 'Research',
      message: 'AliceProject selection is read-only. Locked by --instance.',
      locked: true,
      items: items.slice(0, 2),
      selected: 0,
    }, 72)
    const output = rendered.lines.join('\n')
    expect(output).toContain('AliceProject Switchboard · 2 PROJECTS')
    expect(output).toContain('Inspector · 1/2 · READ ONLY')
    expect(output).toContain('Role · CURRENT CONTEXT · BARE-START DEFAULT')
    expect(output).toContain('◆ [ Esc ] Done')
    expect(output).not.toContain('[ Enter ] Select')
    expect(rendered.lines.every((line) => displayWidth(line) <= 72)).toBe(true)
  })

  it('renders a proportional rail when the project map exceeds eight rows', () => {
    const many = Array.from({ length: 11 }, (_, index): SupervisorProjectSwitchboardItem => ({
      key: `project-${index}`,
      label: `Project ${index}`,
      kind: 'project',
      home: `/srv/project-${index}`,
      port: 47000 + index,
      portAutomatic: true,
    }))
    const rendered = renderSupervisorProjectSwitchboard({
      currentProjectName: 'Project 9',
      message: 'Choose a project.',
      locked: false,
      items: many,
      selected: 9,
    }, 100)
    expect(rendered.lines.join('\n')).toContain('› Project 9')
    expect(rendered.lines.some((line) => line.includes('█'))).toBe(true)
    expect(rendered.targets.map((target) => target.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])

    const narrow = renderSupervisorProjectSwitchboard({
      currentProjectName: 'Project 9',
      message: 'Selecting an AliceProject also makes it the next bare-start default. Copy credentials separately.',
      locked: false,
      items: many,
      selected: 9,
    }, 72)
    expect(narrow.targets.map((target) => target.index)).toEqual([6, 7, 8, 9, 10])
    expect(narrow.lines).toHaveLength(21)
    expect(narrow.lines.every((line) => displayWidth(line) <= 72)).toBe(true)

    const short = renderSupervisorProjectSwitchboard({
      currentProjectName: 'Project 9',
      message: 'Choose a project.',
      locked: false,
      items: many,
      selected: 9,
      maxVisible: 2,
    }, 72)
    expect(short.targets.map((target) => target.index)).toEqual([8, 9])
    expect(short.lines.length).toBeLessThanOrEqual(18)
  })

  it('keeps the complete action hover visible with and without color', () => {
    const line = '│ ◆ [ Enter ] Select  │  [ Esc ] Done │'
    const color = decorateSupervisorProjectSwitchboard(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorProjectSwitchboard(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Select')
    expect(plain).toContain('│ › [ Enter ] Select')
  })
})
