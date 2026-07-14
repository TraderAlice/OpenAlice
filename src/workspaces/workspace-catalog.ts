import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './logger.js'
import type { WorkspaceMeta } from './workspace-registry.js'

export type WorkspaceLifecycleState =
  | 'active'
  | 'offboarding'
  | 'departed'
  | 'restoring'
  | 'purging'
  | 'purged'

export interface WorkspaceHandoffSnapshot {
  readonly preparedAt: string
  readonly reason: string
  readonly notes?: string
  readonly dirtyFiles: readonly string[]
  readonly openIssueIds: readonly string[]
  readonly scheduledIssueIds: readonly string[]
  readonly resumeIds: readonly string[]
  /** Explicit successor mappings survive an interrupted offboarding move. */
  readonly successors?: Readonly<Record<string, string>>
  readonly sessionRecords: number
}

/**
 * Durable employment record for a Workspace. `activeDir` is immutable: a
 * restored Workspace returns to the exact checkout path because native agent
 * transcripts and trust/config stores key conversation state by cwd.
 */
export interface WorkspaceCatalogRecord {
  readonly id: string
  readonly tag: string
  readonly activeDir: string
  readonly createdAt: string
  readonly agents: readonly string[]
  readonly template?: string
  readonly spawnedFromVersion?: string
  lifecycle: WorkspaceLifecycleState
  updatedAt: string
  departedDir?: string
  departedAt?: string
  restoredAt?: string
  purgedAt?: string
  reason?: string
  handoff?: WorkspaceHandoffSnapshot
  /** Directional consolidation trail; historical identity remains this row. */
  absorbedIntoWorkspaceId?: string
  absorbedAt?: string
  absorbCommit?: string
  /** Imported from an unregistered pre-Catalog directory. Metadata is best effort. */
  legacyImported?: boolean
}

interface FileShape {
  version: 1
  workspaces: WorkspaceCatalogRecord[]
}

export function catalogRecordToMeta(record: WorkspaceCatalogRecord): WorkspaceMeta {
  return {
    id: record.id,
    tag: record.tag,
    dir: record.activeDir,
    createdAt: record.createdAt,
    agents: record.agents,
    ...(record.template ? { template: record.template } : {}),
    ...(record.spawnedFromVersion ? { spawnedFromVersion: record.spawnedFromVersion } : {}),
  }
}

function recordFromMeta(meta: WorkspaceMeta, now: string): WorkspaceCatalogRecord {
  return {
    id: meta.id,
    tag: meta.tag,
    activeDir: meta.dir,
    createdAt: meta.createdAt,
    agents: [...meta.agents],
    ...(meta.template ? { template: meta.template } : {}),
    ...(meta.spawnedFromVersion ? { spawnedFromVersion: meta.spawnedFromVersion } : {}),
    lifecycle: 'active',
    updatedAt: now,
  }
}

