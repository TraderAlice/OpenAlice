/**
 * Issue change observation and field-level audit details.
 *
 * Issue markdown is intentionally editable outside OpenAlice's mutation APIs.
 * The tracker therefore keeps a compact launcher-owned snapshot and compares
 * every later scan. Known UI/CLI mutations use the same diff + fingerprint, so
 * an observer pass cannot duplicate a mutation that was already attributed.
 * Git remains the content/version rollback layer; this file stores only small
 * field values and a hash for the markdown What document.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  ArtifactOrigin,
  IProvenanceStore,
  ProvenanceMutation,
} from '../../core/provenance-store.js'
import { ACTIVITY_UPDATE_COALESCE_MS } from '../../core/provenance-store.js'
import type { Logger } from '../logger.js'
import type { IssueRecord } from './declaration.js'

export interface IssueAuditSnapshot {
  title: string
  status: string
  priority: string
  assignee: string
  schedule?: string
  agent?: string
  whatHash: string
}

interface TrackerFile {
  version: 1
  workspaces: Record<string, Record<string, IssueAuditSnapshot>>
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function compactAuditValue(value: string): string {
  return value.length <= 1000 ? value : `${value.slice(0, 999)}…`
}

export function issueAuditSnapshot(issue: IssueRecord): IssueAuditSnapshot {
  return {
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    ...(issue.when ? { schedule: JSON.stringify(issue.when) } : {}),
    ...(issue.agent ? { agent: issue.agent } : {}),
    whatHash: digest(issue.what),
  }
}

export function issueMutation(
  before: IssueRecord | IssueAuditSnapshot,
  after: IssueRecord | IssueAuditSnapshot,
): ProvenanceMutation | null {
  const left = 'what' in before ? issueAuditSnapshot(before) : before
  const right = 'what' in after ? issueAuditSnapshot(after) : after
  const fields: ProvenanceMutation['fields'] = []
  const valueField = (
    field: string,
    previous: string | undefined,
    next: string | undefined,
  ) => {
    if (previous === next) return
    fields.push({
      field,
      ...(previous !== undefined ? { before: compactAuditValue(previous) } : {}),
      ...(next !== undefined ? { after: compactAuditValue(next) } : {}),
    })
  }
  valueField('title', left.title, right.title)
  valueField('status', left.status, right.status)
  valueField('priority', left.priority, right.priority)
  valueField('assignee', left.assignee, right.assignee)
  valueField('schedule', left.schedule, right.schedule)
  valueField('runtime', left.agent, right.agent)
  if (left.whatHash !== right.whatHash) fields.push({ field: 'what' })
  return fields.length > 0 ? { fields } : null
}

export function issueMutationFingerprint(
  workspaceId: string,
  issueId: string,
  issue: IssueRecord | IssueAuditSnapshot,
): string {
  const snapshot = 'what' in issue ? issueAuditSnapshot(issue) : issue
  return `issue-state:${workspaceId}:${issueId}:${digest(JSON.stringify(snapshot))}`
}

function validSnapshot(value: unknown): value is IssueAuditSnapshot {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row['title'] === 'string' &&
    typeof row['status'] === 'string' &&
    typeof row['priority'] === 'string' &&
    typeof row['assignee'] === 'string' &&
    typeof row['whatHash'] === 'string' &&
    (row['schedule'] === undefined || typeof row['schedule'] === 'string') &&
    (row['agent'] === undefined || typeof row['agent'] === 'string')
  )
}

/** Persistent observer for edits that bypass the UI/CLI mutation seam. */
export class IssueChangeTracker {
  private readonly workspaces = new Map<string, Map<string, IssueAuditSnapshot>>()
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly provenance: IProvenanceStore,
    private readonly logger: Logger,
  ) {}

  static async load(
    path: string,
    provenance: IProvenanceStore,
    logger: Logger,
  ): Promise<IssueChangeTracker> {
    const tracker = new IssueChangeTracker(path, provenance, logger)
    await tracker.read()
    return tracker
  }

  observeWorkspace(input: {
    workspaceId: string
    issues: readonly IssueRecord[]
    origin: ArtifactOrigin
    now?: number
  }): Promise<void> {
    const next = this.queue.then(() => this.observeNow(input))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async observeNow(input: {
    workspaceId: string
    issues: readonly IssueRecord[]
    origin: ArtifactOrigin
    now?: number
  }): Promise<void> {
    const previous = this.workspaces.get(input.workspaceId)
    const current = new Map(
      input.issues.map((issue) => [issue.id, issueAuditSnapshot(issue)] as const),
    )
    // The first sight of a Workspace establishes a baseline. Persisting it
    // means edits made while OpenAlice is offline are visible on next startup.
    if (!previous) {
      this.workspaces.set(input.workspaceId, current)
      await this.flush()
      return
    }

    const at = input.now ?? Date.now()
    let dirty = previous.size !== current.size
    for (const issue of input.issues) {
      const before = previous.get(issue.id)
      const after = current.get(issue.id)!
      const artifact = {
        kind: 'issue' as const,
        workspaceId: input.workspaceId,
        issueId: issue.id,
      }
      if (!before) {
        dirty = true
        if (!this.provenance.latest({ artifact, action: 'created' })) {
          await this.provenance.append({
            artifact,
            action: 'created',
            origin: input.origin,
            at,
            fingerprint: `issue:${input.workspaceId}:${issue.id}:created`,
          })
        }
        continue
      }
      const mutation = issueMutation(before, after)
      if (!mutation) continue
      dirty = true
      await this.provenance.append({
        artifact,
        action: 'updated',
        origin: input.origin,
        at,
        mutation,
        fingerprint: issueMutationFingerprint(input.workspaceId, issue.id, after),
      }, { coalesceWithinMs: ACTIVITY_UPDATE_COALESCE_MS })
    }

    if (!dirty) return
    this.workspaces.set(input.workspaceId, current)
    await this.flush()
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<TrackerFile>
      if (parsed.version !== 1 || !parsed.workspaces || typeof parsed.workspaces !== 'object') {
        throw new Error('unsupported Issue audit snapshot shape')
      }
      for (const [workspaceId, rows] of Object.entries(parsed.workspaces)) {
        if (!rows || typeof rows !== 'object') continue
        const issues = new Map<string, IssueAuditSnapshot>()
        for (const [issueId, snapshot] of Object.entries(rows)) {
          if (validSnapshot(snapshot)) issues.set(issueId, snapshot)
        }
        this.workspaces.set(workspaceId, issues)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      this.logger.warn('issue_change_tracker.read_failed', { err })
      this.workspaces.clear()
    }
  }

  private async flush(): Promise<void> {
    const workspaces: TrackerFile['workspaces'] = {}
    for (const [workspaceId, issues] of this.workspaces) {
      workspaces[workspaceId] = Object.fromEntries(issues)
    }
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, workspaces }, null, 2) + '\n', {
      mode: 0o600,
    })
    await rename(tmp, this.path)
  }
}
