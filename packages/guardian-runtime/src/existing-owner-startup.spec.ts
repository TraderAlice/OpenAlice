import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startGuardianControlServer } from './control-server.js'
import { decideExistingOwnerStartup } from './existing-owner-startup.js'
import {
  classifyGuardianRuntimeStatus,
  isBrowserHandoffSurface,
  isElectronOwnerSurface,
  normalizeOwnerSurface,
  probeLoopbackAuthStatus,
  sanitizeLoopbackWebUrl,
} from './runtime-discovery.js'
import { readDiscoveredRuntimeStatus } from './runtime-control-client.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('runtime discovery sanitizer', () => {
  it('keeps only loopback HTTP Web URLs without credentials', () => {
    expect(sanitizeLoopbackWebUrl('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173')
    expect(sanitizeLoopbackWebUrl('http://localhost:5173')).toBeNull()
    expect(sanitizeLoopbackWebUrl('https://127.0.0.1:5173')).toBeNull()
    expect(sanitizeLoopbackWebUrl('http://user:pass@127.0.0.1:5173')).toBeNull()
    expect(sanitizeLoopbackWebUrl('http://192.168.1.9:5173')).toBeNull()
  })

  it('redacts secrets and drops non-loopback endpoints from classified status', () => {
    const status = classifyGuardianRuntimeStatus('/tmp/openalice-home', {
      protocol: 1,
      control: { apiVersion: 1, minClientApiVersion: 1, capabilities: ['runtime.status'] },
      productVersion: '0.89.3-beta',
      state: 'running',
      owner: {
        surface: 'dev',
        pid: 42,
        instanceId: 'dev-1',
        startedAt: '2026-08-13T00:00:00.000Z',
        secret: 'secret-lock-token',
      },
      endpoints: { web: 'http://127.0.0.1:5173', private: 'http://127.0.0.1:9' },
      components: { alice: 'ready', secret: 'hidden' },
      detail: 'token=super-secret-value',
    })

    expect(status.class).toBe('owned_elsewhere')
    expect(status.owner).toEqual(expect.objectContaining({ surface: 'dev', pid: 42 }))
    expect(status.endpoints).toEqual({ web: 'http://127.0.0.1:5173' })
    expect(JSON.stringify(status)).not.toContain('secret-lock-token')
    expect(status.detail).toContain('[REDACTED]')
  })

  it('classifies a healthy CLI Server as running and a future API as incompatible', () => {
    const running = classifyGuardianRuntimeStatus('/tmp/openalice-home', {
      state: 'running',
      owner: { surface: 'cli-server', pid: 7 },
      components: { alice: 'ready' },
      endpoints: { web: 'http://127.0.0.1:47331' },
    })
    expect(running.class).toBe('running')

    const incompatible = classifyGuardianRuntimeStatus('/tmp/openalice-home', {
      control: { apiVersion: 3, minClientApiVersion: 2, capabilities: ['runtime.status'] },
      state: 'running',
      owner: { surface: 'cli-server', pid: 7 },
      components: { alice: 'ready' },
    })
    expect(incompatible.class).toBe('incompatible')
  })

  it('normalizes Guardian lock launcher names to owner surfaces', () => {
    expect(normalizeOwnerSurface('guardian-dev')).toBe('dev')
    expect(normalizeOwnerSurface('guardian-cli-server')).toBe('cli-server')
    expect(normalizeOwnerSurface('guardian-electron-packaged')).toBe('electron-packaged')
    expect(isBrowserHandoffSurface('dev')).toBe(true)
    expect(isBrowserHandoffSurface('cli-server')).toBe(true)
    expect(isBrowserHandoffSurface('electron-dev')).toBe(false)
    expect(isElectronOwnerSurface('electron-packaged')).toBe(true)
  })
})

