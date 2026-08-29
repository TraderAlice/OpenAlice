import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveInstalledLayout(moduleUrl = import.meta.url, options = {}) {
  const env = options.env ?? process.env
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
      currentPath: join(cliDir, 'current'),
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
