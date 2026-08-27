import { describe, expect, it } from 'vitest'

import type { MachineInventory } from './machine-inventory.ts'
import {
  createSupervisorFleetState,
  displayWidth,
  moveFleetSelection,
  renderSupervisorFleet,
  replaceFleetInventory,
  selectedFleetProject,
  setFleetFocus,
} from './supervisor-fleet.ts'

describe('Supervisor fleet state and presentation', () => {
  it('preserves selection by Machine key across inventory refresh', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    state = moveFleetSelection(state, 1)
    state = setFleetFocus(state, 'projects')
    state = moveFleetSelection(state, 1)
    expect(selectedFleetProject(state)?.key).toBe('nano')

    state = replaceFleetInventory(state, '2026-08-23T00:01:00Z', [
      machines()[1]!,
      machines()[0]!,
    ])
    expect(selectedFleetProject(state)?.key).toBe('nano')
  })

  it('renders a wide two-pane hierarchy within terminal width', () => {
    const lines = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', machines()),
      80,
    )
    expect(lines.join('\n')).toContain('Machines')
    expect(lines.join('\n')).toContain('AliceProjects · This Mac')
    expect(lines.join('\n')).toContain('Default AliceProject')
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true)
  })

  it('uses a narrow drill-down and handles wide Unicode labels', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    expect(renderSupervisorFleet(state, 40).join('\n')).toContain('Enter / →  AliceProjects')
    state = setFleetFocus(state, 'projects')
    const lines = renderSupervisorFleet(state, 40)
    expect(lines.join('\n')).toContain('← / Esc  Machines')
    expect(lines.every((line) => displayWidth(line) <= 40)).toBe(true)
  })

  it('keeps unauthorized and incompatible Machines as truthful rows', () => {
    const unavailable = ['unauthorized', 'incompatible'].map((connection) => ({
      ...machines()[1]!,
      key: connection,
      displayName: connection,
      connection: connection as MachineInventory['connection'],
      projects: [],
      issue: {
        code: connection === 'unauthorized' ? 'ESSHAUTH' : 'EINCOMPATIBLE',
        message: connection === 'unauthorized'
          ? 'SSH authentication was rejected.'
          : 'Remote CLI is incompatible.',
      },
    }))
    const output = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', [machines()[0]!, ...unavailable]),
      90,
    ).join('\n')
    expect(output).toContain('unauthorized')
    expect(output).toContain('incompatible')
  })
})

function machines(): MachineInventory[] {
  return [
    machine('local', 'This Mac', 'local', [project('default', 'Default AliceProject')]),
    machine('cloud', '云端开发机', 'online', [
      project('research', 'Research'),
      project('nano', 'Nano Lab'),
    ]),
  ]
}

function machine(
  key: string,
  displayName: string,
  connection: MachineInventory['connection'],
  projects: MachineInventory['projects'],
): MachineInventory {
  return {
    key,
    displayName,
    registered: true,
    connection,
    sshTarget: key === 'local' ? null : `${key}.example.com`,
    platform: 'linux',
    arch: 'arm64',
    hostname: key,
    cliVersion: '1.0.0',
    defaultProject: projects[0]?.key ?? null,
    projects,
    capabilities: {
      inspect: true,
      lifecycle: true,
      openTunnel: true,
      transferReceive: false,
      credentialReseal: false,
    },
    issue: null,
  }
}

function project(key: string, displayName: string): MachineInventory['projects'][number] {
  return {
    key,
    id: `alice-project-${key}`,
    displayName,
    home: `/home/alice/${key}`,
    port: 47_331,
    portAutomatic: true,
    product: key === 'nano' ? 'nano' : 'trader',
    isDefault: key === 'default' || key === 'research',
    available: true,
    runtime: {
      class: key === 'nano' ? 'absent' : 'running',
      state: key === 'nano' ? 'absent' : 'running',
      ownerSurface: key === 'nano' ? null : 'cli-server',
      uptimeSeconds: 12,
      webEndpoint: key === 'nano' ? null : 'http://127.0.0.1:47331',
      components: { alice: key === 'nano' ? 'disabled' : 'ready' },
    },
  }
}