/** Complete Workspace history; unlike workspaces.json, rows are never deleted. */
export class WorkspaceCatalog {
  private readonly records = new Map<string, WorkspaceCatalogRecord>()
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  static async load(
    path: string,
    active: readonly WorkspaceMeta[],
    logger: Logger,
  ): Promise<WorkspaceCatalog> {
    const catalog = new WorkspaceCatalog(path, logger)
    await catalog.read()
    let changed = false
    const now = new Date().toISOString()
    for (const meta of active) {
      const existing = catalog.records.get(meta.id)
      if (!existing) {
        catalog.records.set(meta.id, recordFromMeta(meta, now))
        changed = true
        continue
      }
      // If restore crashed after registry.add(), the active row proves that
      // direction completed. Other transition states must survive load so the
      // lifecycle manager can finish them instead of silently canceling them.
      if (existing.lifecycle === 'restoring') {
        existing.lifecycle = 'active'
        existing.restoredAt = now
        existing.updatedAt = now
        changed = true
      }
    }
    if (changed || catalog.records.size === 0) await catalog.flush()
    return catalog
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { version?: unknown; workspaces?: unknown }
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) {
        throw new Error('workspace-catalog.json has an unsupported shape')
      }
      for (const value of parsed.workspaces) {
        const record = validateRecord(value)
        if (!record) throw new Error('workspace-catalog.json contains an invalid record')
        this.records.set(record.id, record)
      }
      this.logger.info('workspace_catalog.loaded', { path: this.path, count: this.records.size })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      this.logger.error('workspace_catalog.read_failed', { path: this.path, err })
      throw err
    }
  }

  get(id: string): WorkspaceCatalogRecord | null {
    return this.records.get(id) ?? null
  }

  hasId(id: string): boolean {
    return this.records.has(id)
  }

  list(opts: { lifecycle?: WorkspaceLifecycleState | readonly WorkspaceLifecycleState[] } = {}): WorkspaceCatalogRecord[] {
    const wanted = opts.lifecycle === undefined
      ? null
      : new Set(Array.isArray(opts.lifecycle) ? opts.lifecycle : [opts.lifecycle])
    return [...this.records.values()]
      .filter((record) => !wanted || wanted.has(record.lifecycle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => ({ ...record, agents: [...record.agents] }))
  }

  async recordCreated(meta: WorkspaceMeta): Promise<void> {
    const existing = this.records.get(meta.id)
    if (existing) throw new Error(`workspace id is permanently reserved: ${meta.id}`)
    this.records.set(meta.id, recordFromMeta(meta, new Date().toISOString()))
    await this.flush()
  }

  async beginOffboarding(input: {
    meta: WorkspaceMeta
    departedDir: string
    reason: string
    handoff: WorkspaceHandoffSnapshot
  }): Promise<WorkspaceCatalogRecord> {
    const now = new Date().toISOString()
    const existing = this.records.get(input.meta.id) ?? recordFromMeta(input.meta, now)
    Object.assign(existing, {
      lifecycle: 'offboarding' as const,
      departedDir: input.departedDir,
      reason: input.reason,
      handoff: input.handoff,
      updatedAt: now,
    })
    this.records.set(existing.id, existing)
    await this.flush()
    return existing
  }

  async markDeparted(id: string, at = new Date().toISOString()): Promise<WorkspaceCatalogRecord> {
    return this.patch(id, { lifecycle: 'departed', departedAt: at, updatedAt: at })
  }

  async markAbsorbed(input: {
    id: string
    targetWorkspaceId: string
    commit: string
    at?: string
  }): Promise<WorkspaceCatalogRecord> {
    const at = input.at ?? new Date().toISOString()
    return this.patch(input.id, {
      lifecycle: 'departed',
      absorbedIntoWorkspaceId: input.targetWorkspaceId,
      absorbedAt: at,
      absorbCommit: input.commit,
      updatedAt: at,
    })
  }

  async beginRestoring(id: string): Promise<WorkspaceCatalogRecord> {
    const now = new Date().toISOString()
    return this.patch(id, { lifecycle: 'restoring', updatedAt: now })
  }

  async markActive(id: string, at = new Date().toISOString()): Promise<WorkspaceCatalogRecord> {
    return this.patch(id, {
      lifecycle: 'active',
      restoredAt: at,
      updatedAt: at,
      // Explicit restoration reopens the old desk as its own identity.
      absorbedIntoWorkspaceId: undefined,
      absorbedAt: undefined,
      absorbCommit: undefined,
    })
  }

  async beginPurging(id: string): Promise<WorkspaceCatalogRecord> {
    const now = new Date().toISOString()
    return this.patch(id, { lifecycle: 'purging', updatedAt: now })
  }

  async markPurged(id: string, at = new Date().toISOString()): Promise<WorkspaceCatalogRecord> {
    return this.patch(id, { lifecycle: 'purged', purgedAt: at, updatedAt: at })
  }

  /** Used only when a blocked transition has not yet mutated runtime state. */
  async cancelOffboarding(id: string): Promise<WorkspaceCatalogRecord> {
    const now = new Date().toISOString()
    return this.patch(id, { lifecycle: 'active', updatedAt: now })
  }

  private async patch(
    id: string,
    patch: Partial<WorkspaceCatalogRecord>,
  ): Promise<WorkspaceCatalogRecord> {
    const record = this.records.get(id)
    if (!record) throw new Error(`workspace catalog record not found: ${id}`)
    Object.assign(record, patch)
    await this.flush()
    return record
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const payload: FileShape = { version: 1, workspaces: [...this.records.values()] }
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, this.path)
  }
}

function validateRecord(value: unknown): WorkspaceCatalogRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const lifecycle = record['lifecycle']
  if (
    typeof record['id'] !== 'string' ||
    typeof record['tag'] !== 'string' ||
    typeof record['activeDir'] !== 'string' ||
    typeof record['createdAt'] !== 'string' ||
    !Array.isArray(record['agents']) ||
    !record['agents'].every((agent) => typeof agent === 'string') ||
    typeof record['updatedAt'] !== 'string' ||
    (record['absorbedIntoWorkspaceId'] !== undefined && typeof record['absorbedIntoWorkspaceId'] !== 'string') ||
    (record['absorbedAt'] !== undefined && typeof record['absorbedAt'] !== 'string') ||
    (record['absorbCommit'] !== undefined && typeof record['absorbCommit'] !== 'string') ||
    !['active', 'offboarding', 'departed', 'restoring', 'purging', 'purged'].includes(String(lifecycle))
  ) return null
  return value as WorkspaceCatalogRecord
}
