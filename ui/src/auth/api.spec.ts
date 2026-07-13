import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthStatusUnavailableError, getStatus } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth status API', () => {
  it('keeps backend outages distinct from an authentication denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
    })))

    await expect(getStatus()).rejects.toMatchObject({
      name: 'AuthStatusUnavailableError',
      status: 502,
    } satisfies Partial<AuthStatusUnavailableError>)
  })

  it('returns an explicit unauthenticated decision from a healthy backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authed: false, tokenConfigured: true }),
    })))

    await expect(getStatus()).resolves.toEqual({ authed: false, tokenConfigured: true })
  })

  it('keeps an explicit 401 as an authentication denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
    })))

    await expect(getStatus()).resolves.toEqual({ authed: false, tokenConfigured: true })
  })

  it('treats network and malformed-response failures as unavailable', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ nope: true }) })
    vi.stubGlobal('fetch', fetch)

    await expect(getStatus()).rejects.toBeInstanceOf(AuthStatusUnavailableError)
    await expect(getStatus()).rejects.toBeInstanceOf(AuthStatusUnavailableError)
  })
})
