import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveInstalledLayout } from './install-layout.mjs'

describe('OpenAlice installed layout', () => {
  it('derives only the installer-owned root from an immutable release path', () => {
    const installRoot = join(tmpdir(), 'openalice-layout', '.openalice')
    expect(resolveInstalledLayout(pathToFileURL(join(
      installRoot,
      'cli-versions',
      'master-0123456789abcdef',
      'src',
      'update.mjs',
    )))).toEqual({
      installRoot,
      versionsDir: join(installRoot, 'cli-versions'),
      releaseDir: join(installRoot, 'cli-versions', 'master-0123456789abcdef'),
      binDir: join(installRoot, 'bin'),
      lockDir: join(installRoot, '.cli-install.lock'),
      updateCachePath: join(installRoot, '.cli-update-check.json'),
      kind: 'legacy',
    })
  })

  it('uses launcher-owned environment to resolve a native Bun release', () => {
    const installRoot = join(tmpdir(), 'openalice-native-layout', '.openalice')
    const releaseDir = join(installRoot, 'cli', 'releases', '0.91.0-darwin-arm64-0123456789abcdef')
    expect(resolveInstalledLayout(import.meta.url, {
      env: {
        OPENALICE_INSTALL_ROOT: installRoot,
        OPENALICE_RELEASE_DIR: releaseDir,
      },
    })).toEqual({
      installRoot,
      cliDir: join(installRoot, 'cli'),
      releasesDir: join(installRoot, 'cli', 'releases'),
      versionsDir: join(installRoot, 'cli', 'releases'),
      releaseDir,
      currentPath: join(installRoot, 'cli', 'current'),
      provenanceDir: join(installRoot, 'cli', 'provenance'),
      activationPath: join(installRoot, 'cli', 'activation.json'),
      binDir: join(installRoot, 'bin'),
      lockDir: join(installRoot, '.cli-install.lock'),
      updateCachePath: join(installRoot, '.cli-update-check.json'),
      kind: 'bun',
    })
  })

  it('rejects a launcher release outside the installer-owned releases directory', () => {
    const installRoot = join(tmpdir(), 'openalice-native-layout', '.openalice')
    expect(resolveInstalledLayout(import.meta.url, {
      env: {
        OPENALICE_INSTALL_ROOT: installRoot,
        OPENALICE_RELEASE_DIR: join(installRoot, 'foreign-release'),
      },
    })).toBeNull()
  })

  it('does not treat a source checkout as an installed CLI', () => {
    expect(resolveInstalledLayout(pathToFileURL(join(
      tmpdir(),
      'OpenAlice',
      'packages',
      'cli',
      'src',
      'update.mjs',
    )))).toBeNull()
  })
})
