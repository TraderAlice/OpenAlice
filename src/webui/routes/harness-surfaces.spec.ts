import { describe, expect, it, vi } from 'vitest'

import { createHarnessSurfaceRoutes } from './harness-surfaces.js'
import { HarnessManifestError, type HarnessSurfaceManager } from '../../workspaces/harness-surface-manager.js'

function surface(phase: 'stopped' | 'starting' | 'ready' = 'stopped') {
  return {
    workspaceId: 'ws-1',
    capability: 'studio',
    phase,
    generation: phase === 'stopped' ? 0 : 1,
    ...(phase === 'ready' ? { routeHost: 'oa-surface-aabbccddeeff001122334455.localhost' } : {}),
    logs: '',
  } as const
}

describe('createHarnessSurfaceRoutes', () => {
  it('returns the Electron gateway only for a ready routed surface', async () => {
    const manager = {
      snapshot: vi.fn(() => surface('ready')),
    } as unknown as HarnessSurfaceManager
    const app = createHarnessSurfaceRoutes(manager, { getGatewayPort: () => 49123 })

    const response = await app.request('/ws-1/studio')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      gatewayPort: 49123,
      surface: { phase: 'ready', generation: 1 },
    })
  })

  it('validates identifiers before invoking the manager', async () => {
    const start = vi.fn()
    const manager = { start } as unknown as HarnessSurfaceManager
    const app = createHarnessSurfaceRoutes(manager, { getGatewayPort: () => null })

    const response = await app.request('/bad.id/studio/start', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(start).not.toHaveBeenCalled()
  })

  it('maps manifest failures to a stable client response', async () => {
    const manager = {
      start: vi.fn(async () => {
        throw new HarnessManifestError('invalid_manifest', 'harness.json is invalid')
      }),
    } as unknown as HarnessSurfaceManager
    const app = createHarnessSurfaceRoutes(manager, { getGatewayPort: () => null })

    const response = await app.request('/ws-1/studio/start', { method: 'POST' })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_manifest',
      message: 'harness.json is invalid',
    })
  })
})
