import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_DESKTOP_PACKAGE_ROOT = resolve(scriptDir, '..', 'dist', 'electron-app')
export const DESKTOP_PACKAGE_OWNER_MARKER = '.openalice-package-smoke-owner.json'

export function resolveDesktopPackageRootArg(argv, cwd = process.cwd()) {
  const args = argv[0] === '--' ? argv.slice(1) : argv
  if (args.length === 0) return DEFAULT_DESKTOP_PACKAGE_ROOT
  if (args.length === 2 && args[0] === '--package-root' && args[1] && !args[1].startsWith('--')) {
    return resolve(cwd, args[1])
  }
  throw new Error('usage: --package-root <path>')
}

export function createTemporaryDesktopPackageArtifact(options = {}) {
  const temporaryRoot = options.temporaryRoot ?? tmpdir()
  const ownerRoot = mkdtempSync(join(temporaryRoot, 'openalice-desktop-package-'))
  const packageRoot = join(ownerRoot, 'artifact')
  const owner = {
    kind: 'openalice-desktop-package-smoke',
    pid: options.pid ?? process.pid,
    createdAt: options.createdAt ?? new Date().toISOString(),
  }
  writeFileSync(join(ownerRoot, DESKTOP_PACKAGE_OWNER_MARKER), `${JSON.stringify(owner, null, 2)}\n`)
  return { ownerRoot, packageRoot, owner }
}

export function cleanupTemporaryDesktopPackageArtifact(artifact, options = {}) {
  if (!artifact) return { cleaned: false, kept: false, error: null }
  if (options.keep) return { cleaned: false, kept: true, error: null }

  const markerPath = join(artifact.ownerRoot, DESKTOP_PACKAGE_OWNER_MARKER)
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (marker.kind !== 'openalice-desktop-package-smoke') {
      throw new Error(`refusing to remove unowned package directory: ${artifact.ownerRoot}`)
    }
    const remove = options.remove ?? rmSync
    remove(artifact.ownerRoot, {
      recursive: true,
      force: true,
      // Node retries EBUSY/EPERM/ENOTEMPTY only for recursive removals. This
      // matters on Windows, where Electron child processes may release files a
      // moment after their process exit event.
      maxRetries: 8,
      retryDelay: 250,
    })
    return { cleaned: true, kept: false, error: null }
  } catch (error) {
    if (!existsSync(artifact.ownerRoot)) return { cleaned: true, kept: false, error: null }
    return { cleaned: false, kept: false, error }
  }
}
