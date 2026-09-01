import { describe, expect, it } from 'vitest'

import {
  renderSupervisorConfirmation,
  SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS,
} from './supervisor-confirmation.ts'
import { displayWidth } from './supervisor-fleet.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor confirmation modal', () => {
  it('renders an explicit, fixed-width modal action contract', () => {
    const lines = renderSupervisorConfirmation({
      action: 'restart',
      title: 'Confirm Restart',
      meta: 'CLI pid 42',
      prompt: 'Restart Runtime owned by CLI pid 42?',
      impact: ['Active Web and agent sessions reconnect or end.'],
      confirmLabel: 'Restart Runtime',
      cancelLabel: 'Keep running',
    }, 72, createSupervisorTuiTheme({ NO_COLOR: '1' }))

    expect(lines.join('\n')).toContain('!  RUNTIME MUTATION')
    expect(lines.join('\n')).toContain('IMPACT')
    expect(lines.join('\n')).toContain('◆ [ Enter ] Restart Runtime')
    expect(lines.join('\n')).toContain('[ Esc ] Keep running')
    expect(lines.every((line) => displayWidth(line) === 72)).toBe(true)
    expect(SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS).toMatchObject({
      width: 72,
      anchor: 'center',
      margin: 1,
    })
  })

  it('keeps hover styling semantic and color optional', () => {
    const view = {
      action: 'update' as const,
      title: 'Confirm Update',
      meta: '0.92.0',
      prompt: 'Install OpenAlice 0.92.0?',
      impact: ['The running Supervisor will not reload.'],
      confirmLabel: 'Install update',
      cancelLabel: 'Not now',
    }
    const plain = renderSupervisorConfirmation(
      view,
      60,
      createSupervisorTuiTheme({ NO_COLOR: '1' }),
      'Esc',
    )
    const colored = renderSupervisorConfirmation(
      view,
      60,
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Esc',
    )

    expect(plain.join('\n')).not.toContain('\u001b[')
    expect(colored.join('\n')).toContain('\u001b[')
    expect(colored.join('\n')).toContain('[ Esc ]')
  })

  it('keeps both actions visible at the narrow dogfood width', () => {
    const lines = renderSupervisorConfirmation({
      action: 'update',
      title: 'Confirm Update',
      meta: '0.92.0-beta.1',
      prompt: 'Switch stable → beta and install OpenAlice 0.92.0-beta.1?',
      impact: [
        'Current CLI: 0.91.0-beta.3.',
        'The release installer is downloaded, SHA-256 verified, then the installed command is atomically replaced.',
        'This Supervisor will not reload. After success, exit and run openalice again.',
      ],
      confirmLabel: 'Install update',
      cancelLabel: 'Not now',
    }, 46, createSupervisorTuiTheme({ NO_COLOR: '1' }))

    expect(lines.join('\n')).toContain('[ Enter ] Install update')
    expect(lines.join('\n')).toContain('[ Esc ] Not now')
    expect(lines.length).toBeLessThanOrEqual(21)
    expect(lines.every((line) => displayWidth(line) === 46)).toBe(true)
  })
})
