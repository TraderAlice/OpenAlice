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
