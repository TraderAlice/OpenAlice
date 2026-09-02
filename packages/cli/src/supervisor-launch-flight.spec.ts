import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  createSupervisorTuiTheme,
  decorateSupervisorFrame,
} from './supervisor-tui-theme.ts'
import {
  advanceSupervisorLaunchFlight,
  createSupervisorLaunchFlight,
  failSupervisorLaunchFlight,
  renderSupervisorLaunchFlight,
} from './supervisor-launch-flight.ts'

const startedAt = new Date(2026, 8, 2, 15, 0, 0).getTime()
const target = {
  machineKey: 'cloud',
  machineName: 'Cloud Lab',
  projectKey: 'research',
  projectName: 'Research',
  transport: 'ssh-forward' as const,
}

describe('Supervisor launch flight recorder', () => {
  it('advances only through truthful remote-start stages', () => {
    const initial = createSupervisorLaunchFlight('remote-start', target, startedAt)
    const starting = advanceSupervisorLaunchFlight(initial, 'start-runtime')
    const refreshing = advanceSupervisorLaunchFlight(starting, 'refresh-inventory')

    expect(initial.stages.map((stage) => stage.state)).toEqual([
      'active', 'waiting', 'waiting', 'waiting', 'waiting',
    ])
    expect(starting.stages.map((stage) => stage.state)).toEqual([
      'complete', 'active', 'waiting', 'waiting', 'waiting',
    ])
    expect(refreshing.stages.map((stage) => stage.state)).toEqual([
      'complete', 'complete', 'active', 'waiting', 'waiting',
    ])
  })

  it('renders a wide stage rail and fixed-height flight field', () => {
    const flight = advanceSupervisorLaunchFlight(
      createSupervisorLaunchFlight('remote-start', target, startedAt),
      'open-forward',
    )
    const lines = renderSupervisorLaunchFlight(flight, 120, startedAt + 7_000, 22)
    const text = lines.join('\n')

    expect(lines).toHaveLength(22)
    expect(text).toContain('Launch Flight Recorder · REMOTE START · IN FLIGHT · T+00:07')
    expect(text).toContain('◆ IN FLIGHT · Cloud Lab → Research')
    expect(text).toContain('✓ 01 TARGET')
    expect(text).toContain('◆ 04 FORWARD')
    expect(text).toContain('◆ NOW  Open SSH forward')
    expect(text).toContain('◇ CONTROL  Keep this terminal open')
    expect(lines.every((line) => displayWidth(line) <= 120)).toBe(true)

    const frame = ['header', 'tabs', 'rail', '', ...lines]
    const decorated = decorateSupervisorFrame(
      frame,
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      { panel: 'fleet' },
    )
    expect(decorated.join('\n')).toContain('\u001b[')
    expect(decorated.join('\n')).toContain('✓ 01 TARGET')
    expect(decorated.join('\n')).toContain('◆ 04 FORWARD')
    expect(decorated.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))).toEqual(frame)
    expect(decorateSupervisorFrame(
      frame,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      { panel: 'fleet' },
    )).toEqual(frame)
  })

  it('keeps every local stage and retry action legible at 80 columns', () => {
    const local = {
      machineKey: 'local',
      machineName: 'This computer',
      projectKey: 'default',
      projectName: 'Default AliceProject',
      transport: 'loopback' as const,
    }
    const flight = failSupervisorLaunchFlight(
      advanceSupervisorLaunchFlight(
        createSupervisorLaunchFlight('local-start', local, startedAt),
        'start-runtime',
      ),
      'Runtime readiness timed out\nretry safely',
    )
    const lines = renderSupervisorLaunchFlight(flight, 80, startedAt + 61_000)
    const text = lines.join('\n')

    expect(text).toContain('LOCAL START · RECOVERABLE FAILURE · T+01:01')
    expect(text).toContain('× RECOVERABLE FAILURE · This computer → Default AliceProject')
    expect(text).toContain('✓ 01  Validate local target · DONE')
    expect(text).toContain('× 02  Prepare and start Runtime · FAILED')
    expect(text).toContain('◇ 03  Bind local target · WAITING')
    expect(text).toContain('◆ [ Enter ] Retry selected target')
    expect(text).not.toContain('\nretry safely')
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true)
  })
})
