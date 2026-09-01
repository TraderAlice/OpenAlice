import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startGuardianControlServer } from '../../../scripts/guardian/control-server.mjs'
import {
  guardianControlEndpoint,
  readRuntimeStatus,
  requestRuntimeControl,
  stopRuntimeServer,
} from './server-control.mjs'

const temporaryPaths = []
const PRIOR_RAILWAY_INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const CURRENT_RAILWAY_INSTANCE_ID = '22222222-2222-4222-8222-222222222222'

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice Guardian control protocol', () => {
  it('shares one endpoint and returns a sanitized CLI Server status', async () => {
    const home = await makeTempDir()
    const runtime = runtimeStatus(home)
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => runtime,
      onStop: vi.fn(),
    })
    try {
      expect(server.endpoint).toBe(guardianControlEndpoint(home))
      if (process.platform !== 'win32') {
        expect((await stat(server.endpoint)).mode & 0o777).toBe(0o600)
      }
      const status = await readRuntimeStatus({ homeRoot: home })
      expect(status).toEqual(expect.objectContaining({
        protocol: 1,
        class: 'running',
        state: 'running',
        home,
        owner: expect.objectContaining({ surface: 'cli-server', pid: process.pid }),
        capabilities: ['runtime.stop'],
      }))
      expect(JSON.stringify(status)).not.toContain('secret-lock-token')
    } finally {
      await server.close()
    }
    if (process.platform !== 'win32') await expect(stat(server.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('asks a matching Server to stop and waits until its endpoint disappears', async () => {
    const home = await makeTempDir()
    let state = 'running'
    let server
    const onStop = vi.fn(() => {
      state = 'stopping'
      setTimeout(() => { void server.close() }, 5)
    })
    server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => runtimeStatus(home, { state }),
      onStop,
    })

    const result = await stopRuntimeServer({ homeRoot: home, waitMs: 2_000 })
    expect(result.stopped).toBe(true)
    expect(result.status.class).toBe('absent')
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('uses a private hashed fallback when the home socket path is too long', async () => {
    if (process.platform === 'win32') return
    const root = await makeTempDir()
    const home = join(root, 'nested-home-with-a-long-name'.repeat(8))
    await mkdir(home, { recursive: true })
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => runtimeStatus(home),
      onStop: vi.fn(),
    })
    try {
      expect(server.endpoint.startsWith(home)).toBe(false)
      expect(server.endpoint).toBe(guardianControlEndpoint(home))
      expect((await stat(dirname(server.endpoint))).mode & 0o777).toBe(0o700)
      expect((await readRuntimeStatus({ homeRoot: home })).class).toBe('running')
    } finally {
      await server.close()
    }
  })

  it('recognizes another launcher but refuses to stop it', async () => {
    const home = await makeTempDir()
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: false,
      getStatus: () => runtimeStatus(home, {
        surface: 'cli',
        capabilities: [],
      }),
      onStop: vi.fn(),
    })
    try {
      const status = await readRuntimeStatus({ homeRoot: home })
      expect(status.class).toBe('owned_elsewhere')
      await expect(stopRuntimeServer({ homeRoot: home, waitMs: 100 })).rejects.toThrow('refusing server stop')
      await expect(requestRuntimeControl(home, 'runtime.stop')).rejects.toMatchObject({ code: 'stop_not_supported' })
    } finally {
      await server.close()
    }
  })

  it('normalizes a legacy protocol-1 Server for the new client', async () => {
    const home = await makeTempDir()
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => ({
        protocol: 1,
        runtimeVersion: '0.1.0-legacy',
        state: 'running',
        owner: {
          surface: 'cli-server',
          pid: process.pid,
          instanceId: 'legacy-instance',
          startedAt: '2026-07-15T00:00:00.000Z',
          launchRoot: '/tmp/OpenAlice',
        },
        endpoints: { web: 'http://127.0.0.1:47331' },
        components: { alice: 'ready' },
        capabilities: ['runtime.stop'],
      }),
      onStop: vi.fn(),
    })
    try {
      const status = await readRuntimeStatus({ homeRoot: home })
      expect(status).toEqual(expect.objectContaining({
        class: 'running',
        productVersion: '0.1.0-legacy',
        control: {
          apiVersion: 1,
          minClientApiVersion: 1,
          capabilities: [],
        },
        provider: { kind: 'source', root: '/tmp/OpenAlice' },
        pendingActivation: null,
      }))
    } finally {
      await server.close()
    }
  })

  it('keeps the additive new Server response readable by a legacy protocol-1 client', async () => {
    const home = await makeTempDir()
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => runtimeStatus(home),
      onStop: vi.fn(),
    })
    try {
      const result = await legacyStatusRequest(server.endpoint)
      expect(result.protocol).toBe(1)
      expect(result.runtimeVersion).toBe('0.2.0-test')
      expect(result.owner.surface).toBe('cli-server')
      expect(result.control.capabilities).toContain('runtime.status')
    } finally {
      await server.close()
    }
  })

  it('reports an incompatible additive control API without exposing Runtime detail', async () => {
    const home = await makeTempDir()
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: true,
      getStatus: () => runtimeStatus(home, {
        control: { apiVersion: 3, minClientApiVersion: 2, capabilities: ['runtime.status'] },
      }),
      onStop: vi.fn(),
    })
    try {
      const status = await readRuntimeStatus({ homeRoot: home })
      expect(status.class).toBe('incompatible')
      expect(status.detail).toContain('API 2-3')
      expect(JSON.stringify(status)).not.toContain('secret-lock-token')
    } finally {
      await server.close()
    }
  })

  it('uses Guardian owner evidence when no control endpoint is available', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: process.pid,
      hostname: 'fixture-host',
      launcher: 'guardian-electron',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      token: 'do-not-expose',
    }))

    const active = await readRuntimeStatus({ homeRoot: home }, {
      hostname: 'fixture-host',
      isProcessAlive: () => true,
    })
    expect(active).toEqual(expect.objectContaining({
      class: 'owned_elsewhere',
      owner: expect.objectContaining({ surface: 'electron', pid: process.pid }),
    }))
    expect(JSON.stringify(active)).not.toContain('do-not-expose')

    const stale = await readRuntimeStatus({ homeRoot: home }, {
      hostname: 'fixture-host',
      isProcessAlive: () => false,
    })
    expect(stale.class).toBe('absent')
    expect(stale.detail).toContain('stale')

    const legacyPidProbe = vi.fn(() => false)
    const legacyForeignHost = await readRuntimeStatus({ homeRoot: home }, {
      hostname: 'another-fixture-host',
      isProcessAlive: legacyPidProbe,
    })
    expect(legacyForeignHost.class).toBe('owned_elsewhere')
    expect(legacyPidProbe).not.toHaveBeenCalled()
  })

  it('does not report a claim-only Runtime lock as absent', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(join(lock, 'reclaiming'), { recursive: true })

    const status = await readRuntimeStatus({ homeRoot: home })

    expect(status.class).toBe('owned_elsewhere')
    expect(status.owner).toBeNull()
    expect(status.detail).toContain('ownership is active')
  })

  it('reclaims a dead same-machine owner after its hostname changes', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'old-container-host',
      machineId: 'env:railway-service-service-test',
      launcher: 'guardian-cli-server',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      processStartedAt: '2026-07-15T00:00:00.000Z',
    }))
    const isProcessAlive = vi.fn(() => false)
    const readProcessStartedAt = vi.fn(async () => Date.parse('2026-07-15T00:00:00.000Z'))

    const status = await readRuntimeStatus({ homeRoot: home }, {
      env: { OPENALICE_MACHINE_ID: 'railway-service-service-test' },
      hostname: 'new-container-host',
      isProcessAlive,
      readProcessStartedAt,
    })

    expect(status.class).toBe('absent')
    expect(status.detail).toContain('stale')
    expect(isProcessAlive).toHaveBeenCalledWith(4242)
    expect(readProcessStartedAt).not.toHaveBeenCalled()
  })

  it('uses the Railway instance identity even when hostname, PID, and start time are reused', async () => {
    const env = {
      OPENALICE_RAILWAY_INSTANCE_ID: CURRENT_RAILWAY_INSTANCE_ID,
      OPENALICE_SERVICE_MANAGER: 'railway',
      OPENALICE_MACHINE_ID: 'railway-service-service-test',
      RAILWAY_ENVIRONMENT_ID: 'environment-test',
      RAILWAY_SERVICE_ID: 'service-test',
    }
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    const ownerPath = join(lock, 'owner.json')
    const owner = {
      pid: 4242,
      hostname: 'current-container',
      machineId: 'env:railway-service-service-test',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      fencingProtocol: 'railway-flock-v1',
      fencingInstanceId: PRIOR_RAILWAY_INSTANCE_ID,
      processStartedAt: '2026-07-15T00:00:00.000Z',
    }
    await writeFile(ownerPath, JSON.stringify(owner))
    const isProcessAlive = vi.fn(() => true)
    const readProcessStartedAt = vi.fn(async () => Date.parse('2026-07-15T00:00:00.000Z'))

    for (const heartbeatAt of [new Date().toISOString(), new Date(0).toISOString()]) {
      await writeFile(ownerPath, JSON.stringify({ ...owner, heartbeatAt }))
      const observer = await readRuntimeStatus({ homeRoot: home }, {
        env,
        hostname: 'current-container',
        isProcessAlive,
        readProcessStartedAt,
      })
      expect(observer.class).toBe('owned_elsewhere')

      const fenced = await readRuntimeStatus({ homeRoot: home }, {
        env,
        hostname: 'current-container',
        isProcessAlive,
        readProcessStartedAt,
        railwayFenceValid: true,
      })
      expect(fenced.class).toBe('absent')
      expect(fenced.detail).toContain('stale')
    }
    expect(isProcessAlive).not.toHaveBeenCalled()
    expect(readProcessStartedAt).not.toHaveBeenCalled()
  })

  it('keeps a legacy cross-container Railway owner blocked even for a fenced entrypoint', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'prior-container',
      machineId: 'env:railway-service-service-test',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date(0).toISOString(),
      heartbeatAt: new Date(0).toISOString(),
    }))
    const isProcessAlive = vi.fn(() => false)
    const status = await readRuntimeStatus({ homeRoot: home }, {
      env: {
        OPENALICE_RAILWAY_INSTANCE_ID: CURRENT_RAILWAY_INSTANCE_ID,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      hostname: 'current-container',
      isProcessAlive,
      railwayFenceValid: true,
    })

    expect(status.class).toBe('owned_elsewhere')
    expect(isProcessAlive).not.toHaveBeenCalled()
  })

  it('keeps a malformed Railway fencing instance blocked', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'current-container',
      machineId: 'env:railway-service-service-test',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date(0).toISOString(),
      heartbeatAt: new Date(0).toISOString(),
      fencingProtocol: 'railway-flock-v1',
      fencingInstanceId: 'not valid',
    }))

    const status = await readRuntimeStatus({ homeRoot: home }, {
      env: {
        OPENALICE_RAILWAY_INSTANCE_ID: CURRENT_RAILWAY_INSTANCE_ID,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      hostname: 'current-container',
      isProcessAlive: vi.fn(() => false),
      railwayFenceValid: true,
    })

    expect(status.class).toBe('owned_elsewhere')
  })

  it('keeps same-container PID identity authoritative under Railway', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'current-container',
      machineId: 'env:railway-service-service-test',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date(0).toISOString(),
      heartbeatAt: new Date(0).toISOString(),
      fencingProtocol: 'railway-flock-v1',
      fencingInstanceId: CURRENT_RAILWAY_INSTANCE_ID,
      processStartedAt: '2026-07-15T00:00:00.000Z',
    }))
    const isProcessAlive = vi.fn(() => true)
    const readProcessStartedAt = vi.fn(async () => Date.parse('2026-07-15T00:00:00.000Z'))

    const status = await readRuntimeStatus({ homeRoot: home }, {
      env: {
        OPENALICE_RAILWAY_INSTANCE_ID: CURRENT_RAILWAY_INSTANCE_ID,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      hostname: 'current-container',
      isProcessAlive,
      readProcessStartedAt,
    })

    expect(status.class).toBe('owned_elsewhere')
    expect(isProcessAlive).toHaveBeenCalledWith(4242)
    expect(readProcessStartedAt).toHaveBeenCalledWith(4242)
  })

  it('keeps missing or foreign Railway owner identity fail closed', async () => {
    const env = {
      OPENALICE_SERVICE_MANAGER: 'railway',
      OPENALICE_MACHINE_ID: 'railway-service-service-test',
      RAILWAY_ENVIRONMENT_ID: 'environment-test',
      RAILWAY_SERVICE_ID: 'service-test',
    }
    for (const [index, machineId] of [undefined, 'env:railway-service-other'].entries()) {
      const home = await makeTempDir()
      const lock = join(home, 'state', 'guardian.lock')
      await mkdir(lock, { recursive: true })
      await writeFile(join(lock, 'owner.json'), JSON.stringify({
        pid: 4242,
        hostname: `foreign-container-${index}`,
        ...(machineId ? { machineId } : {}),
        launcher: 'guardian-cli-server',
        acquiredAt: new Date(0).toISOString(),
        heartbeatAt: new Date(0).toISOString(),
      }))
      const isProcessAlive = vi.fn(() => false)

      const status = await readRuntimeStatus({ homeRoot: home }, {
        env,
        hostname: 'current-container',
        isProcessAlive,
      })
      expect(status.class).toBe('owned_elsewhere')
      expect(isProcessAlive).not.toHaveBeenCalled()
    }
  })

  it('keeps missing or invalid Railway heartbeats fail closed', async () => {
    const env = {
      OPENALICE_SERVICE_MANAGER: 'railway',
      OPENALICE_MACHINE_ID: 'railway-service-service-test',
      RAILWAY_ENVIRONMENT_ID: 'environment-test',
      RAILWAY_SERVICE_ID: 'service-test',
    }
    for (const [index, heartbeatAt] of [undefined, 'not-a-date', 0].entries()) {
      const home = await makeTempDir()
      const lock = join(home, 'state', 'guardian.lock')
      await mkdir(lock, { recursive: true })
      await writeFile(join(lock, 'owner.json'), JSON.stringify({
        pid: 4242,
        hostname: `prior-container-${index}`,
        machineId: 'env:railway-service-service-test',
        launcher: 'guardian-cli-server',
        acquiredAt: new Date(0).toISOString(),
        fencingProtocol: 'railway-flock-v1',
        ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
      }))
      const isProcessAlive = vi.fn(() => false)

      const status = await readRuntimeStatus({ homeRoot: home }, {
        env,
        hostname: 'current-container',
        isProcessAlive,
      })
      expect(status.class).toBe('owned_elsewhere')
      expect(isProcessAlive).not.toHaveBeenCalled()
    }
  })

  it('keeps the same process active but treats a reused PID as stale', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'fixture-host',
      machineId: 'env:fixture-machine',
      launcher: 'guardian-cli-server',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      processStartedAt: '2026-07-15T00:00:00.000Z',
    }))
    const readProcessStartedAt = vi.fn()
      .mockResolvedValueOnce(Date.parse('2026-07-15T00:00:01.000Z'))
      .mockResolvedValueOnce(Date.parse('2026-07-15T00:00:10.000Z'))

    const dependencies = {
      hostname: 'fixture-host',
      isProcessAlive: () => true,
      readMachineId: async () => 'env:fixture-machine',
      readProcessStartedAt,
    }

    const sameProcess = await readRuntimeStatus({ homeRoot: home }, dependencies)
    expect(sameProcess.class).toBe('owned_elsewhere')

    const reusedPid = await readRuntimeStatus({ homeRoot: home }, dependencies)

    expect(reusedPid.class).toBe('absent')
    expect(reusedPid.detail).toContain('stale')
    expect(readProcessStartedAt).toHaveBeenCalledTimes(2)
    expect(readProcessStartedAt).toHaveBeenNthCalledWith(1, 4242)
    expect(readProcessStartedAt).toHaveBeenNthCalledWith(2, 4242)
  })

  it('keeps a foreign-machine owner active without probing its PID', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'guardian.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: 4242,
      hostname: 'same-hostname-is-not-authoritative',
      machineId: 'env:foreign-machine',
      launcher: 'guardian-cli-server',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      processStartedAt: '2026-07-15T00:00:00.000Z',
    }))
    const isProcessAlive = vi.fn(() => false)
    const readProcessStartedAt = vi.fn(async () => null)

    const status = await readRuntimeStatus({ homeRoot: home }, {
      hostname: 'same-hostname-is-not-authoritative',
      isProcessAlive,
      readMachineId: async () => 'env:local-machine',
      readProcessStartedAt,
    })

    expect(status).toEqual(expect.objectContaining({
      class: 'owned_elsewhere',
      owner: expect.objectContaining({ surface: 'cli-server', pid: 4242 }),
    }))
    expect(isProcessAlive).not.toHaveBeenCalled()
    expect(readProcessStartedAt).not.toHaveBeenCalled()
  })

  it('keeps shutdown non-absent while an Alice runtime lock is still active', async () => {
    const home = await makeTempDir()
    const lock = join(home, 'state', 'runtime.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'owner.json'), JSON.stringify({
      pid: process.pid,
      hostname: 'fixture-host',
      launcher: 'cli-server',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      token: 'do-not-expose',
    }))

    const status = await readRuntimeStatus({ homeRoot: home }, {
      hostname: 'fixture-host',
      isProcessAlive: () => true,
    })

    expect(status).toEqual(expect.objectContaining({
      class: 'owned_elsewhere',
      state: 'running',
      owner: expect.objectContaining({
        surface: 'cli-server',
        pid: process.pid,
      }),
    }))
    expect(JSON.stringify(status)).not.toContain('do-not-expose')
  })
})

