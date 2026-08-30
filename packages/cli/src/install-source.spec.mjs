import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_INSTALL_SOURCE,
  installedContentIdentity,
  installSourceUpdateChannel,
  installSourcesMatch,
  parseInstallSource,
  readInstallSource,
} from './install-source.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice install source', () => {
  it('uses the public master installer when no installed metadata exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-install-source-'))
    temporaryPaths.push(root)
    await expect(readInstallSource({ metadataUrl: join(root, 'missing.json') }))
      .resolves.toEqual(DEFAULT_INSTALL_SOURCE)
    expect(DEFAULT_INSTALL_SOURCE).toMatchObject({
      schemaVersion: 2,
      selector: { kind: 'branch', value: 'master' },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'stable',
    })
  })

  it('rejects malformed installed metadata instead of silently changing channels', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-install-source-invalid-'))
    temporaryPaths.push(root)
    const metadataPath = join(root, 'install-source.json')
    await writeFile(metadataPath, '{"selector":{"kind":"branch","value":"dev"}}\n')
    await expect(readInstallSource({ metadataUrl: metadataPath })).rejects.toThrow('install-source metadata is invalid')
  })

  it('compares the complete installer source, including selector and URL', () => {
    const dev = {
      ...DEFAULT_INSTALL_SOURCE,
      selector: { kind: 'branch', value: 'dev' },
      installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install',
    }
    expect(installSourcesMatch(DEFAULT_INSTALL_SOURCE, { ...DEFAULT_INSTALL_SOURCE })).toBe(true)
    expect(installSourcesMatch(DEFAULT_INSTALL_SOURCE, dev)).toBe(false)
  })

  it('reads legacy metadata without changing its inferred channel', () => {
    const legacyStable = {
      schemaVersion: 1,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.88.0-beta',
      selector: { kind: 'branch', value: 'master' },
      installerUrl: 'https://openalice.ai/install',
    }
    const legacyPinned = {
      ...legacyStable,
      selector: { kind: 'version', value: 'v0.88.0-beta' },
      installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/v0.88.0-beta/install',
    }

    expect(parseInstallSource(legacyStable)).toEqual(legacyStable)
    expect(installSourceUpdateChannel(legacyStable)).toBe('stable')
    expect(installSourceUpdateChannel(legacyPinned)).toBe('pinned')
  })

  it('keeps an immutable release ref distinct from its stable update policy', () => {
    const stableRelease = {
      schemaVersion: 2,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.90.1',
      selector: { kind: 'version', value: 'v0.90.1' },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'stable',
    }
    const explicitPin = { ...stableRelease, updateChannel: 'pinned' }

    expect(installSourceUpdateChannel(stableRelease)).toBe('stable')
    expect(installSourcesMatch(stableRelease, explicitPin)).toBe(false)
  })

  it('recognizes beta as an explicit update channel', () => {
    const betaRelease = {
      schemaVersion: 2,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.90.2-beta.1',
      selector: { kind: 'version', value: 'v0.90.2-beta.1' },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'beta',
    }

    expect(parseInstallSource(betaRelease)).toEqual(betaRelease)
    expect(installSourceUpdateChannel(betaRelease)).toBe('beta')
  })

  it('accepts complete native install provenance and rejects incomplete schema 3 metadata', () => {
    const native = {
      schemaVersion: 3,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.91.0',
      selector: { kind: 'version', value: 'v0.91.0' },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'stable',
      method: 'direct',
      artifact: {
        platform: 'darwin',
        arch: 'arm64',
        sha256: 'a'.repeat(64),
      },
      installedAt: '2026-08-29T00:00:00Z',
    }
    expect(parseInstallSource(native)).toEqual(native)
    expect(parseInstallSource({ ...native, artifact: undefined })).toBeNull()
    expect(parseInstallSource({ ...native, method: 'mystery' })).toBeNull()
  })

  it('discovers package-manager provenance beside a standalone executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-package-source-'))
    temporaryPaths.push(root)
    await writeFile(join(root, 'install-source.json'), JSON.stringify({
      schemaVersion: 3,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.91.0',
      selector: { kind: 'version', value: 'v0.91.0' },
      installerUrl: 'https://www.npmjs.com/package/openalice',
      updateChannel: 'stable',
      method: 'npm',
      artifact: { platform: 'darwin', arch: 'arm64', sha256: 'a'.repeat(64) },
      installedAt: '2026-08-30T00:00:00Z',
    }))

    await expect(readInstallSource({
      bunStandalone: true,
      executable: join(root, 'bin', 'openalice'),
      env: {},
    })).resolves.toMatchObject({ method: 'npm', cliVersion: '0.91.0' })
  })

  it('discovers system-manager provenance in the linked resource root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-system-source-'))
    temporaryPaths.push(root)
    const resourceRoot = join(root, 'share', 'openalice')
    await mkdir(resourceRoot, { recursive: true })
    await writeFile(join(resourceRoot, 'install-source.json'), JSON.stringify({
      schemaVersion: 3,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: '0.91.0',
      selector: { kind: 'version', value: 'v0.91.0' },
      installerUrl: 'https://github.com/TraderAlice/homebrew-tap',
      updateChannel: 'stable',
      method: 'brew',
      artifact: { platform: 'darwin', arch: 'arm64', sha256: 'b'.repeat(64) },
      installedAt: '2026-08-30T00:00:00Z',
    }))

    await expect(readInstallSource({
      bunStandalone: true,
      executable: join(root, 'bin', 'openalice'),
      env: { OPENALICE_APP_HOME: resourceRoot },
    })).resolves.toMatchObject({ method: 'brew', cliVersion: '0.91.0' })
  })

  it('derives installed content identity only from an immutable release directory', () => {
    const installedModuleUrl = pathToFileURL(join(
      tmpdir(),
      '.openalice',
      'cli-versions',
      'master-0123456789abcdef',
      'src',
      'install-source.mjs',
    ))
    const sourceModuleUrl = pathToFileURL(join(
      tmpdir(),
      'OpenAlice',
      'packages',
      'cli',
      'src',
      'install-source.mjs',
    ))
    expect(installedContentIdentity(installedModuleUrl))
      .toBe('0123456789abcdef')
    expect(installedContentIdentity(sourceModuleUrl)).toBeNull()
    expect(installedContentIdentity(sourceModuleUrl, {
      env: { OPENALICE_CONTENT_IDENTITY: 'fedcba9876543210' },
    })).toBe('fedcba9876543210')
    expect(installedContentIdentity(sourceModuleUrl, {
      bunStandalone: true,
      executable: '/usr/bin/openalice',
      env: {},
      readFileSync: (path) => {
        if (path === resolve('/usr/share/openalice/release.json')) {
          return JSON.stringify({ contentIdentity: 'aaaaaaaaaaaaaaaa' })
        }
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      },
    })).toBe('aaaaaaaaaaaaaaaa')
  })
})
