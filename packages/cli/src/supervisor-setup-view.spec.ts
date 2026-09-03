import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorSetupStudio,
  decorateSupervisorSetupWorkbench,
  renderSupervisorSetupStudio,
  renderSupervisorSetupWorkbench,
  supervisorSetupWorkbenchFieldWidth,
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
    expect(output).toContain('◇ MACHINE DEFAULTS LAYER · Machine defaults are inherited')
    expect(output).toContain('Inspection · 5/6')
    expect(output).toContain('◆ [ Esc ] Done')
    expect(rendered.lines.length).toBeLessThanOrEqual(18)
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

  it('keeps the active layer and field route beside the wide editor', () => {
    const lines = renderSupervisorSetupWorkbench({
      phase: 'edit',
      projectName: 'Default AliceProject',
      scope: 'AliceProject settings',
      fieldTitle: 'Set AliceProject browser port',
      fieldPosition: '3/6',
      runtimeClass: 'absent',
      fieldLines: ['> 49002'],
      detail: 'Leave blank to inherit.',
      message: 'AliceProject values override machine defaults.',
    }, 100)
    const output = lines.join('\n')
    expect(output).toContain('Layer Context · PROJECT · EDIT')
    expect(output).toContain('Field Inspector · 3/6 · ○ STOPPED')
    expect(output).toContain('◆ 01 Edit')
    expect(output).toContain('· 03 Save')
    expect(output).toContain('◆ [ Enter ] Validate & save  │  [ Esc ] Cancel')
    expect(output).toContain('Inheritance contract · ALICEPROJECT SETTINGS LAYER')
    expect(lines.every((line) => displayWidth(line) <= 100)).toBe(true)
    expect(supervisorSetupWorkbenchFieldWidth(100)).toBe(57)
  })

  it('stacks the rejected editor route without dropping context', () => {
    const lines = renderSupervisorSetupWorkbench({
      phase: 'error',
      projectName: 'Default AliceProject',
      scope: 'Machine defaults',
      fieldTitle: 'Set machine-default browser port',
      fieldPosition: '3/6',
      runtimeClass: 'absent',
      fieldLines: ['> 99999'],
      detail: 'Port must be between 1 and 65535.',
      message: 'Blank inherits from the next lower-priority layer.',
    }, 72)
    const output = lines.join('\n')
    expect(output).toContain('Setup Workbench · MACHINE · FIX')
    expect(output).toContain('! Edit  → Validate  · Save')
    expect(output).toContain('Field Inspector · 3/6 · ○ STOPPED')
    expect(output).toContain('◆ INHERITANCE')
    expect(lines.every((line) => displayWidth(line) <= 72)).toBe(true)
    expect(supervisorSetupWorkbenchFieldWidth(72)).toBe(68)
  })

  it('decorates Workbench whole-action hover with and without color', () => {
    const line = '│ ◆ [ Enter ] Validate & save  │  [ Esc ] Cancel │'
    const color = decorateSupervisorSetupWorkbench(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorSetupWorkbench(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Validate & save')
    expect(plain).toContain('│ › [ Enter ] Validate & save')
  })
})
