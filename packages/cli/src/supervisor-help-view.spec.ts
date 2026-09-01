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
    expect(output).toContain('Runtime · Operate locally')
    expect(output).toContain('[ r ] Restart with confirmation')
    expect(output).toContain('[ x ] Stop with confirmation')
    expect(rendered.targets).toEqual([
      { index: 0, row: 2, startColumn: 2, endColumn: 31 },
      { index: 1, row: 3, startColumn: 2, endColumn: 31 },
      { index: 2, row: 4, startColumn: 2, endColumn: 31 },
    ])
  })

  it('folds the same selected group into a narrow card', () => {
    const rendered = renderSupervisorHelp({ selected: 2, hovered: null }, false, 46)
    const output = rendered.lines.join('\n')

    expect(output).toContain('Control atlas · 3/3 · AliceProject')
    expect(output).toContain('› ◇ AliceProject')
    expect(output).toContain('[ i ] Choose or create an AliceProject')
    expect(output).toContain('[ / ] Open the Command Palette')
    expect(rendered.targets).toHaveLength(3)
    expect(rendered.lines.every((line) => displayWidth(line) <= 46)).toBe(true)
    expect(rendered.lines.length).toBeLessThanOrEqual(16)
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

    const exit = renderSupervisorHelp({ selected: 1, hovered: null }, true, 80)
      .lines.join('\n')
    expect(exit).toContain('[ q / Esc ] Detach only')
  })
})
