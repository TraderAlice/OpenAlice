import { describe, expect, it } from 'vitest'

import {
  createSupervisorCommandDeckState,
  decorateSupervisorCommandDeck,
  moveSupervisorCommandDeckSelection,
  renderSupervisorCommandDeck,
  SUPERVISOR_COMMAND_PALETTE_OVERLAY_OPTIONS,
  supervisorCommandDeckItems,
} from './supervisor-command-deck.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Command Palette', () => {
  const context = {
    recovery: false,
    runtimeState: 'running',
    primaryLabel: 'Open Workspace',
    primaryAvailable: true,
    startAvailable: false,
    restartAvailable: true,
    stopAvailable: true,
  }

  it('builds contextual commands without inventing another action contract', () => {
    const items = supervisorCommandDeckItems(context)
    expect(items.map((item) => item.input)).toEqual([
      'enter', 'r', 'x', 'l', 'd', 'i', 'p', 'u', 'tab', '?',
    ])
    expect(items[0]).toMatchObject({ label: 'Open Workspace', primary: true })

    const recovery = supervisorCommandDeckItems({ ...context, recovery: true })
    expect(recovery.map((item) => item.input)).toEqual(['u', '?'])
  })

  it('wraps keyboard selection and clamps pointer-wheel selection', () => {
    const initial = createSupervisorCommandDeckState()
    expect(moveSupervisorCommandDeckSelection(initial, -1, 4).selected).toBe(3)
    expect(moveSupervisorCommandDeckSelection(initial, -1, 4, false).selected).toBe(0)
    expect(moveSupervisorCommandDeckSelection({ selected: 3, hovered: 2 }, 1, 4)).toEqual({
      selected: 0,
      hovered: null,
    })
  })

  it('renders selected and hovered full-row targets responsively', () => {
    const items = supervisorCommandDeckItems(context)
    const wide = renderSupervisorCommandDeck(items, { selected: 1, hovered: 2 }, 'running', 100)
    expect(wide.lines.join('\n')).toContain('Command Palette · 2/10 · RUNNING')
    expect(wide.lines.join('\n')).toContain('›   Restart Runtime')
    expect(wide.lines.join('\n')).toContain('»   Stop Runtime')
    expect(wide.lines.join('\n')).toContain('Confirm before reconnecting active sessions')
    expect(wide.targets[1]).toEqual({ row: 3, startColumn: 2, endColumn: 99, index: 1 })

    const narrow = renderSupervisorCommandDeck(items, createSupervisorCommandDeckState(), 'running', 52)
    expect(narrow.lines.every((line) => displayWidthWithoutAnsi(line) <= 52)).toBe(true)
    expect(narrow.lines.join('\n')).not.toContain('Confirm before reconnecting')
    expect(narrow.lines.join('\n')).toContain('[ ↑ / ↓ ] Select')
  })

  it('owns focused overlay chrome without hiding no-color meaning', () => {
    const deck = renderSupervisorCommandDeck(
      supervisorCommandDeckItems(context),
      createSupervisorCommandDeckState(),
      'running',
      76,
    )
    const plain = decorateSupervisorCommandDeck(
      deck.lines,
      createSupervisorTuiTheme({ NO_COLOR: '1' }),
    )
    const colored = decorateSupervisorCommandDeck(
      deck.lines,
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    )

    expect(plain).toEqual(deck.lines)
    expect(colored.join('\n')).toContain('\u001b[')
    expect(colored.join('\n')).toContain('› ◆ Open Workspace')
    expect(SUPERVISOR_COMMAND_PALETTE_OVERLAY_OPTIONS).toMatchObject({
      width: 76,
      anchor: 'center',
      maxHeight: '90%',
    })
  })
})

function displayWidthWithoutAnsi(value: string): number {
  return [...value].length
}
