import { describe, expect, it, vi } from 'vitest'

import { buildGuardianRuntimeStatus } from './runtime-status.js'

describe('Guardian runtime status envelope', () => {
  it('publishes read-only discovery for a dev owner', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T04:00:10.000Z'))
    try {
      const status = buildGuardianRuntimeStatus({
        productVersion: '0.89.2-beta',
        state: 'running',
        home: '/tmp/openalice-dev',
        owner: {
          surface: 'dev',
          pid: 42,
          instanceId: 'dev-instance',
          startedAt: '2026-08-07T04:00:00.000Z',
          launchRoot: '/src/OpenAlice',
          mode: 'foreground',
        },
        endpoints: { web: 'http://127.0.0.1:5173' },
        provider: { kind: 'source', root: '/src/OpenAlice' },
        startedAtMs: Date.parse('2026-08-07T04:00:00.000Z'),
        components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
        componentDetail: {
          alice: { state: 'ready', required: true, pid: 43 },
          uta: { state: 'disabled', required: false },
          connector: { state: 'disabled', required: false },
        },
        capabilities: [],
      })

      expect(status).toMatchObject({
        protocol: 1,
        control: {
          apiVersion: 1,
          minClientApiVersion: 1,
          capabilities: ['runtime.status'],
        },
        state: 'running',
        endpoints: { web: 'http://127.0.0.1:5173' },
        capabilities: [],
        uptimeSeconds: 10,
      })
      expect(status.control.capabilities).not.toContain('runtime.stop')
    } finally {
      vi.useRealTimers()
    }
  })

  it('advertises stop only when the owning launcher supports it', () => {
    const status = buildGuardianRuntimeStatus({
      productVersion: 'dev',
      state: 'starting',
      home: '/tmp/openalice-server',
      owner: { surface: 'cli-server', pid: 42 },
      endpoints: {},
      provider: { kind: 'source' },
      startedAtMs: Date.now(),
      components: {},
      componentDetail: {},
      capabilities: ['runtime.stop', 'runtime.stop'],
    })

    expect(status.control.capabilities).toEqual(['runtime.status', 'runtime.stop'])
    expect(status.capabilities).toEqual(['runtime.stop'])
  })
})
