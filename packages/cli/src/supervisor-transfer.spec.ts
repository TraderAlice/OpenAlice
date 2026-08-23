import { describe, expect, it } from 'vitest'

import {
  createSupervisorTransferWizard,
  renderTransferPlanReview,
  selectTransferDestination,
} from './supervisor-transfer.ts'
import type { MachineInventory, MachineProjectInventory } from './machine-inventory.ts'

describe('Supervisor transfer wizard model', () => {
  it('offers only online compatible SSH Machines and derives a remote Home', () => {
    const state = createSupervisorTransferWizard(project('research'), [
      machine('local', 'local'),
      machine('cloud', 'online'),
      machine('old', 'online', false),
      machine('offline', 'offline'),
    ])
    expect(state.destinations.map((entry) => entry.key)).toEqual(['cloud'])
    expect(state.projectKey).toBe('research')
    expect(state.destinationHome).toBe('/home/alice/.openalice-research')
  })

  it('re-derives the destination key and Home when another Machine is selected', () => {
    const cloud = machine('cloud', 'online')
    const lab = machine('lab', 'online')
    lab.projects = [
      { ...project('default'), home: '/srv/openalice/.openalice', isDefault: true },
      { ...project('research'), home: '/srv/openalice/.openalice-research', isDefault: false },
    ]
    const state = createSupervisorTransferWizard(project('research'), [cloud, lab])

    selectTransferDestination(state, 'lab')

    expect(state.destinationIndex).toBe(1)
    expect(state.projectKey).toBe('research-copy')
    expect(state.destinationHome).toBe('/srv/openalice/.openalice-research-copy')
  })

  it('never suggests the reserved implicit default key', () => {
    const state = createSupervisorTransferWizard(project('default'), [machine('cloud', 'online')])

    expect(state.projectKey).toBe('default-copy')
    expect(state.destinationHome).toBe('/home/alice/.openalice-default-copy')
  })

  it('renders the no-Session and source-unchanged contract in narrow review', () => {
    const plan = {
      source: { displayName: 'Research', key: 'research' },
      destination: { machineKey: 'cloud', displayName: 'Research', home: '/home/alice/.openalice-research', requiredFreeBytes: 1024 },
      portable: { files: 3, bytes: 512 },
      excluded: [{ reason: 'session-plane', files: 4 }],
      policy: { credentials: 'omit', scheduledIssues: 'keep-blocked' },
      credentials: { ai: { count: 0 }, broker: { count: 0 }, connector: { count: 0 }, providerKeys: { count: 0 } },
      scheduledIssues: [],
      blockers: [],
      readyToApply: true,
    } as never
    const output = renderTransferPlanReview(plan, 40).join('\n')
    expect(output).toContain('Sessions  0 imported')
    expect(output).toContain('Source stays unchanged')
    expect(output.split('\n').every((line) => line.length <= 40)).toBe(true)
  })
})

function project(key: string): MachineProjectInventory {
  return { key, id: `id-${key}`, displayName: key, home: `/tmp/${key}`, port: 47331, portAutomatic: true, product: 'trader', isDefault: true, available: true, runtime: { class: 'absent', state: 'absent', ownerSurface: null, uptimeSeconds: null, webEndpoint: null, components: {} } }
}

function machine(key: string, connection: MachineInventory['connection'], transfer = true): MachineInventory {
  return { key, displayName: key, registered: key !== 'local', connection, sshTarget: key === 'local' ? null : 'alice@example.test', platform: 'linux', arch: 'x64', hostname: key, cliVersion: 'test', defaultProject: 'default', projects: key === 'cloud' ? [{ ...project('default'), home: '/home/alice/.openalice' }] : [], capabilities: { inspect: true, lifecycle: true, openTunnel: true, transferReceive: transfer, credentialReseal: transfer }, issue: null }
}
