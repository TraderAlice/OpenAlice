import type { SessionRecord, Workspace, WorkspaceSessionDirectory, WorkspaceSessionDirectoryEntry } from './api'

const PREVIEW_TITLE_LIMIT = 48

export interface HarnessSession {
  readonly workspaceId: string
  readonly resumeId: string
  readonly agent: string
  readonly title: string
  readonly occupancyAt: number
  readonly occupancyRunning: boolean
  readonly headlessOccupying: boolean
  readonly failed: boolean
  readonly resumable: boolean
  readonly session: SessionRecord | null
  readonly directory: WorkspaceSessionDirectoryEntry | null
}

function timestamp(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function shortResumeId(resumeId: string): string {
  const trimmed = resumeId.replace(/^resume-/, '')
  return trimmed.length <= 12 ? trimmed : trimmed.slice(0, 12)
}

export function harnessSessionTitle(
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): string {
  const interactiveTitle = session?.title?.trim() || entry?.interactive?.title?.trim()
  if (interactiveTitle) return interactiveTitle

  const preview = entry?.latestExecution?.assistantPreview?.replace(/\s+/g, ' ').trim()
  if (preview) {
    return preview.length > PREVIEW_TITLE_LIMIT
      ? `${preview.slice(0, PREVIEW_TITLE_LIMIT - 1)}…`
      : preview
  }

  const issueId = entry?.latestExecution?.issueId?.trim()
  if (issueId) return issueId

  if (session?.name.trim()) return session.name.trim()
  return shortResumeId(session?.resumeId ?? entry?.resumeId ?? 'session')
}

export function harnessOccupancyAt(
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): number {
  const times = [
    timestamp(session?.lastActiveAt),
    timestamp(session?.createdAt),
    timestamp(entry?.interactive?.lastActiveAt),
    entry?.latestExecution?.finishedAt ?? 0,
    entry?.latestExecution?.startedAt ?? 0,
    entry?.updatedAt ?? 0,
    entry?.createdAt ?? 0,
  ]
  return times.reduce((latest, value) => Math.max(latest, value), 0)
}

export function isHeadlessOccupying(
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): boolean {
  if (entry?.latestExecution?.status === 'running') return true
  return Boolean(entry?.active && session?.state !== 'running')
}

export function toHarnessSession(
  workspaceId: string,
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): HarnessSession {
  const resumeId = session?.resumeId ?? entry?.resumeId ?? ''
  const interactiveRunning = session?.state === 'running'
  const headlessOccupying = isHeadlessOccupying(session, entry)
  return {
    workspaceId,
    resumeId,
    agent: session?.agent ?? entry?.agent ?? 'pi',
    title: harnessSessionTitle(session, entry),
    occupancyAt: harnessOccupancyAt(session, entry),
    occupancyRunning: interactiveRunning || headlessOccupying,
    headlessOccupying,
    failed: entry?.latestExecution?.status === 'failed',
    resumable: entry ? entry.resumable : session !== null,
    session,
    directory: entry,
  }
}

/** Running occupancy first (TUI or headless), then latest occupancy. */
export function orderHarnessSessions<T extends {
  occupancyRunning: boolean
  occupancyAt: number
  resumeId: string
}>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const running = Number(right.occupancyRunning) - Number(left.occupancyRunning)
    if (running !== 0) return running
    const occupancy = right.occupancyAt - left.occupancyAt
    if (occupancy !== 0) return occupancy
    return left.resumeId.localeCompare(right.resumeId)
  })
}

/**
 * Join Directory identities with materialized SessionRecords.
 * Directory-only colleagues stay visible. Until Directory arrives, the
 * materialized list is the fallback roster.
 */
export function joinWorkspaceHarnessSessions(
  workspace: Workspace,
  directory: WorkspaceSessionDirectory | null,
): HarnessSession[] {
  const sessionsByResume = new Map(
    workspace.sessions.map((session) => [session.resumeId, session]),
  )

  if (!directory) {
    return orderHarnessSessions(
      workspace.sessions.map((session) => toHarnessSession(workspace.id, session, null)),
    )
  }

  const seen = new Set<string>()
  const rows: HarnessSession[] = []
  for (const entry of directory.sessions) {
    if ((entry.lifecycle ?? 'active') === 'retired') continue
    seen.add(entry.resumeId)
    rows.push(toHarnessSession(workspace.id, sessionsByResume.get(entry.resumeId) ?? null, entry))
  }
  for (const session of workspace.sessions) {
    if (seen.has(session.resumeId)) continue
    rows.push(toHarnessSession(workspace.id, session, null))
  }
  return orderHarnessSessions(rows)
}

export function sessionRecordForRow(row: HarnessSession): SessionRecord {
  if (row.session) {
    return row.session.title === row.title ? row.session : { ...row.session, title: row.title }
  }
  const occupancy = row.occupancyAt > 0 ? new Date(row.occupancyAt).toISOString() : new Date().toISOString()
  return {
    id: `resume:${row.resumeId}`,
    resumeId: row.resumeId,
    wsId: row.workspaceId,
    agent: row.agent,
    name: row.title,
    createdAt: occupancy,
    lastActiveAt: occupancy,
    state: 'paused',
    pid: null,
    startedAt: null,
    title: row.title,
  }
}

export function flattenHarnessSessions(
  workspaces: readonly Workspace[],
  directories: ReadonlyMap<string, WorkspaceSessionDirectory>,
): HarnessSession[] {
  return orderHarnessSessions(workspaces.flatMap((workspace) =>
    joinWorkspaceHarnessSessions(workspace, directories.get(workspace.id) ?? null)))
}
