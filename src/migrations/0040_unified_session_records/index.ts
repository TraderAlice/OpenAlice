import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Migration } from '../types.js'

interface IdentityRecord extends Record<string, unknown> {
  resumeId: string
  wsId: string
  agent: string
  createdAt: number
  updatedAt: number
  lifecycle: 'active' | 'retired'
  presence?: 'active' | 'archived' | 'deleted'
  agentSessionId?: string
  latestTaskId?: string
}

interface HeadlessTask extends Record<string, unknown> {
  taskId: string
  resumeId: string
  prompt: string
  startedAt: number
  finishedAt?: number
  agentSessionId?: string
}

type SessionState = 'running' | 'paused'
type SessionSurface = 'terminal' | 'webpi' | 'headless'

interface SessionRow extends Record<string, unknown> {
  id: string
  resumeId: string
  wsId: string
  agent: string
  name: string
  createdAt: string
  lastActiveAt: string
  state: SessionState
  surface?: SessionSurface
  title?: string
  fallbackTitle?: string
  sourceRunId?: string
  resumeHint?: { kind: 'agent-session-id'; value: string }
}

const IDENTITIES_REL = join('state', 'resume-identities.json')
const TASKS_REL = join('state', 'headless-tasks.json')
const CATALOG_REL = join('state', 'workspace-catalog.json')
const SESSIONS_REL = join('state', 'sessions')
const SESSION_FILE_RE = /^[A-Za-z0-9_-]+\.json$/u

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function parseIdentities(value: unknown): IdentityRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('resume-identities.json has an unsupported shape')
  }
  const root = value as Record<string, unknown>
  if (root['version'] !== 1 || !Array.isArray(root['records'])) {
    throw new Error('resume-identities.json has an unsupported shape')
  }
  const seen = new Set<string>()
  return root['records'].map((value): IdentityRecord => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('resume-identities.json contains an invalid record')
    }
    const row = value as Record<string, unknown>
    if (
      typeof row['resumeId'] !== 'string'
      || typeof row['wsId'] !== 'string'
      || typeof row['agent'] !== 'string'
      || typeof row['createdAt'] !== 'number'
      || typeof row['updatedAt'] !== 'number'
    ) {
      throw new Error('resume-identities.json contains an invalid record')
    }
    if (seen.has(row['resumeId'])) {
      throw new Error(`resume-identities.json contains duplicate identity ${row['resumeId']}`)
    }
    seen.add(row['resumeId'])
    return {
      ...row,
      resumeId: row['resumeId'],
      wsId: row['wsId'],
      agent: row['agent'],
      createdAt: row['createdAt'],
      updatedAt: row['updatedAt'],
      lifecycle: row['lifecycle'] === 'retired' ? 'retired' : 'active',
      ...(row['presence'] === 'archived' || row['presence'] === 'deleted'
        ? { presence: row['presence'] }
        : {}),
      ...(typeof row['agentSessionId'] === 'string' ? { agentSessionId: row['agentSessionId'] } : {}),
      ...(typeof row['latestTaskId'] === 'string' ? { latestTaskId: row['latestTaskId'] } : {}),
    }
  })
}

function parseTasks(value: unknown): HeadlessTask[] {
  if (value === undefined) return []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('headless-tasks.json has an unsupported shape')
  }
  const rows = (value as Record<string, unknown>)['tasks']
  if (!Array.isArray(rows)) throw new Error('headless-tasks.json has an unsupported shape')
  return rows.flatMap((value): HeadlessTask[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (
      typeof row['taskId'] !== 'string'
      || typeof row['resumeId'] !== 'string'
      || typeof row['prompt'] !== 'string'
      || typeof row['startedAt'] !== 'number'
    ) return []
    return [{
      ...row,
      taskId: row['taskId'],
      resumeId: row['resumeId'],
      prompt: row['prompt'],
      startedAt: row['startedAt'],
      ...(typeof row['finishedAt'] === 'number' ? { finishedAt: row['finishedAt'] } : {}),
      ...(typeof row['agentSessionId'] === 'string' ? { agentSessionId: row['agentSessionId'] } : {}),
    }]
  })
}

function purgedWorkspaceIds(value: unknown): Set<string> {
  if (value === undefined) return new Set()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workspace-catalog.json has an unsupported shape')
  }
  const root = value as Record<string, unknown>
  if (root['version'] !== 1 || !Array.isArray(root['workspaces'])) {
    throw new Error('workspace-catalog.json has an unsupported shape')
  }
  return new Set(root['workspaces'].flatMap((value): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    return typeof row['id'] === 'string'
      && (row['lifecycle'] === 'purged' || row['lifecycle'] === 'purging')
      ? [row['id']]
      : []
  }))
}

