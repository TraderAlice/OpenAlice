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

  it('uses non-interactive SSH only for browser-driven discovery and switching', () => {
    const options = parseSshConnectArgs(['host-alias'])
    expect(buildSshArgs({ ...options, batchMode: true }, 40123)).toContain('BatchMode=yes')
    expect(buildSshArgs(options, 40123)).not.toContain('BatchMode=yes')
  })

  it('does not permit a browser to open the backend SSH tunnel directly', async () => {
    await expect(connectSsh({ ...parseSshConnectArgs(['host']), openBrowser: true })).rejects.toThrow('Direct SSH browser attach is retired')
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

  it('opens a tunnel for the relay without opening a browser', async () => {
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
    await vi.waitFor(() => expect(waitForRuntime).toHaveBeenCalledWith('http://127.0.0.1:40123', expect.any(Object)))
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
    expect(launchBrowser).not.toHaveBeenCalled()
    expect(spawnProcess).toHaveBeenCalledWith('ssh', expect.arrayContaining([
      '-L', '127.0.0.1:40123:127.0.0.1:47331', 'host',
    ]), expect.any(Object))
  })

  it('reuses a remembered port and reports the ready URL to its owner', async () => {
    const child = new FakeChild()
    const onReady = vi.fn(async () => undefined)
    const result = connectSsh({
      ...parseSshConnectArgs(['host', '--no-open']),
      preferredLocalPort: 40124,
      onReady,
    }, {
      portAvailable: async () => true,
      spawnProcess: () => child,
      waitForRuntime: async () => ({ authed: true }),
      stdout: { write: vi.fn() },
    })
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({
      localPort: 40124,
      localUrl: 'http://127.0.0.1:40124',
      clientUrl: 'http://127.0.0.1:40124',
    }))
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
  })

  it('closes a TUI-owned tunnel when its abort signal fires', async () => {
    const child = new FakeChild()
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'))
      return true
    })
    const controller = new AbortController()
    const result = connectSsh({
      ...parseSshConnectArgs(['host', '--no-open']),
      signal: controller.signal,
    }, {
      allocatePort: async () => 40123,
      spawnProcess: () => child,
      waitForRuntime: async () => ({ authed: true }),
      stdout: { write: vi.fn() },
    })
    await vi.waitFor(() => expect(child.listenerCount('exit')).toBeGreaterThan(0))
    controller.abort()
    await expect(result).resolves.toBe(0)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('falls back cleanly when a remembered port is occupied', async () => {
    const child = new FakeChild()
    const stdout = { write: vi.fn() }
    const spawnProcess = vi.fn(() => child)
    const result = connectSsh({
      ...parseSshConnectArgs(['host', '--no-open']),
      preferredLocalPort: 40124,
    }, {
      portAvailable: async () => false,
      allocatePort: async () => 40125,
      spawnProcess,
      waitForRuntime: async () => ({ authed: true }),
      stdout,
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalled())
    child.emit('exit', 0, null)
    await expect(result).resolves.toBe(0)
    expect(stdout.write).toHaveBeenCalledWith('Remembered local port 40124 is busy; using 40125 instead.\n')
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
