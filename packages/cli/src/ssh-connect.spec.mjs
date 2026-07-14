import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  buildSshArgs,
  connectSsh,
  openBrowser,
  parseSshConnectArgs,
  waitForOpenAlice,
} from './ssh-connect.mjs'

describe('OpenAlice SSH connector', () => {
  it('parses a small, explicit SSH surface', () => {
    expect(parseSshConnectArgs([
      '--',
      'alice@example.com',
      '--local-port', '41000',
      '--remote-port', '48000',
      '--ssh-port', '2222',
      '--identity', '/tmp/id key',
      '--wait', '15',
      '--no-open',
    ])).toEqual({
      destination: 'alice@example.com',
      localPort: 41000,
      remotePort: 48000,
      sshPort: 2222,
      identityFile: '/tmp/id key',
      openBrowser: false,
      waitMs: 15_000,
    })
  })

  it('accepts pnpm run argument separators', () => {
    expect(parseSshConnectArgs(['--', 'host-alias']).destination).toBe('host-alias')
  })

  it('rejects option-shaped destinations and invalid ports', () => {
    expect(() => parseSshConnectArgs(['-oProxyCommand=bad'])).toThrow('Unknown option')
    expect(() => parseSshConnectArgs(['host', '--remote-port', '0'])).toThrow('between 1 and 65535')
    expect(() => parseSshConnectArgs(['host name'])).toThrow('unsupported characters')
  })

  it('builds a loopback-only tunnel and keeps user paths as argv entries', () => {
    const options = parseSshConnectArgs(['host-alias', '--identity', '/tmp/id key'])
    expect(buildSshArgs(options, 40123)).toEqual([
      '-N', '-T',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-i', '/tmp/id key',
      '-L', '127.0.0.1:40123:127.0.0.1:47331',
      'host-alias',
    ])
  })

  it('waits for the OpenAlice auth contract rather than accepting arbitrary HTTP', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(new Response('<html>wrong service</html>'))
      .mockResolvedValueOnce(Response.json({ authed: true, tokenConfigured: false }))
    await expect(waitForOpenAlice('http://127.0.0.1:40000', {
      fetchImpl,
      timeoutMs: 1_000,
      pollMs: 1,
    })).resolves.toEqual({ authed: true, tokenConfigured: false })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('opens a tunnel, probes it, and keeps the browser on the local URL', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn(() => child)
    const waitForRuntime = vi.fn(async () => ({ authed: true }))
    const launchBrowser = vi.fn(async () => undefined)
    const stdout = { write: vi.fn() }
    const result = connectSsh(parseSshConnectArgs(['host']), {
      allocatePort: async () => 40123,
      spawnProcess,
      waitForRuntime,
      launchBrowser,
      stdout,
    })
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledWith('http://127.0.0.1:40123'))
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
    expect(spawnProcess).toHaveBeenCalledWith('ssh', expect.arrayContaining([
      '-L', '127.0.0.1:40123:127.0.0.1:47331', 'host',
    ]), expect.any(Object))
  })

  it('uses argv-based browser launchers on each desktop platform', async () => {
    for (const [platform, command] of [['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'cmd.exe']]) {
      const child = { unref: vi.fn() }
      const spawnProcess = vi.fn(() => child)
      await openBrowser('http://127.0.0.1:40123', { platform, spawnProcess })
      expect(spawnProcess).toHaveBeenCalledWith(command, expect.any(Array), expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }))
      expect(child.unref).toHaveBeenCalledOnce()
    }
  })
})

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  kill = vi.fn()
}
