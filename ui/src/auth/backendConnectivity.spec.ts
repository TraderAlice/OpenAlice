import { describe, expect, it, vi } from 'vitest'

import { createBackendObservedFetch } from './backendConnectivity'

describe('backend request observer', () => {
  it('asks for a core probe after an OpenAlice API network failure', async () => {
    const requestProbe = vi.fn()
    const failure = new TypeError('Failed to fetch')
    const observed = createBackendObservedFetch(
      vi.fn(async () => { throw failure }),
      requestProbe,
      'http://localhost:5173/chat',
    )

    await expect(observed('/api/issues')).rejects.toBe(failure)
    expect(requestProbe).toHaveBeenCalledTimes(1)
  })

  it('asks for classification instead of treating a route 5xx as core failure', async () => {
    const requestProbe = vi.fn()
    const response = new Response('subsystem unavailable', { status: 503 })
    const observed = createBackendObservedFetch(
      vi.fn(async () => response),
      requestProbe,
      'app://openalice/settings',
    )

    await expect(observed('/api/trading/status')).resolves.toBe(response)
    expect(requestProbe).toHaveBeenCalledTimes(1)
  })

  it('ignores auth probes, cancellations, and requests outside the OpenAlice API', async () => {
    const requestProbe = vi.fn()
    const abort = new DOMException('cancelled', 'AbortError')
    const observed = createBackendObservedFetch(
      vi.fn()
        .mockResolvedValueOnce(new Response('offline', { status: 503 }))
        .mockRejectedValueOnce(abort)
        .mockRejectedValueOnce(new TypeError('external offline')),
      requestProbe,
      'http://localhost:5173/chat',
    )

    await observed('/api/auth/status')
    await expect(observed('/api/issues')).rejects.toBe(abort)
    await expect(observed('https://example.com/data')).rejects.toThrow('external offline')
    expect(requestProbe).not.toHaveBeenCalled()
  })
})
