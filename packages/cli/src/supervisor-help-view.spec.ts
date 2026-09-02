import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-fleet.ts'
import {
  createSupervisorHelpState,
  moveSupervisorHelpSelection,
  renderSupervisorHelp,
  selectSupervisorHelpBoundary,
} from './supervisor-help-view.ts'

describe('Supervisor Help control atlas', () => {
  it('renders a wide list-detail inspector with whole-row targets', () => {
    const rendered = renderSupervisorHelp({ selected: 1, hovered: 2 }, false, 110)
    const output = rendered.lines.join('\n')

    expect(output).toContain('Control atlas · 2/3')
    expect(output).toContain('› ● Runtime')
    expect(output).toContain('» ◇ AliceProject')
    expect(output).toContain('Runtime · Read state, then act')
    expect(output).toContain('[ r ] Restart local / check remote target')
    expect(output).toContain('[ x ] Stop local / disconnect remote target')
    expect(output).toContain('◆ [ ? ] Close Help')
    expect(rendered.targets).toEqual([
      { index: 0, row: 2, startColumn: 2, endColumn: 31 },
      { index: 1, row: 3, startColumn: 2, endColumn: 31 },
      { index: 2, row: 4, startColumn: 2, endColumn: 31 },
    ])
  })

  it('uses a tall wide viewport for a task-led Help console', () => {
    const rendered = renderSupervisorHelp({ selected: 1, hovered: 2 }, false, 120, 22)
    const output = rendered.lines.join('\n')

    expect(rendered.lines).toHaveLength(22)
    expect(output).toContain('Help · START · SEARCH · SWITCH')
    expect(output).toContain('NOW · Fast routes')
    expect(output).toContain('[ Enter ] Start / connect / open')
    expect(output).toContain('[ / ] Find any command')
    expect(output).toContain('[ i ] Choose an AliceProject')
    expect(output).toContain('  ◆ Navigation  Move with intent')
    expect(output).toContain('› ● Runtime  Read state, then act')
    expect(output).toContain('» ◇ AliceProject  Shape the workspace')
    expect(output).toContain('● SELECTED · RUNTIME')
    expect(output).toContain('Runtime leads with the session Connection Chronicle; local mutations')
    expect(output).toContain('keep confirmation while remote targets expose only safe link controls.')
    expect(output).toContain('[ Enter ] Run the contextual primary action')
    expect(output).toContain('[ x ] Stop local / disconnect remote target')
    expect(output).toContain('◆ [ ? ] Close Help')
    expect(rendered.targets).toHaveLength(3)
    expect(rendered.targets.every((target) => (
      target.startColumn === 2 && target.endColumn === 41
    ))).toBe(true)
    expect(rendered.lines.every((line) => displayWidth(line) === 120)).toBe(true)

    const boundary = renderSupervisorHelp({ selected: 0, hovered: null }, false, 100, 22)
    expect(boundary.lines).toHaveLength(22)
    expect(boundary.lines.join('\n')).toContain('Help · START · SEARCH · SWITCH')
    expect(renderSupervisorHelp({ selected: 1, hovered: null }, false, 100, 22)
      .lines.join('\n')).toContain('safe link controls.')
    expect(renderSupervisorHelp({ selected: 0, hovered: null }, false, 100, 21)
      .lines.join('\n')).not.toContain('START · SEARCH · SWITCH')
  })

  it('folds the same selected group into a narrow card', () => {
    const rendered = renderSupervisorHelp({ selected: 2, hovered: null }, false, 46)
    const output = rendered.lines.join('\n')

    expect(output).toContain('Help · START · SEARCH · SWITCH · 3/3')
    expect(output).toContain('NOW · [ Enter ] Act')
    expect(output).toContain('[ / ] Find · [ i ] AliceProject')
    expect(output).toContain('› ◇ AliceProject')
    expect(output).toContain('[ i ] Choose or create an AliceProject')
    expect(output).toContain('[ / ] Open the Command Dock')
    expect(output).toContain('◆ [ ? ] Close Help')
    expect(rendered.targets).toHaveLength(3)
    expect(rendered.targets[0]?.row).toBe(4)
    expect(rendered.lines.every((line) => displayWidth(line) <= 46)).toBe(true)
    expect(rendered.lines.length).toBeLessThanOrEqual(16)

    const baseline = renderSupervisorHelp({ selected: 0, hovered: null }, false, 80, 19)
    const baselineOutput = baseline.lines.join('\n')
    expect(baselineOutput).toContain('Help · START · SEARCH · SWITCH · 1/3')
    expect(baselineOutput).toContain(
      'NOW · [ Enter ] Start/connect/open · [ / ] Find · [ i ] AliceProject',
    )
    expect(baseline.targets[0]?.row).toBe(3)
    expect(baseline.lines.length).toBeLessThanOrEqual(19)
  })

  it('wraps keyboard movement, clamps wheel movement, and selects boundaries', () => {
    const initial = createSupervisorHelpState()
    expect(moveSupervisorHelpSelection(initial, -1, false)).toEqual({ selected: 2, hovered: null })
    expect(moveSupervisorHelpSelection(initial, 99, false, false)).toEqual({ selected: 2, hovered: null })
    expect(selectSupervisorHelpBoundary(false, true)).toEqual({ selected: 2, hovered: null })
  })

  it('keeps recovery help within safe update and detach controls', () => {
    const rendered = renderSupervisorHelp({ selected: 0, hovered: null }, true, 80)
    const output = rendered.lines.join('\n')

    expect(output).toContain('Safe controls · 1/2 · Recovery')
    expect(output).toContain('[ u ] Choose a channel, then check and install')
    expect(output).toContain('◇ Exit  Leave unchanged')
    expect(output).not.toContain('Start quietly')
    expect(output).not.toContain('◆ [ ? ] Close Help')

    const exit = renderSupervisorHelp({ selected: 1, hovered: null }, true, 80)
      .lines.join('\n')
    expect(exit).toContain('[ q / Esc ] Detach only')
    expect(renderSupervisorHelp({ selected: 0, hovered: null }, true, 120, 22)
      .lines.join('\n')).not.toContain('Control Atlas Board')
  })
})
