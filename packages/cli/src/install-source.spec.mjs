import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      cliVersion: '0.89.0-beta',
      selector: { kind: 'version', value: 'v0.89.0-beta' },
      installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/v0.89.0-beta/install',
      updateChannel: 'stable',
    }
    const explicitPin = { ...stableRelease, updateChannel: 'pinned' }

    expect(installSourceUpdateChannel(stableRelease)).toBe('stable')
    expect(installSourcesMatch(stableRelease, explicitPin)).toBe(false)
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
  })
})
