import { describe, expect, it, vi } from 'vitest'

import { runMachineCommand } from './machine-command.ts'
import type { MachineInspectEnvelope } from './machine-inventory.ts'
import type { MachineRegistrySummary } from './machine-registry.ts'

describe('openalice machine', () => {
  it('rejects invalid or duplicate profiles and unsupported sessions before remote setup', async () => {
    const setupRemote = vi.fn()
    const addMachineProfile = vi.fn()
    for (const extra of [
      ['--label', 'Cloud box'],
      ['--label', 'local'],
      ['--label', 'Cloud', '--remote-session', 'default'],
    ]) {
      await expect(runMachineCommand(['add', 'host', ...extra, '--yes'], {
        setupRemote, addMachineProfile, loadMachines: async () => summary(),
      })).rejects.toThrow()
    }
    expect(setupRemote).not.toHaveBeenCalled()
    expect(addMachineProfile).not.toHaveBeenCalled()
  })
  it('lists saved Herdr-style Machine profiles as JSON', async () => {
    let output = ''
    await runMachineCommand(['list', '--json'], {
      stdout: { write: (chunk) => { output += chunk } },
      loadMachines: async () => summary(),
    })
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      machines: [
        {
          id: 'cloud',
          label: 'Cloud box',
          target: 'alice@example.com',
          enabled: true,
          sshPort: 22,
        },
      ],
    })
  })

  it('sets up and saves a Machine only after explicit non-interactive confirmation', async () => {
    const setupRemote = vi.fn(async () => undefined)
    const addMachineProfile = vi.fn(async (input) => ({
      key: 'cloud',
      id: '0123456789abcdef0123456789abcdef',
      displayName: input.label,
      sshTarget: input.sshTarget,
      isDefault: false,
      enabled: true,
    }))
    await expect(runMachineCommand([
      'add', 'alice@example.com', '--label', 'Cloud', '--yes',
    ], { setupRemote, addMachineProfile, loadMachines: async () => summary(), interactive: false })).resolves.toBe(0)
    expect(setupRemote).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Cloud',
      sshTarget: 'alice@example.com',
      assumeYes: true,
    }), expect.any(Object))
    expect(addMachineProfile).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Cloud',
      sshTarget: 'alice@example.com',
    }), expect.any(Object))

    await expect(runMachineCommand([
      'add', 'alice@example.com', '--label', 'Cloud',
    ], { setupRemote, addMachineProfile, loadMachines: async () => summary(), interactive: false })).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('cancels an interactive mutation without writing', async () => {
    let output = ''
    const setupRemote = vi.fn()
    const addMachineProfile = vi.fn()
    await expect(runMachineCommand([
      'add', 'alice@example.com', '--label', 'Cloud',
    ], {
      stdout: { write: (chunk) => { output += chunk } },
      setupRemote,
      addMachineProfile,
      loadMachines: async () => summary(),
      interactive: true,
      prompt: async () => 'n',
    })).resolves.toBe(0)
    expect(setupRemote).not.toHaveBeenCalled()
    expect(addMachineProfile).not.toHaveBeenCalled()
    expect(output).toBe('Cancelled.\n')
  })

  it('inspects all Machines and keeps an unavailable remote as data', async () => {
    let output = ''
    const local = localEnvelope()
    await runMachineCommand(['inspect', '--json'], {
      stdout: { write: (chunk) => { output += chunk } },
      loadMachines: async () => summary(),
      inspectLocal: async () => local,
      inspectRemote: async (machine) => ({
        ...local.machine,
        key: machine.key,
        displayName: machine.displayName,
        connection: 'offline',
        sshTarget: machine.sshTarget,
        projects: [],
        issue: { code: 'ESSHUNAVAILABLE', message: 'offline' },
      }),
    })
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      machines: [
        { key: 'local', connection: 'local' },
        { key: 'cloud', connection: 'offline', issue: { code: 'ESSHUNAVAILABLE' } },
      ],
    })
  })

  it('emits the single-Machine envelope consumed over SSH', async () => {
    let output = ''
    await runMachineCommand(['inspect', 'local', '--json'], {
      stdout: { write: (chunk) => { output += chunk } },
      loadMachines: async () => summary(),
      inspectLocal: async () => localEnvelope(),
    })
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      machine: { key: 'local', projects: [] },
    })
  })
})

function summary(): MachineRegistrySummary {
  return {
    defaultMachine: 'local',
    machines: [{
      key: 'cloud',
      displayName: 'Cloud box',
      sshTarget: 'alice@example.com',
      sshPort: 22,
      isDefault: false,
    }],
  }
}

function localEnvelope(): MachineInspectEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-23T00:00:00.000Z',
    machine: {
      key: 'local',
      displayName: 'This computer',
      registered: true,
      connection: 'local',
      sshTarget: null,
      platform: 'darwin',
      arch: 'arm64',
      hostname: 'local',
      cliVersion: '1.2.3',
      defaultProject: 'default',
      projects: [],
      capabilities: {
        inspect: true,
        lifecycle: true,
        openTunnel: true,
        transferReceive: false,
        credentialReseal: false,
      },
      issue: null,
    },
  }
}
