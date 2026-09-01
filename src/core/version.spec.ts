import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  compareVersions,
  getCurrentVersion,
  fetchLatestRelease,
  getVersionInfo,
  _resetCacheForTest,
} from './version.js'

const STABLE_MANIFEST_URL = 'https://download.openalice.ai/manifest.json'
const BETA_MANIFEST_URL = 'https://download.openalice.ai/beta/manifest.json'

function releaseManifest(
  channel: 'stable' | 'beta',
  version: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channel,
    version,
    releaseNotesUrl: `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`,
    publishedAt: '2026-08-30T17:14:22.998Z',
    ...overrides,
  }
}

function installSource(
  updateChannel: 'stable' | 'beta' | 'pinned' | 'development' | 'custom',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    repository: 'TraderAlice/OpenAlice',
    cliVersion: '0.90.1',
    selector: updateChannel === 'pinned'
      ? { kind: 'version', value: 'v0.90.1' }
      : { kind: 'branch', value: updateChannel === 'development' ? 'dev' : 'master' },
    installerUrl: 'https://openalice.ai/install',
    updateChannel,
    method: 'direct',
    artifact: {
      platform: 'linux',
      arch: 'x64',
      sha256: 'a'.repeat(64),
    },
    installedAt: '2026-08-31T23:11:19Z',
    ...overrides,
  }
}

