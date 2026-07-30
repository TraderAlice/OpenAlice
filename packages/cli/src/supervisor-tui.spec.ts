import { describe, expect, it } from 'vitest'

import {
  type SupervisorAction,
  SupervisorScreen,
} from './supervisor-tui.ts'

const matchesKey = (data: string, key: string) => data === key

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
    expect(lines).toContain('s Start · c Source · d Doctor · l Logs · u Update · ? Help')
    expect(lines).toContain('q / Esc / Ctrl+C  Detach without stopping')
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

  it('dispatches available actions and confirms Runtime mutations', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        home: '/tmp/openalice',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
        components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
      },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(actions).toEqual(['open'])

    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(screen.snapshot.confirmation).toBe('restart')
    expect(screen.render(100).join('\n')).toContain('active Web/agent sessions reconnect or end')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['open', 'restart'])
  })

  it('keeps foreign-owned lifecycle mutations unavailable', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        owner: { surface: 'electron', pid: 7 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('x', matchesKey)).toBe(true)
    expect(actions).toEqual([])
    expect(screen.snapshot.confirmation).toBeUndefined()
    expect(screen.snapshot.notice).toContain('electron owns this Runtime')
  })

  it('changes source only while the selected Runtime is stopped', () => {
    let configureRequests = 0
    const running = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
      },
    }, {
      onConfigureSource: () => {
        configureRequests += 1
      },
    })

    expect(running.handleKey('c', matchesKey)).toBe(true)
    expect(configureRequests).toBe(0)
    expect(running.snapshot.notice).toContain('Stop the selected Runtime')

    running.update({ runtime: { class: 'absent' } })
    expect(running.handleKey('c', matchesKey)).toBe(true)
    expect(configureRequests).toBe(1)
  })

  it('navigates detail panels and requests their read-only data', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('logs')
    expect(actions).toEqual(['logs'])

    expect(screen.handleKey('?', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('help')
    expect(screen.render(100).join('\n')).toContain('Supervisor controls')
  })
})