function normalizeSessionRows(value: unknown, wsId: string): SessionRow[] {
  if (value === undefined) return []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`sessions/${wsId}.json has an unsupported shape`)
  }
  const root = value as Record<string, unknown>
  const version = root['version']
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
    throw new Error(`sessions/${wsId}.json has an unsupported shape`)
  }
  if (!Array.isArray(root['records'])) {
    throw new Error(`sessions/${wsId}.json has an unsupported shape`)
  }
  return root['records'].map((value, index): SessionRow => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`sessions/${wsId}.json record ${index} is invalid`)
    }
    const row = value as Record<string, unknown>
    if (
      typeof row['id'] !== 'string'
      || typeof row['wsId'] !== 'string'
      || row['wsId'] !== wsId
      || typeof row['agent'] !== 'string'
      || typeof row['name'] !== 'string'
      || typeof row['createdAt'] !== 'string'
      || typeof row['lastActiveAt'] !== 'string'
      || (row['state'] !== 'running' && row['state'] !== 'paused')
    ) throw new Error(`sessions/${wsId}.json record ${index} is invalid`)

    const resumeId = typeof row['resumeId'] === 'string' ? row['resumeId'] : row['id']
    const title = (version === 3 || version === 4) && typeof row['title'] === 'string'
      ? row['title']
      : undefined
    const fallbackTitle = typeof row['fallbackTitle'] === 'string'
      ? row['fallbackTitle']
      : version !== 3 && version !== 4 && typeof row['title'] === 'string'
        ? row['title']
        : undefined
    const hint = row['resumeHint']
    const resumeHint = hint && typeof hint === 'object'
      && (hint as Record<string, unknown>)['kind'] === 'agent-session-id'
      && typeof (hint as Record<string, unknown>)['value'] === 'string'
      ? { kind: 'agent-session-id' as const, value: (hint as Record<string, string>)['value']! }
      : undefined
    return {
      ...row,
      id: row['id'],
      resumeId,
      wsId,
      agent: row['agent'],
      name: row['name'],
      createdAt: row['createdAt'],
      lastActiveAt: row['lastActiveAt'],
      state: row['state'],
      ...(row['surface'] === 'terminal' || row['surface'] === 'webpi' || row['surface'] === 'headless'
        ? { surface: row['surface'] }
        : {}),
      ...(title ? { title } : {}),
      ...(fallbackTitle ? { fallbackTitle } : {}),
      ...(typeof row['sourceRunId'] === 'string' ? { sourceRunId: row['sourceRunId'] } : {}),
      ...(resumeHint ? { resumeHint } : {}),
    }
  })
}

function namePrefix(agent: string): string {
  if (agent === 'claude') return 'c'
  if (agent === 'codex') return 'x'
  if (agent === 'opencode') return 'o'
  if (agent === 'pi') return 'p'
  if (agent === 'shell') return 'sh'
  return agent.replace(/[^A-Za-z0-9]/gu, '').slice(0, 1).toLowerCase() || 's'
}

