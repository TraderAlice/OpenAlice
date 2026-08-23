import { describe, expect, it, vi } from 'vitest'

import {
  inspectLocalMachine,
  inspectMachineFleet,
  inspectRegisteredMachine,
  parseMachineInspectEnvelope,
  type MachineInspectEnvelope,
} from './machine-inventory.ts'
import type { RegisteredMachine } from './machine-registry.ts'

const remoteMachine: RegisteredMachine = {
  key: 'cloud',
  displayName: 'Cloud box',
  sshTarget: 'alice@example.com',
  sshPort: 2222,
  identityFile: '/keys/cloud',
  isDefault: false,
}

describe('Machine inventory', () => {
  it('builds a secret-free aggregate local inventory', async () => {
    const result = await inspectLocalMachine({
      supervisorRoot: '/supervisor',
      machineKey: 'local',
      now: () => new Date('2026-08-23T00:00:00.000Z'),
      hostname: () => 'devbox',
      platform: 'linux',
      arch: 'arm64',
      cliVersion: '1.2.3',
      loadRegistry: async () => ({
        defaultProject: 'research',
        projects: [{
          id: 'project-id',
          key: 'research',
          displayName: 'Research',
          home: '/alice/research',
          port: 48_001,
          portAutomatic: false,
          isDefault: true,
        }],
      }),
      checkHome: async () => undefined,
      readProduct: async () => 'nano',
      inspectRuntime: async () => ({
        class: 'running',
        state: 'ready',
        owner: { surface: 'electron', pid: 123, token: 'private' },
        detail: 'not exported',
      }),
    })

    expect(result).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00.000Z',
      machine: expect.objectContaining({
        key: 'local',
        hostname: 'devbox',
        platform: 'linux',
        arch: 'arm64',
        cliVersion: '1.2.3',
        defaultProject: 'research',
        projects: [expect.objectContaining({
          key: 'research',
          product: 'nano',
          runtime: {
            class: 'running',
            state: 'ready',
            ownerSurface: 'electron',
            uptimeSeconds: null,
            webEndpoint: null,
            components: {},
          },
        })],
      }),
    })
    expect(JSON.stringify(result)).not.toContain('token')
    expect(JSON.stringify(result)).not.toContain('pid')
    expect(JSON.stringify(result)).not.toContain('not exported')
  })

  it('uses one SSH request and relabels the remote local inventory', async () => {
    const runRemote = vi.fn(async () => JSON.stringify(remoteEnvelope()))
    const result = await inspectRegisteredMachine(remoteMachine, { runRemote })

    expect(runRemote).toHaveBeenCalledTimes(1)
    expect(runRemote).toHaveBeenCalledWith(
      {
        destination: 'alice@example.com',
        sshPort: 2222,
        identityFile: '/keys/cloud',
        batchMode: true,
      },
      expect.stringContaining('machine inspect local --json'),
      expect.any(Object),
    )
    expect(result).toMatchObject({
      key: 'cloud',
      displayName: 'Cloud box',
      sshTarget: 'alice@example.com',
      connection: 'online',
      projects: [{ key: 'remote-project' }],
    })
  })

  it('bounds aggregate remote refresh concurrency and preserves registry order', async () => {
    let active = 0
    let peak = 0
    const machines = Array.from({ length: 9 }, (_, index) => ({
      ...remoteMachine,
      key: `cloud-${index}`,
      displayName: `Cloud ${index}`,
      sshTarget: `cloud-${index}.example.com`,
    }))
    const fleet = await inspectMachineFleet({
      cliVersion: '1.2.3',
      loadMachineRegistry: async () => ({ defaultMachine: 'local', machines }),
      loadRegistry: async () => ({ defaultProject: 'default', projects: [] }),
      runRemote: async (_options) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        return JSON.stringify(remoteEnvelope())
      },
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(fleet.machines.map((machine) => machine.key)).toEqual([
      'local',
      ...machines.map((machine) => machine.key),
    ])
  })

  it('distinguishes SSH auth, offline, and incompatible CLI failures', async () => {
    await expect(inspectRegisteredMachine(remoteMachine, {
      runRemote: async () => { throw Object.assign(new Error('failed'), { stderr: 'Permission denied (publickey)' }) },
    })).resolves.toMatchObject({ connection: 'unauthorized', issue: { code: 'ESSHAUTH' } })

    await expect(inspectRegisteredMachine(remoteMachine, {
      runRemote: async () => { throw new Error('connect ECONNREFUSED') },
    })).resolves.toMatchObject({ connection: 'offline', issue: { code: 'ESSHUNAVAILABLE' } })

    await expect(inspectRegisteredMachine(remoteMachine, {
      runRemote: async () => '{not-json',
    })).resolves.toMatchObject({ connection: 'incompatible', issue: { code: 'EINCOMPATIBLE' } })
  })

  it('rejects an incompatible inventory envelope', () => {
    expect(() => parseMachineInspectEnvelope(JSON.stringify({ schemaVersion: 2 })))
      .toThrow('incompatible Machine inventory schema')
  })

  it('rejects terminal control characters from a remote inventory', () => {
    const envelope = remoteEnvelope()
    envelope.machine.projects[0]!.displayName = '\u001b[31mspoofed'
    expect(() => parseMachineInspectEnvelope(JSON.stringify(envelope)))
      .toThrow('invalid Machine inventory')
  })
})

function remoteEnvelope(): MachineInspectEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-23T00:00:00.000Z',
    machine: {
      key: 'local',
      displayName: 'This computer',
      registered: true,
      connection: 'local',
      sshTarget: null,
      platform: 'linux',
      arch: 'x64',
      hostname: 'cloudbox',
      cliVersion: '1.2.3',
      defaultProject: 'remote-project',
      projects: [{
        key: 'remote-project',
        id: 'remote-id',
        displayName: 'Remote Project',
        home: '/home/alice/.openalice',
        port: 47_331,
        portAutomatic: true,
        product: 'trader',
        isDefault: true,
        available: true,
        runtime: {
          class: 'absent',
          state: 'absent',
          ownerSurface: null,
          uptimeSeconds: null,
          webEndpoint: null,
          components: {},
        },
      }],
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
