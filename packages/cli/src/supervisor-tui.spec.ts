import { describe, expect, it } from 'vitest'

import { SupervisorScreen } from './supervisor-tui.ts'

describe('Supervisor TUI screen', () => {
  it('renders stable stopped-state application chrome', () => {
    const screen = new SupervisorScreen({
      version: '0.87.0-beta',
      channel: 'dev',
      runtime: {
        class: 'absent',
        home: '/tmp/openalice',
        owner: null,
        endpoints: {},
      },
    })

    const lines = screen.render(80)

    expect(lines).toContain('OpenAlice  0.87.0-beta  dev')
    expect(lines).toContain('Runtime state: absent')
    expect(lines).toContain('q / Esc / Ctrl+C  Detach')
  })

  it('uses a narrow projection and sanitizes diagnostics', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: null,
      diagnostic: 'bad\u001b[31mstate',
    })

    const lines = screen.render(40)

    expect(lines).toContain('Runtime: unavailable')
    expect(lines.join('\n')).not.toContain('\u001b')
    expect(lines.every((line) => line.length <= 40)).toBe(true)
  })
})