function runtimeStatus(home, overrides = {}) {
  return {
    protocol: 1,
    control: overrides.control ?? {
      apiVersion: 1,
      minClientApiVersion: 1,
      capabilities: ['runtime.status', 'runtime.stop'],
    },
    productVersion: '0.2.0-test',
    runtimeVersion: '0.2.0-test',
    state: overrides.state ?? 'running',
    home,
    owner: {
      surface: overrides.surface ?? 'cli-server',
      pid: process.pid,
      instanceId: 'instance-test',
      startedAt: '2026-07-15T00:00:00.000Z',
      launchRoot: '/tmp/OpenAlice',
      secret: 'secret-lock-token',
    },
    endpoints: { web: 'http://127.0.0.1:47331', private: 'http://127.0.0.1:47332' },
    provider: { kind: 'source', root: '/tmp/OpenAlice', contentIdentity: 'fixture-content' },
    pendingActivation: null,
    uptimeSeconds: 42,
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled', secret: 'hidden' },
    componentDetail: {
      alice: { state: 'ready', pid: process.pid, required: true },
      uta: { state: 'disabled', required: false },
      secret: { state: 'hidden', detail: 'secret-lock-token' },
    },
    capabilities: overrides.capabilities ?? ['runtime.stop'],
  }
}

function legacyStatusRequest(endpoint) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(endpoint)
    let body = ''
    socket.setEncoding('utf8')
    socket.once('error', rejectPromise)
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        protocol: 1,
        id: 'legacy-client',
        method: 'runtime.status',
        params: {},
      })}\n`)
    })
    socket.on('data', (chunk) => {
      body += chunk
      const newline = body.indexOf('\n')
      if (newline < 0) return
      socket.destroy()
      try {
        const response = JSON.parse(body.slice(0, newline))
        if (response.ok !== true) rejectPromise(new Error(response.error?.message ?? 'legacy request failed'))
        else resolvePromise(response.result)
      } catch (error) {
        rejectPromise(error)
      }
    })
  })
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-server-control-test-'))
  temporaryPaths.push(path)
  return path
}
