import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  appendSupervisorConnectionEvent,
  createSupervisorConnectionEvent,
  renderSupervisorConnectionChronicle,
  renderSupervisorRuntimeSummary,
  type SupervisorConnectionChronicleTarget,
  type SupervisorConnectionEvent,
} from './supervisor-connection-chronicle.ts'

const clock = new Date(2026, 8, 2, 14, 5, 6).getTime()

describe('Supervisor connection chronicle', () => {
  it('renders the current route and latest transitions at the 80-column baseline', () => {
    const target = fixtureTarget({ phase: 'unreachable', consecutiveFailures: 3 })
    const events = [
      createSupervisorConnectionEvent('connected', target, clock, 'ssh-forward'),
      createSupervisorConnectionEvent('degraded', target, clock + 1_000, 'automatic-probe'),
      createSupervisorConnectionEvent('unreachable', target, clock + 2_000, 'automatic-probe'),
    ]

    const lines = renderSupervisorConnectionChronicle({ target, events }, 80)
    const text = lines.join('\n')

    expect(text).toContain('Runtime Observatory · ENDPOINT UNREACHABLE · REMOTE')
    expect(text).not.toMatch(/Runtime Observatory[^\n]*EVENTS/u)
    expect(text).toContain('× OPENALICE READY · ENDPOINT UNREACHABLE')
    expect(text).toContain('⌁ Cloud Lab → Research · SSH FORWARD')
    expect(text).toContain('Owner  cli-server · pid 4242 · Uptime  2h 3m')
    expect(text).toContain('Provider  source')
    expect(text).toContain('SERVICES  ● Alice  ready · ○ UTA  disabled · ○ Connector  disabled')
    expect(text).toContain('× 14:05:08 UNREACHABLE · automatic probe')
    expect(text).not.toContain('ACQUIRED')
    expect(text).toContain('◆ [ r ] Retry active connection')
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true)
  })

  it('uses a three-column Runtime, route, and services observatory on wide terminals', () => {
    const target = fixtureTarget({ phase: 'connected', consecutiveFailures: 0 })
    const events = [
      createSupervisorConnectionEvent('connected', target, clock, 'ssh-forward'),
      createSupervisorConnectionEvent('degraded', target, clock + 1_000, 'automatic-probe'),
      createSupervisorConnectionEvent('recovered', target, clock + 2_000, 'manual-retry'),
    ]

    const lines = renderSupervisorConnectionChronicle({ target, events }, 120, 14)
    const text = lines.join('\n')

    expect(lines).toHaveLength(14)
    expect(text).toContain('Runtime Observatory · CONNECTED · REMOTE')
    expect(text).not.toMatch(/Runtime Observatory[^\n]*EVENTS/u)
    expect(text).toContain('RUNTIME')
    expect(text).toContain('ROUTE')
    expect(text).toContain('SERVICES')
    expect(text).toContain('Owner  cli-server · pid 4242')
    expect(text).toContain('Provider  source')
    expect(text).toContain('● Alice  ready')
    expect(text).toContain('○ UTA  disabled')
    expect(text).toContain('✓ 14:05:08 RECOVERED')
    expect(text).toContain('RECOVERED · manual retry · Cloud Lab/Research')
    expect(text).toContain('◆ [ o ] Open verified Web UI')
    expect(lines.every((line) => displayWidth(line) <= 120)).toBe(true)
  })

  it('folds tiny Runtime status and controls into one five-row work surface', () => {
    const target = fixtureTarget({ phase: 'connected', consecutiveFailures: 0 })
    const lines = renderSupervisorRuntimeSummary({ target, events: [] }, 46, {
      meta: 'QUIET',
      action: { key: 'l', label: 'Reload Runtime snapshot' },
    })
    const text = lines.join('\n')

    expect(lines).toHaveLength(7)
    expect(text).toContain('Runtime · LIVE · REMOTE · QUIET')
    expect(text).toContain('● OPENALICE READY · source · 2h 3m')
    expect(text).toContain('⌁ Cloud Lab → Research')
    expect(text).toContain('● Alice ready · ○ UTA off · ○ Conn off')
    expect(text).toContain('◆ [ o ] Open verified Web UI')
    expect(text).toContain('· [ l ] Reload Runtime snapshot')
    expect(lines.every((line) => displayWidth(line) <= 46)).toBe(true)
  })

  it('keeps a deduplicated bounded session trail', () => {
    const target = fixtureTarget({ phase: 'connected', consecutiveFailures: 0 })
    let events: SupervisorConnectionEvent[] = []
    for (let index = 0; index < 15; index += 1) {
      events = appendSupervisorConnectionEvent(
        events,
        createSupervisorConnectionEvent(
          index % 2 === 0 ? 'connected' : 'disconnected',
          target,
          clock + index,
          index % 2 === 0 ? 'ssh-forward' : 'tunnel-exit',
        ),
      )
    }
    const duplicate = appendSupervisorConnectionEvent(events, events.at(-1)!)

    expect(events).toHaveLength(12)
    expect(events[0]?.at).toBe(clock + 3)
    expect(duplicate).toBe(events)
  })

  it('removes terminal control characters from target identity', () => {
    const target = {
      ...fixtureTarget({ phase: 'connected', consecutiveFailures: 0 }),
      machineName: 'Cloud\u001b[31m Lab',
      projectName: 'Research\nDesk',
    }
    const event = createSupervisorConnectionEvent('connected', target, clock, 'ssh-forward')
    const text = renderSupervisorConnectionChronicle({ target, events: [event] }, 80).join('\n')

    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\nDesk')
    expect(text).toContain('Cloud [31m Lab → Research Desk')
  })
})

function fixtureTarget(
  health: NonNullable<SupervisorConnectionChronicleTarget['health']>,
): SupervisorConnectionChronicleTarget {
  return {
    kind: 'ssh',
    machineKey: 'cloud',
    machineName: 'Cloud Lab',
    projectKey: 'research',
    projectName: 'Research',
    transport: 'ssh-forward',
    endpoint: 'http://127.0.0.1:47331',
    health: { ...health, checkedAt: clock },
    runtime: {
      class: 'running',
      state: 'ready',
      owner: { surface: 'cli-server', pid: 4242 },
      provider: { kind: 'source' },
      components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
      uptimeSeconds: 7_380,
    },
  }
}
