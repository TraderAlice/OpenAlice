import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import {
  buildRemoteCommand,
  runMachineTarget,
  runTargetCommand,
} from './machine-target-command.mjs'

describe('OpenAlice --machine target dispatch', () => {
  it('streams once and preserves SSH/command failures instead of replaying mutations', async () => {
    const child = new EventEmitter()
    const spawnProcess = vi.fn(() => child)
    const result = runTargetCommand({ destination: 'host' }, 'command', { spawnProcess })
    child.emit('exit', 255, null)
    expect(await result).toBe(255)
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(spawnProcess).toHaveBeenCalledWith('ssh', expect.any(Array), expect.objectContaining({ stdio: 'inherit' }))
  })
  it('forwards the ordinary command through the selected SSH Machine', async () => {
    const runRemote = vi.fn(async () => 7)
    await expect(runMachineTarget('0123456789abcdef0123456789abcdef', ['status', '--json'], {
      loadMachines: async () => ({
        defaultMachine: 'local',
        machines: [{
          key: 'cloud',
          id: '0123456789abcdef0123456789abcdef',
          displayName: 'Cloud',
          sshTarget: 'alice@example.com',
          sshPort: 2222,
          identityFile: '/keys/cloud',
          enabled: true,
          isDefault: false,
        }],
      }),
      readStartup: async () => ({ machine: 'cloud', project: 'research' }),
      runRemote,
    })).resolves.toBe(7)
    expect(runRemote).toHaveBeenCalledWith({
      destination: 'alice@example.com',
      sshPort: 2222,
      identityFile: '/keys/cloud',
    }, expect.stringContaining("exec \"$cli\" 'status' '--json'"), expect.any(Object))
  })

  it('does not dispatch to a disabled Machine', async () => {
    await expect(runMachineTarget('cloud', ['status'], {
      loadMachines: async () => ({
        defaultMachine: 'local',
        machines: [{
          key: 'cloud',
          displayName: 'Cloud',
          sshTarget: 'alice@example.com',
          enabled: false,
          isDefault: false,
        }],
      }),
    })).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('re-enters the local dispatcher for the implicit local Machine', async () => {
    const runLocal = vi.fn(async () => 7)
    await expect(runMachineTarget('local', ['status'], { runLocal, readStartup: async () => ({ machine: 'local', project: 'research' }) })).resolves.toBe(7)
    expect(runLocal).toHaveBeenCalledWith(['status', '--project', 'research'])
  })

  it('rejects a remote Default for an explicit local lifecycle command', async () => {
    const runLocal = vi.fn()
    await expect(runMachineTarget('local', ['status'], {
      runLocal, readStartup: async () => ({ machine: 'cloud', project: 'research' }),
    })).rejects.toMatchObject({ code: 'EUSAGE' })
    expect(runLocal).not.toHaveBeenCalled()
  })

  it('sets a remote Default on the origin without invoking the remote project-use command', async () => {
    const runRemote = vi.fn()
    const writeStartup = vi.fn(async () => {})
    await expect(runMachineTarget('cloud', ['project', 'use', 'research'], {
      loadMachines: async () => ({ machines: [{ key: 'cloud', sshTarget: 'alice@host', enabled: true }] }),
      inspectMachine: async () => ({ projects: [{ key: 'research' }] }),
      writeStartup, runRemote,
    })).resolves.toBe(0)
    expect(writeStartup).toHaveBeenCalledWith({ machine: 'cloud', project: 'research' })
    expect(runRemote).not.toHaveBeenCalled()
  })

  it('shell-quotes every forwarded argument', () => {
    expect(buildRemoteCommand(['status', '--home', '/tmp/space here', "it's safe"])).toContain(
      `exec "$cli" 'status' '--home' '/tmp/space here' 'it'\\''s safe'`,
    )
  })
})
