import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-fleet.ts'
import {
  renderSupervisorNavigation,
  supervisorNavigationPanelAt,
} from './supervisor-navigation.ts'

describe('Supervisor navigation rail', () => {
  it('renders a full-width operational rail with semantic badges', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      machineCount: 2,
      logCount: 42,
      doctor: { failures: 1, warnings: 2 },
    }, 80)

    expect(displayWidth(layout.line)).toBe(80)
    expect(layout.line).toContain('◆ [Overview]')
    expect(layout.line).toContain('◇ Machines·2')
    expect(layout.line).toContain('≋ Logs·42')
    expect(layout.line).toContain('✦ Doctor×1')
    expect(layout.line).toContain('? Help')
  })

  it('keeps every view reachable at narrow widths', () => {
    const layout = renderSupervisorNavigation({
      selected: 'doctor',
      machineCount: 2,
      logCount: 9,
      doctor: { failures: 0, warnings: 3 },
    }, 46)

    expect(displayWidth(layout.line)).toBe(46)
    expect(layout.line).toContain('Home')
    expect(layout.line).toContain('Fleet·2')
    expect(layout.line).toContain('Logs·9')
    expect(layout.line).toContain('[Doc]!3')
    expect(layout.line).toContain('Help')
    expect(layout.targets).toHaveLength(5)
  })

  it('replaces false page affordances with a task-owned Focus Header', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      focusTask: 'setup',
    }, 100)

    expect(layout.line).toContain('◆ FOCUS · SETUP')
    expect(layout.line).toContain('SETUP STUDIO')
    expect(layout.line).toContain('[ Esc ] Back')
    expect(layout.line).not.toContain('Overview')
    expect(layout.line).not.toContain('Machines')
    expect(layout.targets).toEqual([])
    expect(displayWidth(layout.line)).toBe(100)

    const compact = renderSupervisorNavigation({
      selected: 'fleet',
      focusTask: 'transfer',
    }, 46)
    expect(compact.line).toContain('◆ TRANSFER')
    expect(compact.line).toContain('[ Esc ] Back')
    expect(compact.line).not.toContain('Fleet')
    expect(compact.targets).toEqual([])
    expect(displayWidth(compact.line)).toBe(46)
  })

  it('derives badge-edge pointer hits from the rendered layout', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      doctor: { failures: 2, warnings: 0 },
    }, 80)
    const doctor = layout.targets.find((target) => target.panel === 'doctor')!

    expect(supervisorNavigationPanelAt(layout.targets, doctor.endColumn)).toBe('doctor')
    expect(supervisorNavigationPanelAt(layout.targets, doctor.endColumn + 1)).toBeUndefined()
  })

  it('reduces recovery mode to its valid destinations', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      recovery: true,
    }, 32)

    expect(layout.line).toContain('◆ [Overview]')
    expect(layout.line).toContain('? Help')
    expect(layout.targets.map((target) => target.panel)).toEqual(['overview', 'help'])
  })
})