function nextName(rows: readonly SessionRow[], agent: string): string {
  const prefix = namePrefix(agent)
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(\\d+)$`, 'u')
  let max = 0
  for (const row of rows) {
    if (row.agent !== agent) continue
    const match = pattern.exec(row.name)
    if (!match) continue
    max = Math.max(max, Number.parseInt(match[1]!, 10))
  }
  return `${prefix}${max + 1}`
}

function migratedRecordId(identity: IdentityRecord): string {
  const digest = createHash('sha256').update(identity.resumeId).digest('hex').slice(0, 16)
  return `${namePrefix(identity.agent)}-migrated-${digest}`
}

export async function migrateUnifiedSessionRecords(
  launcherRoot: string,
  options: { readonly backupRoot?: string } = {},
): Promise<{ migrated: boolean; created: number; files: number }> {
  const identitiesValue = await readOptionalJson(join(launcherRoot, IDENTITIES_REL))
  if (identitiesValue === undefined) return { migrated: false, created: 0, files: 0 }
  const identities = parseIdentities(identitiesValue)
  const purgedWorkspaces = purgedWorkspaceIds(
    await readOptionalJson(join(launcherRoot, CATALOG_REL)),
  )
  const identitiesByResume = new Map(identities.map((identity) => [identity.resumeId, identity]))
  const tasks = parseTasks(await readOptionalJson(join(launcherRoot, TASKS_REL)))
  const latestTaskByResume = new Map<string, HeadlessTask>()
  for (const task of tasks) {
    const existing = latestTaskByResume.get(task.resumeId)
    if (!existing || task.startedAt >= existing.startedAt) latestTaskByResume.set(task.resumeId, task)
  }

  const sessionsDir = join(launcherRoot, SESSIONS_REL)
  let fileNames: string[] = []
  try {
    fileNames = (await readdir(sessionsDir)).filter((name) => SESSION_FILE_RE.test(name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const rowsByWorkspace = new Map<string, SessionRow[]>()
  for (const name of fileNames) {
    const wsId = name.slice(0, -'.json'.length)
    rowsByWorkspace.set(wsId, normalizeSessionRows(
      await readOptionalJson(join(sessionsDir, name)),
      wsId,
    ))
  }

  const ids = new Set<string>()
  const resumeIds = new Set<string>()
  for (const rows of rowsByWorkspace.values()) {
    for (const row of rows) {
      if (ids.has(row.id)) throw new Error(`duplicate Session record id ${row.id}`)
      if (resumeIds.has(row.resumeId)) throw new Error(`duplicate Session resume identity ${row.resumeId}`)
      const identity = identitiesByResume.get(row.resumeId)
      if (!identity) throw new Error(`SessionRecord ${row.id} has no ResumeIdentityRecord: ${row.resumeId}`)
      if (identity.wsId !== row.wsId || identity.agent !== row.agent) {
        throw new Error(`SessionRecord ${row.id} ownership conflicts with resume identity ${row.resumeId}`)
      }
      ids.add(row.id)
      resumeIds.add(row.resumeId)
    }
  }

  let created = 0
  const touched = new Set<string>()
  const missing = identities
    .filter((identity) => !purgedWorkspaces.has(identity.wsId))
    .filter((identity) => !resumeIds.has(identity.resumeId))
    .sort((left, right) => left.createdAt - right.createdAt || left.resumeId.localeCompare(right.resumeId))
  for (const identity of missing) {
    const rows = rowsByWorkspace.get(identity.wsId) ?? []
    const task = latestTaskByResume.get(identity.resumeId)
    const id = migratedRecordId(identity)
    if (ids.has(id)) throw new Error(`generated Session record id conflicts: ${id}`)
    const lastActiveAt = Math.max(
      identity.updatedAt,
      task?.finishedAt ?? 0,
      task?.startedAt ?? 0,
    )
    rows.push({
      id,
      resumeId: identity.resumeId,
      wsId: identity.wsId,
      agent: identity.agent,
      name: nextName(rows, identity.agent),
      createdAt: new Date(identity.createdAt).toISOString(),
      lastActiveAt: new Date(lastActiveAt).toISOString(),
      state: 'paused',
      surface: task ? 'headless' : 'terminal',
      ...(task?.prompt ? { fallbackTitle: task.prompt.trim().slice(0, 200) } : {}),
      ...(task ? { sourceRunId: task.taskId } : {}),
      ...(identity.agentSessionId || task?.agentSessionId
        ? {
            resumeHint: {
              kind: 'agent-session-id',
              value: identity.agentSessionId ?? task!.agentSessionId!,
            },
          }
        : {}),
    })
    rowsByWorkspace.set(identity.wsId, rows)
    ids.add(id)
    resumeIds.add(identity.resumeId)
    touched.add(identity.wsId)
    created += 1
  }

  // Normalize an existing pre-v4 file only when this migration already needs
  // to write it. Unchanged files remain byte-for-byte stable.
  if (created === 0) return { migrated: false, created: 0, files: 0 }
  for (const wsId of touched) {
    const path = join(sessionsDir, `${wsId}.json`)
    if (options.backupRoot) {
      const existing = await readOptionalJson(path)
      if (existing !== undefined) {
        const backup = join(options.backupRoot, SESSIONS_REL, `${wsId}.json`)
        await mkdir(dirname(backup), { recursive: true })
        await copyFile(path, backup)
      }
    }
    await atomicWrite(path, { version: 4, records: rowsByWorkspace.get(wsId) ?? [] })
  }
  return { migrated: true, created, files: touched.size }
}

export const migration: Migration = {
  id: '0040_unified_session_records',
  appVersion: '0.89.4-beta',
  introducedAt: '2026-08-15',
  affects: [
    'workspaces/state/resume-identities.json',
    'workspaces/state/headless-tasks.json',
    'workspaces/state/sessions/*.json',
  ],
  summary: 'Give every non-purged resume identity one persistent Session roster record, including headless-born conversations.',
  rationale: 'A Session is a durable product identity from birth; terminal, WebPi, and headless are execution surfaces of that same record.',
  up: async (ctx) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0040_unified_session_records`,
    )
    await migrateUnifiedSessionRecords(ctx.launcherRoot(), { backupRoot })
  },
}
