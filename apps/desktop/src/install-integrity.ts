import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Written by scripts/desktop-after-pack.mjs beside app.asar. Keep the file
// name and entry shape in sync with scripts/desktop-install-integrity.mjs.
export const INSTALL_INTEGRITY_FILE = 'openalice-integrity.json'
export const INSTALL_INTEGRITY_SKIP_ENV = 'OPENALICE_DESKTOP_SKIP_INSTALL_INTEGRITY'
export const REINSTALL_URL = 'https://github.com/TraderAlice/OpenAlice/releases/latest'

export interface InstallIntegrityManifest {
  version: string
  files: Array<[path: string, size: number | null]>
}

export type InstallIntegrityResult =
  | { status: 'verified'; checked: number; durationMs: number }
  | { status: 'damaged'; checked: number; missing: string[]; mismatched: string[]; durationMs: number }
  | { status: 'unverifiable'; reason: string }

const MAX_REPORTED_PATHS = 8

export async function readInstallIntegrityManifest(resourcesPath: string): Promise<InstallIntegrityManifest> {
  const raw = await readFile(join(resourcesPath, INSTALL_INTEGRITY_FILE), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as { version?: unknown }).version !== 'string' ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error(`${INSTALL_INTEGRITY_FILE} has no version/files inventory`)
  }
  return parsed as InstallIntegrityManifest
}

export async function verifyInstallIntegrity(
  resourcesPath: string,
  options: { manifest?: InstallIntegrityManifest; concurrency?: number } = {},
): Promise<InstallIntegrityResult> {
  const startedAt = Date.now()
  let manifest = options.manifest
  if (!manifest) {
    try {
      manifest = await readInstallIntegrityManifest(resourcesPath)
    } catch (error) {
      return { status: 'unverifiable', reason: error instanceof Error ? error.message : String(error) }
    }
  }
  const missing: string[] = []
  const mismatched: string[] = []
  const entries = manifest.files
  const concurrency = Math.max(1, options.concurrency ?? 32)
  let cursor = 0
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++]
      if (!entry) continue
      const [relativePath, size] = entry
      try {
        const stat = await lstat(join(resourcesPath, relativePath))
        if (size !== null && !stat.isSymbolicLink() && stat.size !== size) mismatched.push(relativePath)
      } catch {
        missing.push(relativePath)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length || 1) }, worker))
  const durationMs = Date.now() - startedAt
  if (missing.length === 0 && mismatched.length === 0) {
    return { status: 'verified', checked: entries.length, durationMs }
  }
  missing.sort()
  mismatched.sort()
  return { status: 'damaged', checked: entries.length, missing, mismatched, durationMs }
}

export function summarizeInstallIntegrity(result: InstallIntegrityResult): string {
  switch (result.status) {
    case 'verified':
      return `verified ${result.checked} files in ${result.durationMs}ms`
    case 'unverifiable':
      return `inventory unavailable: ${result.reason}`
    case 'damaged': {
      const sample = [...result.missing, ...result.mismatched].slice(0, MAX_REPORTED_PATHS)
      return (
        `damaged: ${result.missing.length} missing, ${result.mismatched.length} truncated ` +
        `of ${result.checked} files in ${result.durationMs}ms; first: ${sample.join(', ')}`
      )
    }
  }
}

export function describeInstallIntegrityFailure(
  result: Exclude<InstallIntegrityResult, { status: 'verified' }>,
  context: { version: string; installRoot: string; diagnosticsPath?: string },
): string {
  const lines: string[] = []
  if (result.status === 'unverifiable') {
    lines.push(`OpenAlice ${context.version} could not verify its installed files.`, '', result.reason)
  } else {
    lines.push(
      `OpenAlice ${context.version} is missing part of its installation, so it did not start.`,
      '',
      `${result.missing.length} file(s) are missing and ${result.mismatched.length} are truncated under:`,
      context.installRoot,
    )
    const sample = [...result.missing, ...result.mismatched].slice(0, MAX_REPORTED_PATHS)
    if (sample.length > 0) {
      lines.push('', ...sample.map((file) => `  ${file}`))
      const remaining = result.missing.length + result.mismatched.length - sample.length
      if (remaining > 0) lines.push(`  ... and ${remaining} more`)
    }
  }
  lines.push(
    '',
    'This usually means the installer or an update was interrupted, or another program removed files from the install directory.',
    'Download the installer again and reinstall OpenAlice. Your data directory is not affected.',
  )
  if (context.diagnosticsPath) lines.push('', `Diagnostic log:\n${context.diagnosticsPath}`)
  return lines.join('\n')
}