describe('existing-owner startup decision table', () => {
  const lock = {
    state: 'active' as const,
    heartbeatStale: false,
    owner: {
      schemaVersion: 1 as const,
      pid: 99,
      hostname: 'host',
      token: 'do-not-use',
      launcher: 'guardian-dev',
      acquiredAt: '2026-08-13T00:00:00.000Z',
      heartbeatAt: '2026-08-13T00:00:10.000Z',
    },
  }

  it('hands a healthy probed dev owner to the browser', () => {
    const decision = decideExistingOwnerStartup({
      home: '/tmp/home',
      lock,
      discovered: classifyGuardianRuntimeStatus('/tmp/home', healthyStatus('dev')),
      probeOk: true,
      canChooseAnother: true,
    })
    expect(decision).toMatchObject({
      kind: 'handoff',
      surface: 'dev',
      allowOpenBrowser: true,
      defaultAction: 'open-browser',
      url: 'http://127.0.0.1:5173',
    })
  })

  it('hands a healthy probed CLI Server owner to the browser', () => {
    const decision = decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { ...lock, owner: { ...lock.owner, launcher: 'guardian-cli-server' } },
      discovered: classifyGuardianRuntimeStatus('/tmp/home', healthyStatus('cli-server')),
      probeOk: true,
      canChooseAnother: false,
    })
    expect(decision).toMatchObject({
      kind: 'handoff',
      surface: 'cli-server',
      allowOpenBrowser: true,
      allowChooseAnother: false,
      defaultAction: 'open-browser',
    })
  })

  it('does not infer a Web port from lock metadata when discovery is missing', () => {
    const decision = decideExistingOwnerStartup({
      home: '/tmp/home',
      lock,
      discovered: null,
      probeOk: false,
      canChooseAnother: true,
    })
    expect(decision).toMatchObject({
      kind: 'conflict',
      allowOpenBrowser: false,
      defaultAction: 'keep',
    })
    expect(decision).not.toHaveProperty('url')
  })

  it('refuses browser handoff when the advertised page is not ready', () => {
    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock,
      discovered: classifyGuardianRuntimeStatus('/tmp/home', healthyStatus('dev')),
      probeOk: false,
      canChooseAnother: true,
    })).toMatchObject({
      kind: 'conflict',
      allowOpenBrowser: false,
      defaultAction: 'keep',
    })
  })

  it('keeps Electron, stale, starting, and incompatible owners on tailored recovery', () => {
    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { ...lock, owner: { ...lock.owner, launcher: 'guardian-electron-packaged' } },
      discovered: classifyGuardianRuntimeStatus('/tmp/home', healthyStatus('electron-packaged')),
      probeOk: true,
      canChooseAnother: true,
    })).toMatchObject({
      kind: 'conflict',
      surface: 'electron-packaged',
      allowOpenBrowser: false,
      defaultAction: 'keep',
    })

    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { ...lock, heartbeatStale: true },
      discovered: classifyGuardianRuntimeStatus('/tmp/home', healthyStatus('dev')),
      probeOk: true,
      canChooseAnother: true,
    })).toMatchObject({
      kind: 'conflict',
      allowOpenBrowser: false,
      defaultAction: 'takeover',
    })

    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock,
      discovered: classifyGuardianRuntimeStatus('/tmp/home', {
        ...healthyStatus('dev'),
        state: 'starting',
        components: { alice: 'starting' },
      }),
      probeOk: false,
      canChooseAnother: true,
    })).toMatchObject({
      kind: 'conflict',
      allowOpenBrowser: false,
      defaultAction: 'keep',
    })

    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock,
      discovered: classifyGuardianRuntimeStatus('/tmp/home', {
        ...healthyStatus('cli-server'),
        control: { apiVersion: 3, minClientApiVersion: 2, capabilities: ['runtime.status'] },
      }),
      probeOk: true,
      canChooseAnother: true,
    })).toMatchObject({
      kind: 'conflict',
      allowOpenBrowser: false,
      defaultAction: 'keep',
    })
  })

  it('continues when no active owner lock is present', () => {
    expect(decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { state: 'missing', owner: null, heartbeatStale: false },
      discovered: null,
      probeOk: false,
      canChooseAnother: true,
    })).toEqual({ kind: 'continue' })
  })
})

describe('discovered runtime.status client', () => {
  it('reads and classifies a live Guardian control envelope', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-discovery-'))
    temporaryPaths.push(home)
    const server = await startGuardianControlServer({
      homeRoot: home,
      allowStop: false,
      getStatus: () => healthyStatus('dev'),
      onStop: () => undefined,
    })
    try {
      const status = await readDiscoveredRuntimeStatus({ homeRoot: home })
      expect(status).toMatchObject({
        class: 'owned_elsewhere',
        owner: { surface: 'dev' },
        endpoints: { web: 'http://127.0.0.1:5173' },
      })
    } finally {
      await server.close()
    }
  })

  it('returns null when no control endpoint exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-discovery-absent-'))
    temporaryPaths.push(home)
    await expect(readDiscoveredRuntimeStatus({ homeRoot: home, timeoutMs: 200 })).resolves.toBeNull()
  })

  it('probes only sanitized loopback auth endpoints', async () => {
    expect(await probeLoopbackAuthStatus('http://example.com')).toBe(false)
    expect(await probeLoopbackAuthStatus('http://127.0.0.1:1', {
      fetchImpl: async () => new Response(JSON.stringify({ authed: false, tokenConfigured: true })),
    })).toBe(true)
  })
})

function healthyStatus(surface: string) {
  return {
    protocol: 1,
    control: { apiVersion: 1, minClientApiVersion: 1, capabilities: ['runtime.status'] },
    productVersion: '0.89.3-beta',
    state: 'running',
    owner: { surface, pid: 42, instanceId: 'fixture' },
    endpoints: { web: 'http://127.0.0.1:5173' },
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
  }
}
