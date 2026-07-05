import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions } from './update-check.js'

describe('compareVersions', () => {
  it('orders by core version', () => {
    expect(compareVersions('0.42.0', '0.41.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.41.0', '0.41.1')).toBeLessThan(0)
    expect(compareVersions('0.41.0', '0.41.0')).toBe(0)
  })

  it('treats a release as newer than a prerelease at the same core', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
  })

  it('orders prereleases lexicographically', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-rc')).toBeLessThan(0)
  })

  it('tolerates malformed segments', () => {
    expect(compareVersions('0.42', '0.41.0')).toBeGreaterThan(0)
    expect(compareVersions('garbage', '0.0.0')).toBe(0)
  })
})

describe('checkForUpdate', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (impl: () => Promise<unknown>) =>
    vi.stubGlobal('fetch', vi.fn(impl as () => Promise<Response>))

  it('returns update info when the latest release is newer', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => [
        { tag_name: 'v0.42.0', html_url: 'https://example.test/releases/v0.42.0', draft: false },
      ],
    }))
    const update = await checkForUpdate('0.41.0')
    expect(update).toEqual({ version: '0.42.0', url: 'https://example.test/releases/v0.42.0' })
  })

  it('includes prereleases (beta) — the whole point of querying the list', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => [
        { tag_name: 'v0.51.0-beta.1', html_url: 'https://example.test/beta', draft: false },
      ],
    }))
    const update = await checkForUpdate('0.50.0-beta.1')
    expect(update).toEqual({ version: '0.51.0-beta.1', url: 'https://example.test/beta' })
  })

  it('picks the highest version, not just the first in the list', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => [
        { tag_name: 'v0.51.0-beta.1', html_url: 'https://example.test/b1', draft: false },
        { tag_name: 'v0.52.0-beta.1', html_url: 'https://example.test/b2', draft: false },
        { tag_name: 'v0.50.0-beta.1', html_url: 'https://example.test/b0', draft: false },
      ],
    }))
    const update = await checkForUpdate('0.50.0-beta.1')
    expect(update?.version).toBe('0.52.0-beta.1')
  })

  it('skips draft releases', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => [
        { tag_name: 'v0.99.0', html_url: 'https://example.test/draft', draft: true },
        { tag_name: 'v0.51.0-beta.1', html_url: 'https://example.test/real', draft: false },
      ],
    }))
    const update = await checkForUpdate('0.50.0-beta.1')
    expect(update?.version).toBe('0.51.0-beta.1')
  })

  it('returns null when already on the latest', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => [{ tag_name: 'v0.41.0', html_url: 'https://example.test/r', draft: false }],
    }))
    expect(await checkForUpdate('0.41.0')).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    stubFetch(async () => ({ ok: false, json: async () => [] }))
    expect(await checkForUpdate('0.41.0')).toBeNull()
  })

  it('swallows network errors', async () => {
    stubFetch(async () => {
      throw new Error('offline')
    })
    expect(await checkForUpdate('0.41.0')).toBeNull()
  })
})
