import { describe, expect, it } from 'vitest'

import {
  createSupervisorCommandDeckState,
  decorateSupervisorCommandDeck,
  filterSupervisorCommandDeckItems,
  moveSupervisorCommandDeckSelection,
  renderSupervisorCommandDeck,
  SUPERVISOR_COMMAND_DOCK_OVERLAY_OPTIONS,
  supervisorCommandDockOverlayOptions,
  supervisorCommandDeckItems,
} from './supervisor-command-deck.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Command Dock', () => {
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
      'enter', 'l', 'd', 'tab', '?', 'i', 'c', 'p', 'u', 'r', 'x',
    ])
    expect(items[0]).toMatchObject({ label: 'Open Workspace', primary: true })
    expect(items.slice(0, 4).map((item) => item.label)).toEqual([
      'Open Workspace', 'Runtime logs', 'Runtime Doctor', 'Next view',
    ])
    expect(items.slice(-2).map((item) => item.group)).toEqual(['Manage', 'Manage'])

    const recovery = supervisorCommandDeckItems({ ...context, recovery: true })
    expect(recovery.map((item) => item.input)).toEqual(['u', '?'])
  })

  it('scopes the Command Dock to an active SSH target', () => {
    const items = supervisorCommandDeckItems({ ...context, targetKind: 'ssh' })

    expect(items.map((item) => item.input)).toEqual(['enter', 'c', 'tab', '?', 'x'])
    expect(items.map((item) => item.label)).toEqual([
      'Open active Web UI',
      'Connections',
      'Next view',
      'Help',
      'Disconnect remote target',
    ])
    expect(items.map((item) => item.label)).not.toContain('Runtime Source')
    expect(items.map((item) => item.label)).not.toContain('Stop Runtime')
  })

  it('replaces unsafe open and lifecycle commands with health recovery', () => {
    const remote = supervisorCommandDeckItems({
      ...context,
      targetKind: 'ssh',
      targetHealth: 'unreachable',
    })
    expect(remote.map((item) => item.input)).toEqual(['r', 'c', 'tab', '?', 'x'])
    expect(remote[0]).toMatchObject({ label: 'Retry connection', primary: true })
    expect(remote.map((item) => item.label)).not.toContain('Open active Web UI')

    const local = supervisorCommandDeckItems({
      ...context,
      targetKind: 'local',
      targetHealth: 'degraded',
    })
    expect(local.map((item) => item.input)).toEqual(['r', 'c', '?'])
    expect(local[0]).toMatchObject({ label: 'Retry local connection', primary: true })
    expect(local.map((item) => item.label)).not.toContain('Restart Runtime')
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

  it('ranks visible command text and keeps non-matches out of the result model', () => {
    const items = supervisorCommandDeckItems(context)
    expect(filterSupervisorCommandDeckItems(items, 'set').map((item) => item.label)).toEqual([
      'Setup',
    ])
    expect(filterSupervisorCommandDeckItems(items, 'runtime log').map((item) => item.label)).toEqual([
      'Runtime logs',
    ])
    expect(filterSupervisorCommandDeckItems(items, 'rtr doc').map((item) => item.label)).toEqual([
      'Runtime Doctor',
    ])
    expect(filterSupervisorCommandDeckItems(items, '日志').map((item) => item.label)).toEqual([
      'Runtime logs',
    ])
    expect(filterSupervisorCommandDeckItems(items, '设置').map((item) => item.label)).toEqual([
      'Setup',
    ])
    expect(filterSupervisorCommandDeckItems(items, '源码').map((item) => item.label)).toEqual([
      'Runtime Source',
    ])
    expect(filterSupervisorCommandDeckItems(items, 'no such command')).toEqual([])
  })

  it('renders selected and hovered full-row targets responsively', () => {
    const items = supervisorCommandDeckItems(context)
    const wide = renderSupervisorCommandDeck(items, { selected: 1, hovered: 2 }, 'running', 100)
    expect(wide.lines.join('\n')).toContain('Command Dock · 2/11 · RUNNING')
    expect(wide.lines.join('\n')).toContain('›   Runtime logs')
    expect(wide.lines.join('\n')).toContain('»   Runtime Doctor')
    expect(wide.lines.join('\n')).toContain('Run read-only ownership and readiness checks')
    expect(wide.lines.join('\n')).toContain('⌕  ▌ Type to filter commands')
    expect(wide.targets[1]).toEqual({ row: 4, startColumn: 2, endColumn: 99, index: 1 })
    expect(wide.lines).toHaveLength(9)
    expect(wide.lines.join('\n')).not.toContain('AliceProjects')

    const scrolled = renderSupervisorCommandDeck(items, { selected: 9, hovered: null }, 'running', 100)
    expect(scrolled.lines.join('\n')).toContain('Command Dock · 10/11 · RUNNING')
    expect(scrolled.lines.join('\n')).toContain('›   Restart Runtime')
    expect(scrolled.lines.join('\n')).toContain('MANAGE · R')
    expect(scrolled.lines.join('\n')).not.toContain('Open Workspace')
    expect(scrolled.targets.map((target) => target.index)).toEqual([7, 8, 9, 10])

    const narrow = renderSupervisorCommandDeck(items, createSupervisorCommandDeckState(), 'running', 52)
    expect(narrow.lines.every((line) => displayWidthWithoutAnsi(line) <= 52)).toBe(true)
    expect(narrow.lines.join('\n')).not.toContain('Confirm before reconnecting')
    expect(narrow.lines.join('\n')).toContain('[ ↑↓ ] Navigate')
    expect(narrow.lines.join('\n')).toContain('[ Esc ] Close')
    expect(narrow.lines.join('\n')).not.toContain('Type to filter   [')
  })

  it('renders the live query and a corrective empty state without fake targets', () => {
    const items = filterSupervisorCommandDeckItems(supervisorCommandDeckItems(context), 'setup')
    const match = renderSupervisorCommandDeck(
      items,
      createSupervisorCommandDeckState(),
      'running',
      76,
      'setup',
    )
    expect(match.lines.join('\n')).toContain('Command Dock · 1/1 · MATCH “setup” · RUNNING')
    expect(match.lines.join('\n')).toContain('⌕  setup▌')
    expect(match.targets).toEqual([{ row: 3, startColumn: 2, endColumn: 75, index: 0 }])

    const cursorOff = renderSupervisorCommandDeck(
      items,
      createSupervisorCommandDeckState(),
      'running',
      76,
      'setup',
      false,
    )
    expect(cursorOff.lines.join('\n')).toContain('⌕  setup ')
    expect(cursorOff.lines.join('\n')).not.toContain('setup▌')

    const empty = renderSupervisorCommandDeck([], createSupervisorCommandDeckState(), 'running', 76, 'xyz')
    expect(empty.lines.join('\n')).toContain('Command Dock · 0/0 · MATCH “xyz” · RUNNING')
    expect(empty.lines.join('\n')).toContain('No commands match “xyz”')
    expect(empty.targets).toEqual([])
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
    expect(colored.join('\n')).toContain('\u001b[1;38;2;116;235;226m[ ↑↓ ]')
    expect(colored.join('\n')).toContain('› ◆ Open Workspace')
    expect(SUPERVISOR_COMMAND_DOCK_OVERLAY_OPTIONS).toMatchObject({
      width: '100%',
      anchor: 'bottom-center',
      maxHeight: 9,
      margin: { bottom: 2 },
    })
    expect(supervisorCommandDockOverlayOptions({ width: 46, height: 16 })).toEqual({
      width: '100%',
      anchor: 'top-left',
      maxHeight: 9,
      margin: { top: 4, right: 0, bottom: 1, left: 0 },
    })
    expect(supervisorCommandDockOverlayOptions({ width: 60, height: 20 }))
      .toBe(SUPERVISOR_COMMAND_DOCK_OVERLAY_OPTIONS)
  })
})

function displayWidthWithoutAnsi(value: string): number {
  return [...value].length
}
