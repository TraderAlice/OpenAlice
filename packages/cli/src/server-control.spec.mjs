import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
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
})

function runtimeStatus(home, overrides = {}) {
  return {
    protocol: 1,
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
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled', secret: 'hidden' },
    capabilities: overrides.capabilities ?? ['runtime.stop'],
  }
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-server-control-test-'))
  temporaryPaths.push(path)
  return path
}
