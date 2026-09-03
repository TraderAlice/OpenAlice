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
      connected: true,
      inboxUnread: 3,
      machineCount: 2,
      logCount: 42,
      doctor: { checks: 3, failures: 1, warnings: 2 },
    }, 80)

    expect(displayWidth(layout.line)).toBe(80)
    expect(layout.line).toContain('◆ [Home]')
    expect(layout.line).toContain('● Inbox·3')
    expect(layout.line).toContain('◇ Connections·2')
    expect(layout.line).toContain('≋ Runtime·42')
  })

  it('projects connection health without relying on color', () => {
    const degraded = renderSupervisorNavigation({
      selected: 'overview', connected: true, connectionHealth: 'degraded',
    }, 80)
    const unreachable = renderSupervisorNavigation({
      selected: 'overview', connected: true, connectionHealth: 'unreachable',
    }, 80)
    const checking = renderSupervisorNavigation({
      selected: 'overview', connected: true, connectionHealth: 'checking',
    }, 80)

    expect(degraded.line).toContain('[Home]·!')
    expect(unreachable.line).toContain('[Home]·×')
    expect(checking.line).toContain('[Home]·…')
  })

  it('keeps every view reachable at narrow widths', () => {
    const layout = renderSupervisorNavigation({
      selected: 'inbox',
      connected: true,
      machineCount: 2,
      logCount: 9,
      doctor: { checks: 3, failures: 0, warnings: 3 },
    }, 46)

    expect(displayWidth(layout.line)).toBe(46)
    expect(layout.line).toContain('Home')
    expect(layout.line).toContain('[Inbox]')
    expect(layout.line).toContain('Connect·2')
    expect(layout.line).toContain('Runtime·9')
    expect(layout.targets).toHaveLength(4)
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

    const confirmation = renderSupervisorNavigation({
      selected: 'overview',
      focusTask: 'confirmation',
      confirmation: {
        confirmLabel: 'Stop Runtime',
        cancelLabel: 'Keep running',
      },
    }, 96)
    expect(confirmation.line).toContain('◆ FOCUS · STOP RUNTIME')
    expect(confirmation.line).toContain('DECISION GATE')
    expect(confirmation.line).toContain('REVIEW IMPACT')
    expect(confirmation.line).toContain('[ Esc ] Keep running')
    expect(confirmation.targets).toEqual([])

    const compactConfirmation = renderSupervisorNavigation({
      selected: 'overview',
      focusTask: 'confirmation',
      confirmation: {
        confirmLabel: 'Prepare source',
        cancelLabel: 'Not now',
      },
    }, 46)
    expect(compactConfirmation.line).toContain('◆ PREPARE SOURCE')
    expect(compactConfirmation.line).toContain('[ Esc ] Not now')
    expect(displayWidth(compactConfirmation.line)).toBe(46)
  })

  it('replaces false page affordances with a launch-operation header', () => {
    const running = renderSupervisorNavigation({
      selected: 'fleet',
      connected: false,
      operation: { kind: 'local-start', status: 'running' },
    }, 80)

    expect(running.line).toContain('◆ OPERATION · LOCAL START')
    expect(running.line).toContain('INPUT OWNED UNTIL READY')
    expect(running.line).not.toContain('Connect')
    expect(running.line).not.toContain('Help')
    expect(running.targets).toEqual([])
    expect(displayWidth(running.line)).toBe(80)

    const failed = renderSupervisorNavigation({
      selected: 'fleet',
      connected: true,
      operation: { kind: 'remote-connect', status: 'failed' },
    }, 46)

    expect(failed.line).toContain('× REMOTE CONNECT')
    expect(failed.line).toContain('RETRY OR CHANGE TARGET')
    expect(failed.line).not.toContain('Connections')
    expect(failed.targets).toEqual([])
    expect(displayWidth(failed.line)).toBe(46)
  })

  it('derives badge-edge pointer hits from the rendered layout', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      connected: true,
      inboxUnread: 2,
    }, 80)
    const inbox = layout.targets.find((target) => target.panel === 'inbox')!

    expect(supervisorNavigationPanelAt(layout.targets, inbox.endColumn)).toBe('inbox')
    expect(supervisorNavigationPanelAt(layout.targets, inbox.endColumn + 1)).toBeUndefined()
  })

  it('reduces recovery mode to its valid destinations', () => {
    const layout = renderSupervisorNavigation({
      selected: 'overview',
      recovery: true,
    }, 32)

    expect(layout.line).toContain('◆ [Recovery]')
    expect(layout.line).toContain('? Help')
    expect(layout.targets.map((target) => target.panel)).toEqual(['overview', 'help'])
  })

  it('reduces a disconnected launch to Connect and contextual Help', () => {
    const layout = renderSupervisorNavigation({
      selected: 'fleet',
      connected: false,
      machineCount: 3,
    }, 60)

    expect(layout.line).toContain('◆ [Connect]·3')
    expect(layout.line).toContain('? Help')
    expect(layout.line).not.toContain('Inbox')
    expect(layout.targets.map((target) => target.panel)).toEqual(['fleet', 'help'])
  })
})
