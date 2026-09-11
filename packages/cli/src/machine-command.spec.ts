import { describe, expect, it, vi } from 'vitest'

import { runMachineCommand } from './machine-command.ts'
import type { MachineInspectEnvelope } from './machine-inventory.ts'
import type { MachineRegistrySummary } from './machine-registry.ts'

describe('openalice machine', () => {
  it('lists the implicit local Machine and registered SSH Machines as JSON', async () => {
    let output = ''
    await runMachineCommand(['list', '--json'], {
      stdout: { write: (chunk) => { output += chunk } },
      loadMachines: async () => summary(),
    })
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      defaultMachine: 'local',
      machines: [
        {
          key: 'local',
          displayName: 'This computer',
          sshTarget: null,
          sshPort: null,
          isDefault: true,
        },
        {
          key: 'cloud',
          displayName: 'Cloud box',
          sshTarget: 'alice@example.com',
          sshPort: 22,
          isDefault: false,
        },
      ],
    })
  })

  it('registers a Machine only after explicit non-interactive confirmation', async () => {
    const addMachine = vi.fn(async (input) => ({ ...input, displayName: input.displayName ?? 'Cloud', isDefault: false }))
    await expect(runMachineCommand([
      'add', 'cloud', '--target', 'alice@example.com', '--yes',
    ], { addMachine, interactive: false })).resolves.toBe(0)
    expect(addMachine).toHaveBeenCalledWith(expect.objectContaining({
      key: 'cloud',
      sshTarget: 'alice@example.com',
      sshPort: undefined,
    }), expect.any(Object))

    await expect(runMachineCommand([
      'add', 'cloud', '--target', 'alice@example.com',
    ], { addMachine, interactive: false })).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('cancels an interactive mutation without writing', async () => {
    let output = ''
    const addMachine = vi.fn()
    await expect(runMachineCommand([
      'add', 'cloud', '--target', 'alice@example.com',
    ], {
      stdout: { write: (chunk) => { output += chunk } },
      addMachine,
      interactive: true,
      prompt: async () => 'n',
    })).resolves.toBe(0)
    expect(addMachine).not.toHaveBeenCalled()
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
