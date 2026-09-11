import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, realpath } from 'node:fs/promises'

export function resolveInstalledLayout(moduleUrl = import.meta.url, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const explicitRoot = env['OPENALICE_INSTALL_ROOT']?.trim()
  const explicitRelease = env['OPENALICE_RELEASE_DIR']?.trim()
  if (explicitRoot && explicitRelease) {
    const installRoot = resolve(explicitRoot)
    const cliDir = join(installRoot, 'cli')
    const releasesDir = join(cliDir, 'releases')
    const releaseDir = resolve(explicitRelease)
    if (dirname(releaseDir) !== releasesDir) return null
    return {
      installRoot,
      cliDir,
      releasesDir,
      versionsDir: releasesDir,
      releaseDir,
      currentPath: join(cliDir, platform === 'win32' ? 'current.txt' : 'current'),
      ...(platform === 'win32' ? { pointerKind: 'file', platform } : {}),
      provenanceDir: join(cliDir, 'provenance'),
      activationPath: join(cliDir, 'activation.json'),
      binDir: join(installRoot, 'bin'),
      lockDir: join(installRoot, '.cli-install.lock'),
      updateCachePath: join(installRoot, '.cli-update-check.json'),
      kind: 'bun',
    }
  }

  const modulePath = fileURLToPath(moduleUrl)
  const releaseDir = dirname(dirname(modulePath))
  const versionsDir = dirname(releaseDir)
  if (basename(versionsDir) !== 'cli-versions') return null

  const installRoot = dirname(versionsDir)
  return {
    installRoot,
    versionsDir,
    releaseDir,
    binDir: join(installRoot, 'bin'),
    lockDir: join(installRoot, '.cli-install.lock'),
    updateCachePath: join(installRoot, '.cli-update-check.json'),
    kind: 'legacy',
  }
}

export async function resolveCurrentRelease(layout, dependencies = {}) {
  const realpathImpl = dependencies.realpathImpl ?? realpath
  if (layout.pointerKind !== 'file') return realpathImpl(layout.currentPath)
  const name = (await (dependencies.readFileImpl ?? readFile)(layout.currentPath, 'utf8')).trim()
  if (!/^[A-Za-z0-9._+-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error('OpenAlice active release name is invalid')
  }
  return realpathImpl(join(layout.releasesDir, name))
}
