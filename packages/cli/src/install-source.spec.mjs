import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_INSTALL_SOURCE,
  installedContentIdentity,
  installSourcesMatch,
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
      selector: { kind: 'branch', value: 'master' },
      installerUrl: 'https://openalice.ai/install',
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
