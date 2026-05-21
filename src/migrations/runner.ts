/**
 * Migration runner — apply pending migrations recorded in
 * data/config/_meta.json.
 *
 * Snapshot before each migration: copies data/config/ to
 * data/_backup/{ts}-pre-{id}/config/. If a migration throws, the
 * journal is NOT updated for that id and startup halts; the user
 * can restore from the snapshot manually.
 *
 * Larger trees (data/sessions/, data/news-collector/, etc.) are NOT
 * snapshotted by default. A migration that touches them must declare
 * the directory in `affects` and surface a user warning ahead of
 * time (warning UI is out of scope for the framework).
 */

import { readFile, writeFile, mkdir, unlink, cp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Migration, MigrationContext, ConfigMeta } from './types.js'
import { REGISTRY } from './registry.js'
import { dataPath } from '@/core/paths.js'

const CONFIG_DIR = dataPath('config')
const BACKUP_DIR = dataPath('_backup')
const META_FILENAME = '_meta.json'

// ==================== App version ====================

let _appVersion: string | null = null

export function getAppVersion(): string {
  if (_appVersion !== null) return _appVersion
  try {
    const here = fileURLToPath(import.meta.url)
    // src/migrations/runner.ts → walk up to repo root
    const repoRoot = resolve(dirname(here), '..', '..')
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8'))
    _appVersion = (pkg.version as string) ?? '0.0.0'
  } catch {
    _appVersion = '0.0.0'
  }
  return _appVersion
}

// ==================== Default context ====================

export function makeDefaultContext(): MigrationContext {
  return {
    async readJson<T>(filename: string): Promise<T | undefined> {
      try {
        return JSON.parse(await readFile(resolve(CONFIG_DIR, filename), 'utf-8'))
      } catch (err: unknown) {
        if (isENOENT(err)) return undefined
        throw err
      }
    },
    async writeJson(filename: string, data: unknown): Promise<void> {
      await mkdir(CONFIG_DIR, { recursive: true })
      await writeFile(resolve(CONFIG_DIR, filename), JSON.stringify(data, null, 2) + '\n')
    },
    async removeJson(filename: string): Promise<void> {
      try { await unlink(resolve(CONFIG_DIR, filename)) } catch (err) {
        if (!isENOENT(err)) throw err
      }
    },
    configDir(): string {
      return CONFIG_DIR
    },
  }
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

// ==================== Journal ====================

async function readMeta(ctx: MigrationContext): Promise<ConfigMeta> {
  const existing = await ctx.readJson<ConfigMeta>(META_FILENAME)
  if (existing && Array.isArray(existing.appliedMigrations)) {
    return {
      appVersion: existing.appVersion ?? getAppVersion(),
      appliedMigrations: existing.appliedMigrations,
    }
  }
  return { appVersion: getAppVersion(), appliedMigrations: [] }
}

async function writeMeta(ctx: MigrationContext, meta: ConfigMeta): Promise<void> {
  await ctx.writeJson(META_FILENAME, meta)
}

// ==================== Snapshot ====================

/** Copy data/config/ to data/_backup/{ts}-{label}/config/. Returns path or null if config dir doesn't exist. */
async function defaultSnapshot(label: string): Promise<string | null> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const target = resolve(BACKUP_DIR, `${ts}-${label}`, 'config')
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(CONFIG_DIR, target, { recursive: true, errorOnExist: false })
    return target
  } catch (err: unknown) {
    if (isENOENT(err)) return null
    throw err
  }
}

// ==================== Runner ====================

export interface RunnerOpts {
  /** Override the default file-system context (used in tests). */
  ctx?: MigrationContext
  /** Override the default registry (used in tests). */
  registry?: Migration[]
  /** Override the snapshot strategy (used in tests). */
  snapshot?: (label: string) => Promise<string | null>
}

export async function runMigrations(opts: RunnerOpts = {}): Promise<void> {
  const ctx = opts.ctx ?? makeDefaultContext()
  const registry = opts.registry ?? REGISTRY
  const snapshot = opts.snapshot ?? defaultSnapshot

  const meta = await readMeta(ctx)
  const applied = new Set(meta.appliedMigrations.map(m => m.id))
  const pending = registry.filter(m => !applied.has(m.id))

  if (pending.length === 0) return

  for (const m of pending) {
    let snapshotPath: string | null = null
    try {
      snapshotPath = await snapshot(`pre-${m.id}`)
      await m.up(ctx)
      meta.appliedMigrations.push({
        id: m.id,
        appliedAt: new Date().toISOString(),
        appVersion: getAppVersion(),
      })
      meta.appVersion = getAppVersion()
      await writeMeta(ctx, meta)
      console.log(
        `[migration] applied ${m.id} (snapshot: ${snapshotPath ?? '<no prior config>'})`,
      )
    } catch (err) {
      console.error(
        `[migration] FAILED ${m.id} — data may be in partial state. ` +
        `Snapshot: ${snapshotPath ?? '<none>'}. Error: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }
}
