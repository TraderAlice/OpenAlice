/** Supervisor-root migration, independent of project data/config journals.
 * Schema 3 is the durable idempotency marker; legacy files are retained. */
import { readFile, copyFile, constants } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { SupervisorConfigDocument } from './supervisor-config.ts'
import { parseDefaultTarget } from './supervisor-config.ts'

export const SUPERVISOR_DEFAULT_MIGRATION = 'supervisor_0001_unified_default_target'
export const SUPERVISOR_MIGRATIONS = [{ id: SUPERVISOR_DEFAULT_MIGRATION, schemaVersion: 3, introducedAt: '2026-09-30', affects: 'Supervisor/config.json', summary: 'One client-owned Default; preserve legacy startup files and record ambiguous migration choices.' }] as const

export function legacyDesktopPreferencePath(): string {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'OpenAlice', 'openalice-data-home.json')
}

async function readOptional(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export async function migrateSupervisorDefault(root: string, config: SupervisorConfigDocument,
  save: (root: string, config: SupervisorConfigDocument) => Promise<void>,
  desktopPath?: string): Promise<SupervisorConfigDocument> {
  if (config.schemaVersion === 3) return config
  const candidates: { machine: string; project: string }[] = []
  let issue: string | undefined
  try {
    const recent = await readOptional(join(root, 'startup-target.json')) as { schemaVersion?: unknown; target?: unknown } | undefined
    if (recent !== undefined) {
      if (!recent || recent.schemaVersion !== 1 || !Object.hasOwn(recent, 'target')) throw new Error('Invalid legacy startup target')
      const target = parseDefaultTarget(recent.target)
      if (target) candidates.push(target)
    }
    const selectedPath = desktopPath ?? legacyDesktopPreferencePath()
    const folder = dirname(selectedPath)
    // Development Electron uses package.name; packaged Electron uses productName.
    // Both clients must see the same migration inputs, regardless of entry order.
    const desktopPaths = ['OpenAlice', 'open-alice'].includes(basename(folder))
      ? ['OpenAlice', 'open-alice'].map(name => join(dirname(folder), name, 'openalice-data-home.json'))
      : [selectedPath]
    for (const path of desktopPaths) {
      const desktop = await readOptional(path) as { selectedHome?: unknown } | undefined
      if (desktop !== undefined) {
        if (!desktop || typeof desktop !== 'object') throw new Error('Invalid desktop startup preference')
        if (desktop.selectedHome != null) {
          if (typeof desktop.selectedHome !== 'string') throw new Error('Invalid desktop data folder')
          const matches = ['default', ...Object.keys(config.projects ?? {}).filter(key => key !== 'default')].filter(key => {
            const home = config.projects?.[key]?.home ?? (key === 'default' ? config.defaults?.home ?? join(homedir(), '.openalice') : undefined)
            return home && resolve(home) === resolve(desktop.selectedHome as string)
          })
          if (matches.length !== 1) throw new Error('The desktop data folder is not mapped to one registered AliceProject')
          candidates.push({ machine: 'local', project: matches[0]! })
        }
    }
    }
    if (config.defaultProject) candidates.push({ machine: 'local', project: config.defaultProject })
    if (candidates.some(target => target.machine !== candidates[0]?.machine || target.project !== candidates[0]?.project)) throw new Error('Legacy startup choices conflict')
  } catch (error) {
    issue = `${error instanceof Error ? error.message : String(error)}. Choose an AliceProject to save one Default.`
  }
  const { defaultProject: _old, ...rest } = config
  const next: SupervisorConfigDocument = { ...rest, schemaVersion: 3, defaultTarget: issue ? null : candidates[0] ?? null, ...(issue ? { defaultTargetMigrationError: issue } : {}) }
  try { await copyFile(join(root, 'config.json'), join(root, 'config.pre-default-target.json'), constants.COPYFILE_EXCL) }
  catch (error) { if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
  await save(root, next)
  return next
}
