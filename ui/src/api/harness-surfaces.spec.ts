import { afterEach, describe, expect, it, vi } from 'vitest'

import { harnessSurfaceUrl, type HarnessSurfaceResponse } from './harness-surfaces.js'

afterEach(() => vi.unstubAllEnvs())

describe('harnessSurfaceUrl', () => {
  it('routes a Studio surface through the selected dev relay instead of its backend gateway', () => {
    vi.stubEnv('VITE_OPENALICE_DEV_RELAY', '1')
    vi.stubEnv('VITE_OPENALICE_DEV_BACKEND_PORT', '0')
    const response = {
      surface: {
        workspaceId: 'aq', capability: 'studio', phase: 'ready', generation: 1,
        routeHost: 'oa-surface-aabbccddeeff001122334455.localhost', logs: '',
      },
      gatewayPort: 47331,
    } satisfies HarnessSurfaceResponse
    expect(harnessSurfaceUrl(response)).toBe(`http://${response.surface.routeHost}${window.location.port ? `:${window.location.port}` : ''}/`)
  })
})
