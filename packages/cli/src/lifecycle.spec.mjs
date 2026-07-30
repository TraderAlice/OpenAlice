import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  inspectRuntime,
  openRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'

describe('OpenAlice Runtime lifecycle core', () => {
  it('inspects the selected complete home without presentation side effects', async () => {
    const readStatus = vi.fn(async () => runningStatus())
    await expect(inspectRuntime({
      homeRoot: '/tmp/alice-home',
      waitMs: 4_000,
    }, { readStatus })).resolves.toEqual(runningStatus())
    expect(readStatus).toHaveBeenCalledWith({
      homeRoot: '/tmp/alice-home',
      timeoutMs: 4_000,
    }, expect.objectContaining({ readStatus }))
  })

  it('returns a structured idempotent result for a healthy matching owner', async () => {
    const resolveRoot = vi.fn()
    await expect(startRuntime(startOptions(), {
      detached: true,
      readStatus: async () => runningStatus(),
      resolveRoot,
    })).resolves.toEqual(expect.objectContaining({
      outcome: 'already-running',
      mode: 'detached',
      homeRoot: resolve('/tmp/alice-home'),
      status: expect.objectContaining({ class: 'running' }),
    }))
    expect(resolveRoot).not.toHaveBeenCalled()
  })

  it('starts a detached Guardian and emits readiness as structured state', async () => {
    const child = new FakeChild()
    const emit = vi.fn()
    const progressOutput = { write: vi.fn() }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValueOnce({ ...runningStatus(), class: 'starting', state: 'starting' })
      .mockResolvedValue(runningStatus())
    const closeLog = vi.fn(async () => undefined)
    const spawnProcess = vi.fn(() => child)

    const result = await startRuntime(startOptions(), {
      detached: true,
      env: { PATH: '/bin' },
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async (_appDir, _options, dependencies) => {
        expect(dependencies.stdout).toBe(progressOutput)
        return { prepared: false }
      },
      spawnProcess,
      openFile: async () => ({ fd: 9, close: closeLog }),
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
      progressOutput,
      emit,
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'started',
      mode: 'detached',
      appDir: '/tmp/OpenAlice',
      homeRoot: resolve('/tmp/alice-home'),
      logPath: resolve('/tmp/alice-home/logs/server.log'),
      status: expect.objectContaining({ class: 'running' }),
    }))
    expect(spawnProcess).toHaveBeenCalledWith('/test/node', ['scripts/guardian/prod.mjs'], expect.objectContaining({
      cwd: '/tmp/OpenAlice',
      detached: true,
      stdio: ['ignore', 9, 9],
      env: expect.objectContaining({
        OPENALICE_HOME: resolve('/tmp/alice-home'),
        OPENALICE_LAUNCHER: 'cli-server',
        OPENALICE_SERVER_MODE: 'detached',
      }),
    }))
    expect(child.unref).toHaveBeenCalledOnce()
    expect(closeLog).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({
      type: 'ready',
      result: expect.objectContaining({ outcome: 'started' }),
    })
  })

  it('allows its spawned Guardian ownership transition but rejects a racing owner', async () => {
    const child = new FakeChild()
    child.pid = 321
    const racingStatus = {
      ...runningStatus(),
      class: 'owned_elsewhere',
      state: 'starting',
      owner: {
        ...runningStatus().owner,
        pid: 999,
      },
      endpoints: {},
    }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValue(racingStatus)

    await expect(startRuntime(startOptions(), {
      detached: true,
      env: {},
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess: () => child,
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
    })).rejects.toMatchObject({
      code: 'EOWNED',
      message: expect.stringContaining('pid 999'),
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('preserves Guardian takeover authority instead of signaling the old owner itself', async () => {
    const child = new FakeChild()
    const previousOwner = {
      ...runningStatus(),
      class: 'owned_elsewhere',
      endpoints: {},
      capabilities: [],
    }
    const readStatus = vi.fn()
      .mockResolvedValueOnce(previousOwner)
      .mockResolvedValueOnce(previousOwner)
      .mockResolvedValue(runningStatus())
    const spawnProcess = vi.fn(() => child)

    await expect(startRuntime({ ...startOptions(), takeover: true }, {
      detached: true,
      env: {},
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess,
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
    })).resolves.toEqual(expect.objectContaining({ outcome: 'started' }))

    expect(spawnProcess).toHaveBeenCalledWith('/test/node', ['scripts/guardian/prod.mjs'], expect.objectContaining({
      env: expect.objectContaining({ OPENALICE_TAKEOVER: '1' }),
    }))
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('refuses another owner without explicit takeover', async () => {
    await expect(startRuntime(startOptions(), {
      detached: true,
      readStatus: async () => ({
        ...runningStatus(),
        class: 'owned_elsewhere',
        owner: { ...runningStatus().owner, surface: 'electron' },
      }),
    })).rejects.toMatchObject({
      code: 'EOWNED',
      message: expect.stringContaining('electron already owns'),
    })
  })

  it('opens only a verified advertised Web endpoint, including Electron ownership', async () => {
    const launchBrowser = vi.fn(async () => undefined)
    const status = {
      ...runningStatus(),
      class: 'owned_elsewhere',
      owner: { ...runningStatus().owner, surface: 'electron' },
    }
    await expect(openRuntime({ homeRoot: '/tmp/alice-home' }, {
      readStatus: async () => status,
      probeRuntime: async (url) => url === status.endpoints.web,
      launchBrowser,
    })).resolves.toEqual({ opened: true, url: status.endpoints.web, status })
    expect(launchBrowser).toHaveBeenCalledWith(status.endpoints.web)
  })

  it('does not open an absent or unready Runtime', async () => {
    await expect(openRuntime({ homeRoot: '/tmp/alice-home' }, {
      readStatus: async () => absentStatus(),
    })).rejects.toMatchObject({ code: 'ERUNTIMENOTREADY' })
    await expect(openRuntime({ homeRoot: '/tmp/alice-home' }, {
      readStatus: async () => runningStatus(),
      probeRuntime: async () => false,
    })).rejects.toThrow('Web UI is not ready')
    await expect(openRuntime({ homeRoot: '/tmp/alice-home' }, {
      readStatus: async () => ({
        ...runningStatus(),
        endpoints: { web: 'https://example.com/openalice' },
      }),
    })).rejects.toMatchObject({ code: 'EINVALIDENDPOINT' })
  })

  it('delegates graceful stop to the Guardian control client', async () => {
    const stopRuntimeImpl = vi.fn(async () => ({ stopped: true, status: absentStatus() }))
    await expect(stopRuntime({
      homeRoot: '/tmp/alice-home',
      waitMs: 15_000,
    }, { stopRuntime: stopRuntimeImpl })).resolves.toEqual(expect.objectContaining({ stopped: true }))
    expect(stopRuntimeImpl).toHaveBeenCalledWith({
      homeRoot: '/tmp/alice-home',
      waitMs: 15_000,
    }, expect.objectContaining({ stopRuntime: stopRuntimeImpl }))
  })
})

function startOptions() {
  return {
    appDir: '/tmp/OpenAlice',
    homeRoot: '/tmp/alice-home',
    port: 41000,
    prepare: true,
    rebuild: false,
    takeover: false,
    waitMs: 120_000,
    logFile: null,
  }
}

function runningStatus() {
  return {
    protocol: 1,
    class: 'running',
    runtimeVersion: '0.87.0-beta',
    state: 'running',
    home: resolve('/tmp/alice-home'),
    owner: {
      surface: 'cli-server',
      pid: 123,
      instanceId: 'test',
      mode: 'detached',
      launchRoot: '/tmp/OpenAlice',
    },
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
    home: resolve('/tmp/alice-home'),
    owner: null,
    endpoints: {},
    components: {},
    capabilities: [],
  }
}

class FakeChild extends EventEmitter {
  pid = 123
  exitCode = null
  signalCode = null
  kill = vi.fn()
  unref = vi.fn()
}
