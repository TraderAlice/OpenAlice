import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  parseServerArgs,
  runServerCommand,
  startRuntimeServer,
} from './server.mjs'

describe('OpenAlice Server CLI', () => {
  it('parses lifecycle-specific options', () => {
    expect(parseServerArgs('start', [
      '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
      '--port', '41000',
      '--log', '/tmp/server log.txt',
      '--takeover',
      '--no-open',
    ])).toEqual(expect.objectContaining({
      appDir: '/tmp/OpenAlice',
      homeRoot: '/tmp/alice-home',
      port: 41000,
      logFile: '/tmp/server log.txt',
      openBrowser: false,
      takeover: true,
    }))
    expect(parseServerArgs('status', ['--home', '/tmp/alice-home', '--json'])).toEqual({
      homeRoot: '/tmp/alice-home',
      json: true,
      port: 47331,
      waitMs: 2_000,
    })
  })

  it('reuses a healthy matching Server without preparing or spawning', async () => {
    const resolveRoot = vi.fn()
    const stdout = { write: vi.fn() }
    await expect(startRuntimeServer(parseServerArgs('start', []), {
      detached: true,
      readStatus: async () => runningStatus(),
      resolveRoot,
      stdout,
    })).resolves.toBe(0)
    expect(resolveRoot).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('already running'))
  })

  it('refuses another launcher without explicit takeover', async () => {
    await expect(startRuntimeServer(parseServerArgs('start', []), {
      detached: true,
      readStatus: async () => ({
        ...runningStatus(),
        class: 'owned_elsewhere',
        owner: { ...runningStatus().owner, surface: 'electron' },
      }),
    })).rejects.toThrow('electron already owns')
  })

  it('detaches only after the Guardian control status is ready', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn(() => child)
    const prepareSource = vi.fn(async () => ({ prepared: false }))
    const closeLog = vi.fn(async () => undefined)
    const stdout = { write: vi.fn() }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValueOnce({ ...runningStatus(), class: 'starting', state: 'starting' })
      .mockResolvedValue(runningStatus())

    await expect(startRuntimeServer(parseServerArgs('start', [
      '--app-dir', '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
      '--port', '41000',
    ]), {
      detached: true,
      env: { PATH: '/bin' },
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource,
      spawnProcess,
      openFile: async () => ({ fd: 9, close: closeLog }),
      mkdirImpl: vi.fn(async () => undefined),
      readStatus,
      sleep: async () => undefined,
      stdout,
    })).resolves.toBe(0)

    expect(prepareSource).toHaveBeenCalledOnce()
    expect(spawnProcess).toHaveBeenCalledWith('/test/node', ['scripts/guardian/prod.mjs'], expect.objectContaining({
      cwd: '/tmp/OpenAlice',
      detached: true,
      stdio: ['ignore', 9, 9],
      env: expect.objectContaining({
        OPENALICE_HOME: resolve('/tmp/alice-home'),
        OPENALICE_BIND_HOST: '127.0.0.1',
        OPENALICE_WEB_PORT: '41000',
        OPENALICE_LAUNCHER: 'cli-server',
        OPENALICE_SERVER_MODE: 'detached',
      }),
    }))
    expect(child.unref).toHaveBeenCalledOnce()
    expect(closeLog).toHaveBeenCalledOnce()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('keep running'))
  })

  it('waits for an explicit takeover to replace the previous owner', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn(() => child)
    const previousOwner = {
      ...runningStatus(),
      class: 'owned_elsewhere',
      owner: { ...runningStatus().owner, surface: 'cli-server' },
      endpoints: {},
      capabilities: [],
    }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(previousOwner)
      .mockResolvedValueOnce(previousOwner)
      .mockResolvedValue(runningStatus())

    await expect(startRuntimeServer(parseServerArgs('start', [
      '--app-dir', '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
      '--takeover',
    ]), {
      detached: true,
      env: { PATH: '/bin' },
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess,
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(readStatus).toHaveBeenCalledTimes(3)
    expect(spawnProcess).toHaveBeenCalledWith('/test/node', ['scripts/guardian/prod.mjs'], expect.objectContaining({
      env: expect.objectContaining({ OPENALICE_TAKEOVER: '1' }),
    }))
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps server run in the foreground until its Guardian exits', async () => {
    const child = new FakeChild()
    const stdout = { write: vi.fn((text) => {
      if (String(text).includes('stays active')) setTimeout(() => child.finish(0), 0)
    }) }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValue(runningStatus())
    await expect(startRuntimeServer(parseServerArgs('run', ['--app-dir', '/tmp/OpenAlice']), {
      detached: false,
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess: vi.fn(() => child),
      readStatus,
      stdout,
    })).resolves.toBe(0)
  })

  it('cancels readiness polling when the detached Guardian exits early', async () => {
    const child = new FakeChild()
    const never = () => new Promise(() => undefined)
    const startedAt = Date.now()

    await expect(startRuntimeServer(parseServerArgs('start', [
      '--app-dir', '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
    ]), {
      detached: true,
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess: () => {
        queueMicrotask(() => child.finish(1))
        return child
      },
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus: async () => absentStatus(),
      sleep: never,
      stdout: { write: vi.fn() },
    })).rejects.toThrow('exited before it was ready')

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('prints stable JSON for status and stop', async () => {
    const stdout = { write: vi.fn() }
    await runServerCommand('status', parseServerArgs('status', ['--json']), {
      readStatus: async () => runningStatus(),
      stdout,
    })
    expect(JSON.parse(stdout.write.mock.calls[0][0])).toEqual(expect.objectContaining({ class: 'running' }))

    stdout.write.mockClear()
    await runServerCommand('stop', parseServerArgs('stop', ['--json']), {
      stopRuntime: async () => ({ stopped: true, status: absentStatus() }),
      stdout,
    })
    expect(JSON.parse(stdout.write.mock.calls[0][0])).toEqual(expect.objectContaining({ stopped: true }))
  })
})

function runningStatus() {
  return {
    protocol: 1,
    class: 'running',
    state: 'running',
    home: '/tmp/alice-home',
    owner: { surface: 'cli-server', pid: 123, instanceId: 'test' },
    endpoints: { web: 'http://127.0.0.1:41000' },
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
    capabilities: ['runtime.stop'],
  }
}

function absentStatus() {
  return {
    protocol: 1,
    class: 'absent',
    state: 'absent',
    home: '/tmp/alice-home',
    owner: null,
    endpoints: {},
    components: {},
    capabilities: [],
  }
}

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  kill = vi.fn()
  unref = vi.fn()

  finish(code) {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}
