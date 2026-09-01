/**
 * trading-config routes — covers the derived-id create flow and edit-only PUT.
 *
 * Mocks `core/config.js` read/write with in-memory state so we don't touch
 * the real `data/` directory; the rest (preset catalog, deriveUtaId, route
 * wiring) is exercised for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const brokerPackMocks = vi.hoisted(() => ({
  getBrokerPackLocalStatus: vi.fn(),
  installBrokerPack: vi.fn(),
  triggerUTARestart: vi.fn(),
}))

vi.mock('../../services/broker-packs/installer.js', () => ({
  getBrokerPackLocalStatus: brokerPackMocks.getBrokerPackLocalStatus,
  installBrokerPack: brokerPackMocks.installBrokerPack,
}))

vi.mock('../../services/uta-supervisor/restart-trigger.js', () => ({
  triggerUTARestart: brokerPackMocks.triggerUTARestart,
}))

// Mock readUTAsConfig / writeUTAsConfig with in-memory store BEFORE importing the route.
let utaStore: unknown[] = []
let keylessDataSources: string[] = []
vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    readUTAsConfig: vi.fn(async () => utaStore),
    writeUTAsConfig: vi.fn(async (next: unknown[]) => { utaStore = [...next] }),
    loadConfig: vi.fn(async () => ({ trading: { keylessDataSources } })),
  }
})

import { createTradingConfigRoutes } from './trading-config.js'
import type { EngineContext } from '../../core/types.js'
import { deriveUtaId, OKX_PRESET, SIMULATOR_PRESET } from '@traderalice/uta-protocol'

// ==================== Test fixtures ====================

function makeRoutes() {
  const ctx = {
    utaManager: {
      get: vi.fn(),
      resolve: () => [],
      listUTAs: () => [],
      reconnectUTA: vi.fn(async () => ({ success: true })),
      removeUTA: vi.fn(async () => {}),
    },
  } as unknown as EngineContext
  return createTradingConfigRoutes(ctx)
}

async function req(routes: ReturnType<typeof createTradingConfigRoutes>, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await routes.request(path, init)
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body: json }
}

beforeEach(() => {
  utaStore = []
  keylessDataSources = []
  brokerPackMocks.getBrokerPackLocalStatus.mockImplementation(async (engine: string) => ({
    engine,
    installed: engine === 'mock',
    source: engine === 'mock' ? 'builtin' : 'missing',
  }))
  brokerPackMocks.installBrokerPack.mockResolvedValue({
    engine: 'ccxt', installed: true, source: 'downloaded', version: '0.80.0-beta',
  })
  brokerPackMocks.triggerUTARestart.mockResolvedValue({ triggered: true, ready: true })
  vi.clearAllMocks()
})

describe('GET /broker-packs — optional engine requirements', () => {
  it('keeps account and keyless K-line vendor requirements on the CCXT pack', async () => {
    utaStore = [
      {
        id: 'okx-main', label: 'Main OKX', presetId: 'okx', enabled: true,
        presetConfig: {}, guards: [], asVendor: false,
      },
      {
        id: 'okx-disabled', label: 'Disabled OKX', presetId: 'okx', enabled: false,
        presetConfig: {}, guards: [], asVendor: true,
      },
    ]
    keylessDataSources = ['binance']

    const { status, body } = await req(makeRoutes(), 'GET', '/broker-packs')

    expect(status).toBe(200)
    const ccxt = (body as { packs: Array<{ engine: string; requiredBy: string[] }> }).packs
      .find((pack) => pack.engine === 'ccxt')
    expect(ccxt?.requiredBy).toEqual(['Main OKX', 'binance K-line vendor'])
  })

  it('surfaces broken local status without dropping the accounts that require it', async () => {
    utaStore = [{
      id: 'okx-main', label: 'Main OKX', presetId: 'okx', enabled: true,
      presetConfig: {}, guards: [], asVendor: true,
    }]
    brokerPackMocks.getBrokerPackLocalStatus.mockImplementation(async (engine: string) => engine === 'ccxt'
      ? { engine, installed: false, source: 'broken', reason: 'API version mismatch' }
      : { engine, installed: engine === 'mock', source: engine === 'mock' ? 'builtin' : 'missing' })

    const { status, body } = await req(makeRoutes(), 'GET', '/broker-packs')

    expect(status).toBe(200)
    expect((body as { packs: unknown[] }).packs).toContainEqual(expect.objectContaining({
      engine: 'ccxt',
      installed: false,
      source: 'broken',
      reason: 'API version mismatch',
      requiredBy: ['Main OKX'],
    }))
  })

  it('keeps pack recovery UI available when a legacy account references a removed preset', async () => {
    utaStore = [{
      id: 'legacy-account', label: 'Legacy account', presetId: 'removed-preset', enabled: true,
      presetConfig: {}, guards: [], asVendor: true,
    }]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { status, body } = await req(makeRoutes(), 'GET', '/broker-packs')

    expect(status).toBe(200)
    expect((body as { packs: unknown[] }).packs).toHaveLength(7)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('legacy-account'),
      expect.stringMatching(/unknown broker preset/i),
    )
    warn.mockRestore()
  })
})

describe('POST /broker-packs/:engine/install', () => {
  it('rejects unknown engines before invoking the installer', async () => {
    const { status, body } = await req(makeRoutes(), 'POST', '/broker-packs/not-real/install')

    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Unknown broker pack: not-real' })
    expect(brokerPackMocks.installBrokerPack).not.toHaveBeenCalled()
  })

  it('installs a known engine and requests a supervised UTA restart', async () => {
    const { status, body } = await req(makeRoutes(), 'POST', '/broker-packs/ccxt/install')

    expect(status).toBe(200)
    expect(body).toMatchObject({ engine: 'ccxt', installed: true, source: 'downloaded' })
    expect(brokerPackMocks.installBrokerPack).toHaveBeenCalledWith('ccxt')
    await vi.waitFor(() => expect(brokerPackMocks.triggerUTARestart).toHaveBeenCalledOnce())
  })

  it('returns an actionable install error without restarting UTA', async () => {
    brokerPackMocks.installBrokerPack.mockRejectedValueOnce(new Error('checksum mismatch'))

    const { status, body } = await req(makeRoutes(), 'POST', '/broker-packs/ccxt/install')

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'checksum mismatch' })
    expect(brokerPackMocks.triggerUTARestart).not.toHaveBeenCalled()
  })
})

// ==================== POST /uta ====================

describe('POST /uta — derived id creation', () => {
  it('201 + derived id matching deriveUtaId(preset, presetConfig)', async () => {
    const routes = makeRoutes()
    const presetConfig = { mode: 'live', apiKey: 'k1', secret: 's1', password: 'p1' }
    const expectedId = deriveUtaId(OKX_PRESET, presetConfig)

    const { status, body } = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      label: 'My OKX',
      presetConfig,
    })
    expect(status).toBe(201)
    expect((body as { id: string }).id).toBe(expectedId)
    expect((body as { label: string }).label).toBe('My OKX')
    expect(utaStore).toHaveLength(1)
  })

  it('persists account-level capability switches from the create form', async () => {
    const routes = makeRoutes()
    const { status, body } = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
      readOnly: true,
      asVendor: false,
    })

    expect(status).toBe(201)
    expect(body).toMatchObject({ readOnly: true, asVendor: false })
    expect(utaStore[0]).toMatchObject({ readOnly: true, asVendor: false })
  })

  it('400 when presetId is missing', async () => {
    const routes = makeRoutes()
    const { status } = await req(routes, 'POST', '/uta', { presetConfig: {} })
    expect(status).toBe(400)
  })

  it('400 for unknown presetId', async () => {
    const routes = makeRoutes()
    const { status } = await req(routes, 'POST', '/uta', { presetId: 'never-existed', presetConfig: {} })
    expect(status).toBe(400)
  })

  it('409 + existing-UTA info when fingerprint collides', async () => {
    const routes = makeRoutes()
    const presetConfig = { mode: 'live', apiKey: 'shared-key', secret: 's', password: 'p' }
    const first = await req(routes, 'POST', '/uta', { presetId: 'okx', label: 'Original', presetConfig })
    expect(first.status).toBe(201)

    const second = await req(routes, 'POST', '/uta', { presetId: 'okx', label: 'Duplicate', presetConfig })
    expect(second.status).toBe(409)
    expect((second.body as { existing: { id: string; label: string } }).existing.label).toBe('Original')
  })

  it('409 also fires when only non-fingerprint fields differ (different secret, same apiKey)', async () => {
    const routes = makeRoutes()
    await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'k', secret: 'rotated-1', password: 'p' },
    })
    const second = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'k', secret: 'rotated-2', password: 'p' },
    })
    expect(second.status).toBe(409)
  })

  it('Mock preset: mints _instanceId when missing, persists it', async () => {
    const routes = makeRoutes()
    const { status, body } = await req(routes, 'POST', '/uta', {
      presetId: 'mock-simulator',
      label: 'sim',
      presetConfig: { cash: 50000 },
    })
    expect(status).toBe(201)
    const created = body as { id: string; presetConfig: Record<string, unknown> }
    expect(created.id).toMatch(/^mock-simulator-[0-9a-f]{8}$/)
    expect(created.presetConfig._instanceId).toBeTruthy()
    expect(typeof created.presetConfig._instanceId).toBe('string')
  })

  it('Mock preset: two creates without _instanceId yield different ids', async () => {
    const routes = makeRoutes()
    const a = await req(routes, 'POST', '/uta', { presetId: 'mock-simulator', presetConfig: { cash: 100 } })
    const b = await req(routes, 'POST', '/uta', { presetId: 'mock-simulator', presetConfig: { cash: 100 } })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect((a.body as { id: string }).id).not.toBe((b.body as { id: string }).id)
  })

  it('Mock preset: explicit _instanceId reused → 409 (deterministic)', async () => {
    const routes = makeRoutes()
    const presetConfig = { _instanceId: 'cafebabe', cash: 100 }
    const first = await req(routes, 'POST', '/uta', { presetId: 'mock-simulator', presetConfig })
    expect(first.status).toBe(201)
    const second = await req(routes, 'POST', '/uta', { presetId: 'mock-simulator', presetConfig })
    expect(second.status).toBe(409)
  })

  it('201 response echoes credentials MASKED; the store keeps them intact', async () => {
    const routes = makeRoutes()
    const { status, body } = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'live-api-key-1234', secret: 'live-secret-5678', password: 'p4ss' },
    })
    expect(status).toBe(201)
    const echoed = (body as { presetConfig: Record<string, string> }).presetConfig
    expect(echoed.apiKey).toBe('****1234')
    expect(echoed.secret).toBe('****5678')
    expect(echoed.password).toBe('****')
    // Persisted record keeps the real values — masking is response-only.
    const stored = (utaStore[0] as { presetConfig: Record<string, string> }).presetConfig
    expect(stored.apiKey).toBe('live-api-key-1234')
    expect(stored.secret).toBe('live-secret-5678')
  })
})

// ==================== PUT /uta/:id ====================

describe('PUT /uta/:id — edit-only', () => {
  it('422 when no UTA exists at the given id', async () => {
    const routes = makeRoutes()
    const { status, body } = await req(routes, 'PUT', '/uta/okx-deadbeef', {
      id: 'okx-deadbeef',
      presetId: 'okx',
      enabled: true,
      guards: [],
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
    })
    expect(status).toBe(422)
    expect((body as { error: string }).error).toMatch(/use POST/i)
  })

  it('200 + label updated when UTA exists', async () => {
    const routes = makeRoutes()
    // Seed via POST.
    const created = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      label: 'before',
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
    })
    const id = (created.body as { id: string }).id

    const edited = await req(routes, 'PUT', `/uta/${id}`, {
      id,
      presetId: 'okx',
      label: 'after',
      enabled: true,
      guards: [],
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
    })
    expect(edited.status).toBe(200)
    expect((edited.body as { label: string }).label).toBe('after')
  })

  it('400 when body.id !== url id', async () => {
    const routes = makeRoutes()
    const created = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
    })
    const id = (created.body as { id: string }).id

    const { status } = await req(routes, 'PUT', `/uta/${id}`, {
      id: 'something-else',
      presetId: 'okx',
      enabled: true,
      guards: [],
      presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
    })
    expect(status).toBe(400)
  })

  it('200 response echoes credentials MASKED after a rotation', async () => {
    const routes = makeRoutes()
    const created = await req(routes, 'POST', '/uta', {
      presetId: 'okx',
      presetConfig: { mode: 'live', apiKey: 'old-key-0000', secret: 'old-sec-0000', password: 'p' },
    })
    const id = (created.body as { id: string }).id

    const edited = await req(routes, 'PUT', `/uta/${id}`, {
      id,
      presetId: 'okx',
      enabled: true,
      guards: [],
      presetConfig: { mode: 'live', apiKey: 'new-key-9999', secret: 'new-sec-8888', password: 'p' },
    })
    expect(edited.status).toBe(200)
    const echoed = (edited.body as { presetConfig: Record<string, string> }).presetConfig
    expect(echoed.apiKey).toBe('****9999')
    expect(echoed.secret).toBe('****8888')
    // Rotation actually landed in the store, unmasked.
    const stored = (utaStore[0] as { presetConfig: Record<string, string> }).presetConfig
    expect(stored.apiKey).toBe('new-key-9999')
  })
})

// ==================== Mock preset_instanceId: deriveUtaId stable on Mock minted ID ====================

describe('Mock _instanceId stability', () => {
  it('same _instanceId across POSTs yields same derived id (idempotent for explicit instanceId)', () => {
    const a = deriveUtaId(SIMULATOR_PRESET, { _instanceId: 'aabbccdd', cash: 1 })
    const b = deriveUtaId(SIMULATOR_PRESET, { _instanceId: 'aabbccdd', cash: 999 })
    expect(a).toBe(b)
  })
})
