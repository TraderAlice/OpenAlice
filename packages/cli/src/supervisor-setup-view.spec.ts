import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorSetupStudio,
  renderSupervisorSetupStudio,
  type SupervisorSetupItem,
} from './supervisor-setup-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Setup Studio', () => {
  const items: SupervisorSetupItem[] = [
    { id: 'scope', label: 'Editing', value: 'AliceProject settings', description: 'Choose the configuration layer.', kind: 'choice' },
    { id: 'home', label: 'Data home', value: '/Users/alice/.openalice', description: 'Complete home for settings, credentials, workspaces, and runtime state.', kind: 'editor' },
    { id: 'port', label: 'Browser port', value: 'automatic · resolved 47331', description: 'Blank chooses an available port automatically.', kind: 'editor' },
    { id: 'updates', label: 'Update checks', value: 'inherit · enabled', description: 'Controls cached update discovery.', kind: 'choice' },
    { id: 'runtime', label: 'Installed Runtime', value: 'OpenAlice 0.91.0', description: 'Managed by the installer.', kind: 'readonly' },
    { id: 'config', label: 'Advanced config', value: '/Users/alice/.openalice/supervisor/config.json', description: 'Read-only configuration location.', kind: 'readonly' },
  ]

  it('renders a wide map and Inspector with full-row targets', () => {
    const rendered = renderSupervisorSetupStudio({
      projectName: 'Default AliceProject',
      scope: 'AliceProject settings',
      runtimeClass: 'running',
      message: 'Changes apply to this AliceProject.',
      items,
      selected: 1,
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Setup Studio · Default AliceProject')
    expect(output).toContain('Setup status · ALICEPROJECT SETTINGS LAYER')
    expect(output).toContain('Inspection · 2/6 · ● LIVE')
    expect(output).toContain('› Data home')
    expect(output).toContain('◆ [ Enter ] Edit value  │  [ Esc ] Done')
    expect(rendered.targets[1]).toEqual({ row: 3, startColumn: 2, endColumn: 47, index: 1 })
    expect(rendered.lines.every((line) => displayWidth(line) <= 100)).toBe(true)
  })

  it('stacks the same model within the 80-column overlay width', () => {
    const rendered = renderSupervisorSetupStudio({
      projectName: 'Default AliceProject',
      scope: 'Machine defaults',
      runtimeClass: 'absent',
      message: 'Machine defaults are inherited by AliceProjects without their own value.',
      items,
      selected: 4,
    }, 72)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Setup Studio · Default AliceProject')
    expect(output).toContain('Setup status · MACHINE DEFAULTS LAYER')
    expect(output).toContain('Inspection · 5/6')
    expect(output).toContain('◆ [ Esc ] Done')
    expect(rendered.lines).toHaveLength(21)
    expect(rendered.lines.every((line) => displayWidth(line) <= 72)).toBe(true)
  })

  it('keeps hover focus visible with and without terminal color', () => {
    const line = '│ ◆ [ Enter ] Cycle value  │  [ Esc ] Done │'
    const color = decorateSupervisorSetupStudio(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorSetupStudio(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Cycle value')
    expect(plain).toContain('│ › [ Enter ] Cycle value')
  })
})
