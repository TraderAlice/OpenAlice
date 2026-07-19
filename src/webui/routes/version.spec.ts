import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersionInfo: vi.fn(async (options?: { force?: boolean }) => ({
    current: '0.82.0-beta',
    latest: '0.83.0-beta',
    hasUpdate: true,
    releaseUrl: 'https://example.test/v0.83.0-beta',
    releaseNotes: null,
    publishedAt: null,
    error: null,
    options,
  })),
}))

vi.mock('../../core/version.js', () => ({
  getVersionInfo: mocks.getVersionInfo,
}))

import { createVersionRoutes } from './version.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('version routes', () => {
  it('keeps the passive version read cacheable', async () => {
    const response = await createVersionRoutes().request('/')

    expect(response.status).toBe(200)
    expect(mocks.getVersionInfo).toHaveBeenCalledWith()
  })

  it('forces a fresh release lookup for a manual update check', async () => {
    const response = await createVersionRoutes().request('/check', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(mocks.getVersionInfo).toHaveBeenCalledWith({ force: true })
  })
})
