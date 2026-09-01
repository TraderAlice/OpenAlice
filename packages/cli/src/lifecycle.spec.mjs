import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readActivationReceipt, recordPendingActivation } from './activation.mjs'

import {
  inspectRuntime,
  openRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

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

  it('reports a package-manager activation when installed and running content differ', async () => {
    const status = await inspectRuntime(startOptions(), {
      activationLayout: null,
      installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
      cliVersion: '0.92.0',
      readStatus: async () => runningStatus('aaaaaaaaaaaaaaaa'),
    })
    expect(status.pendingActivation).toEqual({
      productVersion: '0.92.0',
      restartRequired: true,
      reason: 'The installed OpenAlice package differs from the running Runtime',
    })
  })

  it('reports a direct activation against an older live Runtime and confirms matching up readiness', async () => {
    const fixture = await makeActivationLayout()
    await recordPendingActivation(fixture.layout, {
      activeRelease: fixture.currentName,
      previousRelease: fixture.previousName,
      productVersion: '0.92.0',
    })
    const dependencies = {
      activationLayout: fixture.layout,
      installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
    }

    const pending = await inspectRuntime(startOptions(), {
      ...dependencies,
      readStatus: async () => runningStatus('aaaaaaaaaaaaaaaa'),
    })
    expect(pending.pendingActivation).toMatchObject({
      productVersion: '0.92.0',
      restartRequired: true,
    })
    expect((await readActivationReceipt(fixture.layout)).state).toBe('pending')

    const confirmed = await startRuntime(startOptions(), {
      ...dependencies,
      readStatus: async () => runningStatus('bbbbbbbbbbbbbbbb'),
    })
    expect(confirmed.status.pendingActivation).toBeNull()
    expect((await readActivationReceipt(fixture.layout)).state).toBe('confirmed')
  })

  it('does not let a still-running previous CLI confirm the new direct activation', async () => {
    const fixture = await makeActivationLayout()
    await recordPendingActivation(fixture.layout, {
      activeRelease: fixture.currentName,
      previousRelease: fixture.previousName,
      productVersion: '0.92.0',
    })
    const result = await startRuntime(startOptions(), {
      activationLayout: fixture.layout,
      installedContentIdentityImpl: () => 'aaaaaaaaaaaaaaaa',
      readStatus: async () => runningStatus('aaaaaaaaaaaaaaaa'),
    })
    expect(result.status.pendingActivation).toMatchObject({ productVersion: '0.92.0' })
    expect((await readActivationReceipt(fixture.layout)).state).toBe('pending')
  })

  it.skipIf(process.platform === 'win32')('restores the exact previous direct release when first readiness exits early', async () => {
    const fixture = await makeActivationLayout()
    await recordPendingActivation(fixture.layout, {
      activeRelease: fixture.currentName,
      previousRelease: fixture.previousName,
      productVersion: '0.92.0',
    })
    const child = new FakeChild()
    child.pid = 456
    const spawnProcess = () => {
      setImmediate(() => child.emit('exit', 1, null))
      return child
    }

    await expect(startRuntime(startOptions(), {
      activationLayout: fixture.layout,
      installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
      detached: true,
      env: {},
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess,
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus: async () => absentStatus(),
      sleep: async () => new Promise(() => undefined),
    })).rejects.toMatchObject({
      code: 'EEARLYEXIT',
      message: expect.stringContaining(`rolled back to ${fixture.previousName}`),
      rollback: {
        failedRelease: fixture.currentName,
        restoredRelease: fixture.previousName,
      },
    })
    expect(await readlink(fixture.layout.currentPath)).toBe(join('releases', fixture.previousName))
    expect(await readActivationReceipt(fixture.layout)).toMatchObject({
      state: 'rolled_back',
      failureCode: 'EEARLYEXIT',
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('does not race a live installer while handling readiness failure', async () => {
    const fixture = await makeActivationLayout()
    await recordPendingActivation(fixture.layout, {
      activeRelease: fixture.currentName,
      previousRelease: fixture.previousName,
      productVersion: '0.92.0',
    })
    await mkdir(fixture.layout.lockDir)
    await writeFile(resolve(fixture.layout.lockDir, 'pid'), `${process.pid}\n`)
    const child = new FakeChild()
    const spawnProcess = () => {
      setImmediate(() => child.emit('exit', 1, null))
      return child
    }

    await expect(startRuntime(startOptions(), {
      activationLayout: fixture.layout,
      installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
      detached: true,
      env: {},
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess,
      openFile: async () => ({ fd: 9, close: async () => undefined }),
      mkdirImpl: async () => undefined,
      readStatus: async () => absentStatus(),
      sleep: async () => new Promise(() => undefined),
    })).rejects.toMatchObject({ code: 'EEARLYEXIT' })
    expect(await readlink(fixture.layout.currentPath)).toBe(join('releases', fixture.currentName))
    expect((await readActivationReceipt(fixture.layout)).state).toBe('pending')
  })

  it('does not roll back a confirmed activation or an initial install without a previous release', async () => {
    for (const receipt of [
      { state: 'confirmed', previousRelease: 'previous-release' },
      { state: 'pending', previousRelease: null },
    ]) {
      const child = new FakeChild()
      const activateReleaseImpl = vi.fn()
      const spawnProcess = () => {
        setImmediate(() => child.emit('exit', 1, null))
        return child
      }
      await expect(startRuntime(startOptions(), {
        activationLayout: {
          kind: 'bun',
          currentPath: '/cli/current',
          releasesDir: '/releases',
        },
        readActivationReceiptImpl: async () => ({
          schemaVersion: 1,
          activeRelease: 'current-release',
          productVersion: '0.92.0',
          activatedAt: '2026-08-30T01:00:00.000Z',
          ...receipt,
        }),
        realpathImpl: async (path) => path.endsWith('current') ? '/releases/current-release' : '/releases',
        installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
        activateReleaseImpl,
        detached: true,
        env: {},
        nodeBinary: '/test/node',
        resolveRoot: async (path) => path,
        prepareSource: async () => ({ prepared: false }),
        spawnProcess,
        openFile: async () => ({ fd: 9, close: async () => undefined }),
        mkdirImpl: async () => undefined,
        readStatus: async () => absentStatus(),
        sleep: async () => new Promise(() => undefined),
      })).rejects.toMatchObject({ code: 'EEARLYEXIT' })
      expect(activateReleaseImpl).not.toHaveBeenCalled()
    }
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

  it('starts the Bun Guardian role without source preparation', async () => {
    vi.stubGlobal('__OPENALICE_BUN_STANDALONE__', true)
    try {
      const child = new FakeChild()
      const prepareSource = vi.fn()
      const resolveRoot = vi.fn()
      const spawnProcess = vi.fn(() => child)
      const readStatus = vi.fn()
        .mockResolvedValueOnce(absentStatus())
        .mockResolvedValue(runningStatus())

      await startRuntime({
        ...startOptions(),
        appDir: null,
        runtimeProvider: { kind: 'bun', contentIdentity: 'release-content-1' },
      }, {
        detached: true,
        env: {
          OPENALICE_APP_HOME: '/opt/openalice/releases/v1/share/openalice',
          OPENALICE_MANAGED_PI_PATH: '/desktop/pi/cli.js',
          OPENALICE_MANAGED_PI_NODE_PATH: '/desktop/node',
          PI_CODING_AGENT_DIR: '/native/pi',
        },
        runtimeExecutable: '/opt/openalice/releases/v1/bin/openalice',
        prepareSource,
        resolveRoot,
        spawnProcess,
        openFile: async () => ({ fd: 9, close: async () => undefined }),
        mkdirImpl: async () => undefined,
        readStatus,
        sleep: async () => undefined,
      })

      expect(resolveRoot).not.toHaveBeenCalled()
      expect(prepareSource).not.toHaveBeenCalled()
      expect(spawnProcess).toHaveBeenCalledWith(
        '/opt/openalice/releases/v1/bin/openalice',
        ['--internal-role', 'guardian'],
        expect.objectContaining({
          cwd: resolve('/opt/openalice/releases/v1/share/openalice'),
          env: expect.objectContaining({
            OPENALICE_RUNTIME_PROVIDER: 'bun',
            OPENALICE_RUNTIME_EXECUTABLE: '/opt/openalice/releases/v1/bin/openalice',
            PI_CODING_AGENT_DIR: '/native/pi',
          }),
        }),
      )
      const spawnedEnv = spawnProcess.mock.calls[0][2].env
      expect(spawnedEnv).not.toHaveProperty('OPENALICE_MANAGED_PI_PATH')
      expect(spawnedEnv).not.toHaveProperty('OPENALICE_MANAGED_PI_NODE_PATH')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('injects and confirms the installed Bun identity on a direct server start', async () => {
    const fixture = await makeActivationLayout()
    await recordPendingActivation(fixture.layout, {
      activeRelease: fixture.currentName,
      previousRelease: fixture.previousName,
      productVersion: '0.92.0',
    })
    vi.stubGlobal('__OPENALICE_BUN_STANDALONE__', true)
    try {
      const child = new FakeChild()
      const spawnProcess = vi.fn(() => child)
      const readStatus = vi.fn()
        .mockResolvedValueOnce(absentStatus())
        .mockResolvedValue(runningStatus('bbbbbbbbbbbbbbbb'))

      const result = await startRuntime({
        ...startOptions(),
        appDir: null,
      }, {
        activationLayout: fixture.layout,
        installedContentIdentityImpl: () => 'bbbbbbbbbbbbbbbb',
        cliVersion: '0.92.0',
        detached: true,
        env: {
          OPENALICE_APP_HOME: '/opt/openalice/releases/v1/share/openalice',
          OPENALICE_RUNTIME_CONTENT_IDENTITY: '   ',
        },
        runtimeExecutable: '/opt/openalice/releases/v1/bin/openalice',
        spawnProcess,
        openFile: async () => ({ fd: 9, close: async () => undefined }),
        mkdirImpl: async () => undefined,
        readStatus,
        sleep: async () => undefined,
      })

      expect(spawnProcess.mock.calls[0][2].env).toEqual(expect.objectContaining({
        OPENALICE_RUNTIME_PROVIDER: 'bun',
        OPENALICE_RUNTIME_CONTENT_IDENTITY: 'bbbbbbbbbbbbbbbb',
      }))
      expect(result.status.pendingActivation).toBeNull()
      expect((await readActivationReceipt(fixture.layout)).state).toBe('confirmed')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns a failure when the foreground Guardian exits from an unexpected signal', async () => {
    const child = new FakeChild()
    const signalSource = new EventEmitter()
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValue(runningStatus())

    const result = await startRuntime(startOptions(), {
      detached: false,
      env: {},
      signalSource,
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess: () => child,
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
      emit(event) {
        if (event.type === 'ready') child.emit('exit', null, 'SIGKILL')
      },
    })

    expect(result).toMatchObject({ outcome: 'exited', exitCode: 1 })
  })

  it('installs the steady signal relay before reporting foreground readiness', async () => {
    const child = new FakeChild()
    const signalSource = new EventEmitter()
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValue(runningStatus())
    child.kill.mockImplementation(() => {
      child.signalCode = 'SIGTERM'
      queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
      return true
    })

    const result = await startRuntime(startOptions(), {
      detached: false,
      env: {},
      signalSource,
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess: () => child,
      mkdirImpl: async () => undefined,
      readStatus,
      sleep: async () => undefined,
      emit(event) {
        if (event.type === 'ready') signalSource.emit('SIGTERM')
      },
    })

    expect(child.kill).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(result).toMatchObject({ outcome: 'exited', exitCode: 0 })
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
      env: expect.objectContaining({
        OPENALICE_TAKEOVER: '1',
      }),
      stdio: ['ignore', 9, 9],
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

  it('starts the foreground Runtime after the Volume fence and owner cleanup agree', async () => {
    const child = new FakeChild()
    const readStatus = vi.fn()
      .mockResolvedValueOnce(absentStatus())
      .mockResolvedValue(runningStatus())
    const spawnProcess = vi.fn(() => child)

    await expect(startRuntime(startOptions(), {
      detached: false,
      env: {
        OPENALICE_RAILWAY_ENTRYPOINT_OWNER: '1',
        OPENALICE_RAILWAY_FENCE_FD: '9',
        OPENALICE_RAILWAY_INSTANCE_ID: '22222222-2222-4222-8222-222222222222',
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      nodeBinary: '/test/node',
      resolveRoot: async (path) => path,
      prepareSource: async () => ({ prepared: false }),
      spawnProcess,
      readStatus,
      sleep: async () => undefined,
      resolveRailwayFenceFd: () => 9,
      emit(event) {
        if (event.type === 'ready') child.emit('exit', 0, null)
      },
    })).resolves.toEqual(expect.objectContaining({ outcome: 'exited', exitCode: 0 }))

    expect(readStatus).toHaveBeenCalledTimes(2)
    const spawnedEnvironment = spawnProcess.mock.calls[0][2].env
    expect(spawnedEnvironment).not.toHaveProperty('OPENALICE_RAILWAY_ENTRYPOINT_OWNER')
    expect(spawnedEnvironment).toHaveProperty('OPENALICE_RAILWAY_FENCE_FD', '3')
    expect(spawnedEnvironment).toHaveProperty(
      'OPENALICE_RAILWAY_INSTANCE_ID',
      '22222222-2222-4222-8222-222222222222',
    )
    expect(spawnProcess.mock.calls[0][2].stdio).toEqual(['inherit', 'inherit', 'inherit', 9])
  })

  it('fails closed before inspection when Railway has no valid locked Volume FD', async () => {
    const sleep = vi.fn(async () => undefined)
    const readStatus = vi.fn(async () => ({
      ...runningStatus(),
      class: 'owned_elsewhere',
      owner: { ...runningStatus().owner, surface: 'cli-server' },
    }))
    await expect(startRuntime(startOptions(), {
      detached: true,
      env: {
        OPENALICE_RAILWAY_ENTRYPOINT_OWNER: '1',
        OPENALICE_RAILWAY_FENCE_FD: '9',
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      readStatus,
      sleep,
      resolveRailwayFenceFd: () => null,
    })).rejects.toMatchObject({
      code: 'ERAILWAYFENCE',
      message: expect.stringContaining('image entrypoint'),
    })
    expect(readStatus).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails retained pre-fence ownership immediately with reversible cutover guidance', async () => {
    const previousOwner = {
      ...runningStatus(),
      class: 'owned_elsewhere',
      endpoints: {},
      capabilities: [],
    }
    const resolveRoot = vi.fn(async (path) => path)
    const prepareSource = vi.fn(async () => ({ prepared: false }))
    const spawnProcess = vi.fn(() => new FakeChild())
    const emit = vi.fn()

    const readStatus = vi.fn(async () => previousOwner)
    await expect(startRuntime({ ...startOptions(), waitMs: 10 }, {
      detached: false,
      env: {
        OPENALICE_RAILWAY_ENTRYPOINT_OWNER: '1',
        OPENALICE_RAILWAY_FENCE_FD: '9',
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      readStatus,
      resolveRoot,
      prepareSource,
      spawnProcess,
      emit,
      resolveRailwayFenceFd: () => 9,
    })).rejects.toMatchObject({
      code: 'ERAILWAYCUTOVER',
      message: expect.stringContaining('state/guardian.lock'),
    })
    expect(readStatus).toHaveBeenCalledOnce()
    expect(resolveRoot).not.toHaveBeenCalled()
    expect(prepareSource).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
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

function runningStatus(contentIdentity = null) {
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
    provider: {
      kind: contentIdentity ? 'bun' : 'source',
      ...(contentIdentity ? { contentIdentity } : {}),
    },
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

async function makeActivationLayout() {
  const root = await mkdtemp(resolve(tmpdir(), 'openalice-lifecycle-'))
  temporaryPaths.push(root)
  const cliDir = resolve(root, 'cli')
  const releasesDir = resolve(cliDir, 'releases')
  const provenanceDir = resolve(cliDir, 'provenance')
  const previousName = '0.91.0-linux-x64-aaaaaaaaaaaaaaaa'
  const currentName = '0.92.0-linux-x64-bbbbbbbbbbbbbbbb'
  await mkdir(provenanceDir, { recursive: true })
  for (const [name, version] of [[previousName, '0.91.0'], [currentName, '0.92.0']]) {
    const executable = resolve(releasesDir, name, 'bin', 'openalice')
    await mkdir(resolve(executable, '..'), { recursive: true })
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    await writeFile(resolve(provenanceDir, `${name}.json`), `${JSON.stringify({
      schemaVersion: 3,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: version,
      selector: { kind: 'version', value: `v${version}` },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'stable',
      method: 'direct',
      artifact: { platform: 'linux', arch: 'x64', sha256: '0'.repeat(64) },
      installedAt: '2026-08-30T01:00:00.000Z',
    })}\n`)
  }
  await symlink(`releases/${currentName}`, resolve(cliDir, 'current'))
  return {
    previousName,
    currentName,
    layout: {
      kind: 'bun',
      cliDir,
      releasesDir,
      currentPath: resolve(cliDir, 'current'),
      provenanceDir,
      activationPath: resolve(cliDir, 'activation.json'),
      lockDir: resolve(root, '.cli-install.lock'),
    },
  }
}
