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
    })
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
