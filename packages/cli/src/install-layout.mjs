import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveInstalledLayout(moduleUrl = import.meta.url) {
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
  }
}