function mockJsonResponse(value: unknown, response?: { status?: number; statusText?: string }) {
  const status = response?.status ?? 200
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: response?.statusText ?? 'OK',
    json: async () => value,
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('compareVersions', () => {
  it('compares core versions numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('treats release as greater than prerelease for the same core', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })

  it('compares prerelease identifiers by semver rules', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
  })

  it('strips a leading v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.2.4', 'v1.2.3')).toBeGreaterThan(0)
  })

  it('handles missing parts as zero', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('getCurrentVersion', () => {
  it('returns a non-empty version string from package.json', () => {
    const version = getCurrentVersion()
    expect(typeof version).toBe('string')
    expect(version.length).toBeGreaterThan(0)
  })
})

describe('fetchLatestRelease (mocked manifest fetch)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    _resetCacheForTest()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reads and maps the stable channel manifest', async () => {
    const fetchMock = mockJsonResponse(releaseManifest('stable', '1.2.3'))

    const { result, error } = await fetchLatestRelease({ channel: 'stable' })

    expect(fetchMock).toHaveBeenCalledWith(
      STABLE_MANIFEST_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(error).toBeNull()
    expect(result).toEqual({
      version: '1.2.3',
      url: 'https://github.com/TraderAlice/OpenAlice/releases/tag/v1.2.3',
      body: null,
      publishedAt: '2026-08-30T17:14:22.998Z',
    })
  })

  it('reads the beta channel from its separate manifest URL', async () => {
    const fetchMock = mockJsonResponse(releaseManifest('beta', '1.3.0-beta.2'))

    const { result, error } = await fetchLatestRelease({ channel: 'beta' })

    expect(fetchMock).toHaveBeenCalledWith(
      BETA_MANIFEST_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(error).toBeNull()
    expect(result?.version).toBe('1.3.0-beta.2')
  })

  it.each([
    ['stable', 'beta', '1.2.3-beta.1'],
    ['beta', 'stable', '1.2.3'],
  ] as const)('rejects a %s request when the manifest declares %s', async (requested, declared, version) => {
    mockJsonResponse(releaseManifest(declared, version))

    const { result, error } = await fetchLatestRelease({ channel: requested })

    expect(result).toBeNull()
    expect(error).toContain(`${requested} release manifest declares channel ${declared}`)
  })

  it.each([
    ['stable', '1.2.3-beta.1'],
    ['stable', 'v1.2.3'],
    ['beta', '1.2.3'],
    ['beta', '1.2.3-rc.1'],
    ['beta', '1.2.3-beta.0'],
  ] as const)('rejects out-of-channel %s version %s', async (channel, version) => {
    mockJsonResponse(releaseManifest(channel, version))

    const { result, error } = await fetchLatestRelease({ channel })

    expect(result).toBeNull()
    expect(error).toContain(`out-of-channel version ${version}`)
  })

  it('accepts an unnumbered beta version', async () => {
    mockJsonResponse(releaseManifest('beta', '1.2.3-beta'))

    const { result, error } = await fetchLatestRelease({ channel: 'beta' })

    expect(error).toBeNull()
    expect(result?.version).toBe('1.2.3-beta')
  })

  it.each([
    ['releaseNotesUrl', 'not-a-url'],
    ['publishedAt', null],
    ['publishedAt', 'not-a-date'],
  ])('rejects an invalid %s field', async (field, value) => {
    mockJsonResponse(releaseManifest('stable', '1.2.3', { [field]: value }))

    const { result, error } = await fetchLatestRelease({ channel: 'stable' })

    expect(result).toBeNull()
    expect(error).toContain(`invalid ${field}`)
  })

  it('defaults to the channel encoded in the installed version', async () => {
    const channel = /-beta(?:\.|$)/i.test(getCurrentVersion()) ? 'beta' : 'stable'
    const version = channel === 'beta' ? '999.999.999-beta.1' : '999.999.999'
    const fetchMock = mockJsonResponse(releaseManifest(channel, version))

    const { result } = await fetchLatestRelease()

    expect(fetchMock).toHaveBeenCalledWith(
      channel === 'beta' ? BETA_MANIFEST_URL : STABLE_MANIFEST_URL,
      expect.any(Object),
    )
    expect(result?.version).toBe(version)
  })

  it('keeps stable and beta caches isolated', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => url === STABLE_MANIFEST_URL
        ? releaseManifest('stable', '1.0.0')
        : releaseManifest('beta', '1.1.0-beta.1'),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const stable = await fetchLatestRelease({ channel: 'stable' })
    const beta = await fetchLatestRelease({ channel: 'beta' })
    expect(stable.result?.version).toBe('1.0.0')
    expect(beta.result?.version).toBe('1.1.0-beta.1')

    await fetchLatestRelease({ channel: 'stable' })
    await fetchLatestRelease({ channel: 'beta' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches successful manifest responses unless forced', async () => {
    const fetchMock = mockJsonResponse(releaseManifest('stable', '1.0.0'))

    await fetchLatestRelease({ channel: 'stable' })
    await fetchLatestRelease({ channel: 'stable' })
    await fetchLatestRelease({ channel: 'stable', force: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns and caches an HTTP failure', async () => {
    const fetchMock = mockJsonResponse({}, { status: 404, statusText: 'Not Found' })

    const first = await fetchLatestRelease({ channel: 'stable' })
    const second = await fetchLatestRelease({ channel: 'stable' })

    expect(first.result).toBeNull()
    expect(first.error).toBe('OpenAlice stable manifest 404 Not Found')
    expect(second.error).toBe(first.error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns and caches manifest validation errors', async () => {
    const fetchMock = mockJsonResponse([])

    const first = await fetchLatestRelease({ channel: 'stable' })
    const second = await fetchLatestRelease({ channel: 'stable' })

    expect(first.result).toBeNull()
    expect(first.error).toContain('manifest is not an object')
    expect(second.error).toBe(first.error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles network errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    const { result, error } = await fetchLatestRelease({ channel: 'stable' })

    expect(result).toBeNull()
    expect(error).toContain('ECONNREFUSED')
  })
})

describe('getVersionInfo', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    _resetCacheForTest()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reports hasUpdate=true when latest is newer than current', async () => {
    mockJsonResponse(releaseManifest('stable', '999.999.999'))

    const info = await getVersionInfo({ channel: 'stable' })

    expect(info.latest).toBe('999.999.999')
    expect(info.hasUpdate).toBe(true)
    expect(info.releaseUrl).toContain('/releases/tag/v999.999.999')
    expect(info.releaseNotes).toBeNull()
    expect(info.publishedAt).toBe('2026-08-30T17:14:22.998Z')
    expect(info.error).toBeNull()
  })

  it('reports hasUpdate=false when latest equals current', async () => {
    const current = getCurrentVersion()
    const channel = /-beta(?:\.|$)/i.test(current) ? 'beta' : 'stable'
    mockJsonResponse(releaseManifest(channel, current))

    const info = await getVersionInfo()

    expect(info.latest).toBe(current)
    expect(info.hasUpdate).toBe(false)
    expect(info.error).toBeNull()
  })

  it('surfaces a manifest fetch failure without claiming an update', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch

    const info = await getVersionInfo({ channel: 'stable' })

    expect(info.latest).toBeNull()
    expect(info.hasUpdate).toBe(false)
    expect(info.error).toContain('boom')
  })

  it('keeps Railway release selection service-owned and does not fetch a manifest', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const info = await getVersionInfo({
      env: {
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_INSTALL_SOURCE: '/runtime/install-source.json',
      },
      readTextFile: () => JSON.stringify(installSource('development')),
    })

    expect(info).toMatchObject({
      channel: 'dev',
      updateAuthority: 'service',
      latest: null,
      hasUpdate: false,
      error: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps Docker release selection service-owned through the legacy launcher env', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const info = await getVersionInfo({
      env: { OPENALICE_LAUNCHER: 'docker' },
    })

    expect(info).toMatchObject({
      updateAuthority: 'service',
      latest: null,
      hasUpdate: false,
      error: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes legacy non-master branch provenance to the development channel', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const info = await getVersionInfo({
      env: { OPENALICE_INSTALL_SOURCE: '/runtime/install-source.json' },
      readTextFile: () => JSON.stringify({
        ...installSource('development'),
        schemaVersion: 1,
        selector: { kind: 'branch', value: 'feature/runtime' },
        updateChannel: undefined,
      }),
    })

    expect(info).toMatchObject({
      channel: 'dev',
      updateAuthority: 'cli',
      latest: null,
      hasUpdate: false,
      error: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['development', 'dev', 'cli'],
    ['pinned', 'pinned', 'none'],
    ['custom', 'custom', 'none'],
  ] as const)('does not duplicate %s update discovery in the web service', async (installed, channel, authority) => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const info = await getVersionInfo({
      env: { OPENALICE_INSTALL_SOURCE: '/runtime/install-source.json' },
      readTextFile: () => JSON.stringify(installSource(installed)),
    })

    expect(info).toMatchObject({
      channel,
      updateAuthority: authority,
      latest: null,
      hasUpdate: false,
      error: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses installed beta provenance instead of inferring stable from the package version', async () => {
    const fetchMock = mockJsonResponse(releaseManifest('beta', '999.999.999-beta.1'))

    const info = await getVersionInfo({
      env: { OPENALICE_INSTALL_SOURCE: '/runtime/install-source.json' },
      readTextFile: () => JSON.stringify(installSource('beta')),
    })

    expect(fetchMock).toHaveBeenCalledWith(BETA_MANIFEST_URL, expect.any(Object))
    expect(info).toMatchObject({
      channel: 'beta',
      updateAuthority: 'cli',
      latest: '999.999.999-beta.1',
      hasUpdate: true,
      error: null,
    })
  })

  it('fails closed when installed provenance is malformed', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const info = await getVersionInfo({
      env: { OPENALICE_INSTALL_SOURCE: '/runtime/install-source.json' },
      readTextFile: () => JSON.stringify({
        ...installSource('stable'),
        selector: null,
      }),
    })

    expect(info).toMatchObject({
      channel: 'custom',
      updateAuthority: 'none',
      latest: null,
      hasUpdate: false,
      error: 'Installed OpenAlice update metadata is invalid',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
