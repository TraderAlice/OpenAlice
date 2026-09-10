import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Payload inventory written beside app.asar after packing. The installer and
// the packaged desktop compare the installed tree against it so a partial
// extraction fails with a reinstall message instead of an arbitrary missing
// module or missing toolchain error at first launch.
export const INSTALL_INTEGRITY_FILE = 'openalice-integrity.json'
export const INSTALL_INTEGRITY_ROOTS = ['app.asar', 'app.asar.unpacked', 'runtime']

export function collectInstallIntegrity(resourcesDir, { version }) {
  const files = []
  const visit = (absolute, relativePath) => {
    const stat = lstatSync(absolute)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) visit(join(absolute, entry), `${relativePath}/${entry}`)
      return
    }
    // Symlink sizes depend on the filesystem, so only their presence is tracked.
    files.push([relativePath, stat.isSymbolicLink() ? null : stat.size])
  }
  for (const root of INSTALL_INTEGRITY_ROOTS) {
    try {
      lstatSync(join(resourcesDir, root))
    } catch {
      continue
    }
    visit(join(resourcesDir, root), root)
  }
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return { version, files }
}

export function readInstallIntegrity(resourcesDir) {
  const manifest = JSON.parse(readFileSync(join(resourcesDir, INSTALL_INTEGRITY_FILE), 'utf8'))
  if (typeof manifest?.version !== 'string' || !Array.isArray(manifest.files)) {
    throw new Error(`${INSTALL_INTEGRITY_FILE} has no version/files inventory`)
  }
  return manifest
}

export function verifyInstallIntegrity(resourcesDir, manifest) {
  const missing = []
  const mismatched = []
  for (const [relativePath, size] of manifest.files) {
    let stat
    try {
      stat = lstatSync(join(resourcesDir, relativePath))
    } catch {
      missing.push(relativePath)
      continue
    }
    if (size !== null && !stat.isSymbolicLink() && stat.size !== size) mismatched.push(relativePath)
  }
  return { checked: manifest.files.length, missing, mismatched }
}
