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

  it('uses a tall wide viewport for an all-system Control Atlas Board', () => {
    const rendered = renderSupervisorHelp({ selected: 1, hovered: 2 }, false, 120, 22)
    const output = rendered.lines.join('\n')

    expect(rendered.lines).toHaveLength(22)
    expect(output).toContain('Control Atlas Board · 3 SYSTEMS · POINTER + KEYBOARD')
    expect(output).toContain('· ◆ NAVIGATION  //  MOVE WITH INTENT')
    expect(output).toContain('› ● RUNTIME  //  READ STATE, THEN ACT')
    expect(output).toContain('» ◇ ALICEPROJECT  //  SHAPE THE WORKSPACE')
    expect(output).toContain('[ Shift+Tab / ← ] Previous view')
    expect(output).toContain('[ x ] Stop local / disconnect remote target')
    expect(output).toContain('[ / ] Open the Command Dock')
    expect(output).toContain('◆ [ ? ] Close Help')
    expect(rendered.targets.filter((target) => target.index === 0)).toHaveLength(4)
    expect(rendered.targets.filter((target) => target.index === 1)).toHaveLength(6)
    expect(rendered.targets.filter((target) => target.index === 2)).toHaveLength(5)
    expect(rendered.targets.every((target) => (
      target.startColumn === 2 && target.endColumn === 119
    ))).toBe(true)
    expect(rendered.lines.every((line) => displayWidth(line) === 120)).toBe(true)

    const boundary = renderSupervisorHelp({ selected: 0, hovered: null }, false, 100, 22)
    expect(boundary.lines).toHaveLength(22)
    expect(boundary.lines.join('\n')).toContain('Control Atlas Board')
    expect(renderSupervisorHelp({ selected: 0, hovered: null }, false, 100, 21)
      .lines.join('\n')).not.toContain('Control Atlas Board')
  })

  it('folds the same selected group into a narrow card', () => {
    const rendered = renderSupervisorHelp({ selected: 2, hovered: null }, false, 46)
    const output = rendered.lines.join('\n')

    expect(output).toContain('Control atlas · 3/3 · AliceProject')
    expect(output).toContain('› ◇ AliceProject')
    expect(output).toContain('[ i ] Choose or create an AliceProject')
    expect(output).toContain('[ / ] Open the Command Dock')
    expect(output).toContain('◆ [ ? ] Close Help')
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
    expect(output).not.toContain('◆ [ ? ] Close Help')

    const exit = renderSupervisorHelp({ selected: 1, hovered: null }, true, 80)
      .lines.join('\n')
    expect(exit).toContain('[ q / Esc ] Detach only')
    expect(renderSupervisorHelp({ selected: 0, hovered: null }, true, 120, 22)
      .lines.join('\n')).not.toContain('Control Atlas Board')
  })
})
