import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  machineRegistryPath,
  parseMachineRegistry,
  readMachineRegistry,
  readMachineRegistrySummary,
  registerMachine,
  removeMachine,
  writeMachineRegistry,
} from './machine-registry.ts'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

async function temporarySupervisorRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-machines-'))
  temporaryPaths.push(root)
  return root
}

describe('Supervisor machine registry', () => {
  it('treats a missing document as a local-only registry', async () => {
    const supervisorRoot = await temporarySupervisorRoot()

    await expect(readMachineRegistry({ supervisorRoot })).resolves.toEqual({
      schemaVersion: 1,
    })
    await expect(readMachineRegistrySummary({ supervisorRoot })).resolves.toEqual({
      defaultMachine: 'local',
      machines: [],
    })
  })

  it('registers, lists, and removes owner-private SSH metadata atomically', async () => {
    const supervisorRoot = await temporarySupervisorRoot()
    const homeDir = join(supervisorRoot, 'home')

    await expect(registerMachine({
      key: 'cloud-dev',
      sshTarget: 'alice@cloud-dev',
      sshPort: 2222,
      identityFile: '~/.ssh/cloud-dev',
    }, { supervisorRoot, homeDir })).resolves.toMatchObject({
      key: 'cloud-dev',
      displayName: 'Cloud Dev',
      sshTarget: 'alice@cloud-dev',
      sshPort: 2222,
      identityFile: join(homeDir, '.ssh', 'cloud-dev'),
    })

    const path = machineRegistryPath(supervisorRoot)
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved).toEqual({
      schemaVersion: 1,
      machines: {
        'cloud-dev': {
          displayName: 'Cloud Dev',
          sshTarget: 'alice@cloud-dev',
          sshPort: 2222,
          identityFile: join(homeDir, '.ssh', 'cloud-dev'),
        },
      },
    })
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }

    await expect(readMachineRegistrySummary({ supervisorRoot })).resolves.toMatchObject({
      defaultMachine: 'local',
      machines: [{ key: 'cloud-dev', isDefault: false }],
    })
    await expect(removeMachine('cloud-dev', { supervisorRoot })).resolves.toMatchObject({
      key: 'cloud-dev',
    })
    await expect(readMachineRegistrySummary({ supervisorRoot })).resolves.toEqual({
      defaultMachine: 'local',
      machines: [],
    })
  })

  it('leaves the SSH port unset so OpenSSH config remains authoritative', async () => {
    const supervisorRoot = await temporarySupervisorRoot()
    await registerMachine({
      key: 'configured-host',
      sshTarget: 'my-ssh-alias',
    }, { supervisorRoot })
    const summary = await readMachineRegistrySummary({ supervisorRoot })
    expect(summary).toMatchObject({
      machines: [{
        key: 'configured-host',
        sshTarget: 'my-ssh-alias',
      }],
    })
    expect(summary.machines[0]).not.toHaveProperty('sshPort')
  })

  it('preserves additive unknown root and machine fields through a write', async () => {
    const supervisorRoot = await temporarySupervisorRoot()
    const path = machineRegistryPath(supervisorRoot)
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      futureRoot: { enabled: true },
      machines: {
        cloud: {
          displayName: 'Cloud',
          sshTarget: 'cloud-alias',
          sshPort: 22,
          futureMachine: 'retained',
        },
      },
    }))

    const current = await readMachineRegistry({ supervisorRoot })
    await writeMachineRegistry(current, { supervisorRoot })
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.futureRoot).toEqual({ enabled: true })
    expect(saved.machines.cloud.futureMachine).toBe('retained')
  })

  it('distinguishes newer schema and rejects unsafe known fields', () => {
    expect(() => parseMachineRegistry({ schemaVersion: 2 })).toThrow(
      'requires a newer OpenAlice',
    )
    expect(() => parseMachineRegistry({
      schemaVersion: 1,
      machines: {
        local: {
          displayName: 'Not local',
          sshTarget: 'host',
          sshPort: 22,
        },
      },
    })).toThrow('reserved')
    expect(() => parseMachineRegistry({
      schemaVersion: 1,
      machines: {
        cloud: {
          displayName: 'Cloud',
          sshTarget: '-oProxyCommand=bad',
          sshPort: 22,
        },
      },
    })).toThrow('unsupported characters')
    expect(() => parseMachineRegistry({
      schemaVersion: 1,
      machines: {
        cloud: {
          displayName: 'Cloud',
          sshTarget: 'host',
          sshPort: 70_000,
        },
      },
    })).toThrow('between 1 and 65535')
  })

  it('refuses reserved, duplicate, and unknown mutations', async () => {
    const supervisorRoot = await temporarySupervisorRoot()
    await expect(registerMachine({
      key: 'local',
      sshTarget: 'host',
    }, { supervisorRoot })).rejects.toThrow('cannot be replaced')

    await registerMachine({ key: 'cloud', sshTarget: 'host' }, { supervisorRoot })
    await expect(registerMachine({
      key: 'cloud',
      sshTarget: 'other',
    }, { supervisorRoot })).rejects.toThrow('already registered')
    await expect(removeMachine('missing', { supervisorRoot })).rejects.toThrow(
      'not registered',
    )
    await expect(removeMachine('local', { supervisorRoot })).rejects.toThrow(
      'cannot be removed',
    )
  })
})
