import type {
  SessionPresence,
  SessionRecord,
  Workspace,
  WorkspaceSessionDirectory,
  WorkspaceSessionDirectoryEntry,
} from './api'
import {
  projectHarnessSessionPresentation,
  type HarnessSessionSourceKind,
} from './harness-session-presentation'

export { shortResumeId } from './harness-session-presentation'

export interface HarnessSession {
  readonly workspaceId: string
  readonly resumeId: string
  readonly agent: string
  readonly title: string
  readonly sourceKind?: HarnessSessionSourceKind
  readonly issueId?: string
  readonly occupancyAt: number
  readonly occupancyRunning: boolean
  readonly headlessOccupying: boolean
  readonly failed: boolean
  readonly resumable: boolean
  readonly presence: SessionPresence
  readonly session: SessionRecord
  readonly directory: WorkspaceSessionDirectoryEntry | null
}

export function entryPresence(
  entry: WorkspaceSessionDirectoryEntry | null | undefined,
  fallback: SessionPresence = 'active',
): SessionPresence {
  return entry?.presence ?? fallback
}

function timestamp(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function harnessSessionTitle(
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): string {
  return projectHarnessSessionPresentation(session, entry).title
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
  session: SessionRecord,
  entry: WorkspaceSessionDirectoryEntry | null,
): HarnessSession {
  const resumeId = session.resumeId
  const interactiveRunning = session.state === 'running'
  const headlessOccupying = isHeadlessOccupying(session, entry)
  const presentation = projectHarnessSessionPresentation(session, entry)
  return {
    workspaceId,
    resumeId,
    agent: session.agent,
    title: presentation.title,
    ...(presentation.sourceKind ? { sourceKind: presentation.sourceKind } : {}),
    ...(presentation.issueId ? { issueId: presentation.issueId } : {}),
    occupancyAt: harnessOccupancyAt(session, entry),
    occupancyRunning: interactiveRunning || headlessOccupying,
    headlessOccupying,
    failed: entry?.latestExecution?.status === 'failed',
    resumable: entry?.resumable ?? true,
    presence: entryPresence(entry, session.presence ?? 'active'),
    session,
    directory: entry,
  }
}

/**
 * A Session that was born on a headless turn and has never opened a TUI or
 * WebPi. Ask Alice / Auto Quant hide these by default; the Issue page still
 * owns them.
 */
export function isHeadlessBornWithoutInteractive(
  session: SessionRecord,
  entry: WorkspaceSessionDirectoryEntry | null,
): boolean {
  if (entry?.interactive) return false
  if (session.surface === 'terminal' || session.surface === 'webpi') return false
  const createdBy = entry?.createdBy?.kind
  if (createdBy === 'interactive') return false
  if (createdBy === 'issue' || createdBy === 'headless') return true
  if (session.surface === 'headless') return true
  return Boolean(session.sourceRunId)
}

export interface HarnessSessionJoinOptions {
  readonly presence?: SessionPresence
  /** When false (Ask Alice / Auto Quant default), hide headless-born never-TUI rows. */
  readonly includeHeadlessBornSessions?: boolean
  /** When false (shared Harness default), keep current Issue owners/workers on Issue surfaces. */
  readonly includeIssueAttachedSessions?: boolean
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
 * Decorate the durable Session roster with Directory execution/provenance.
 * SessionRecord is the only membership source: Directory must never invent a
 * second, later row for a headless-born conversation.
 */
export function joinWorkspaceHarnessSessions(
  workspace: Workspace,
  directory: WorkspaceSessionDirectory | null,
  opts: HarnessSessionJoinOptions = {},
): HarnessSession[] {
  const wanted = opts.presence ?? 'active'
  const includeHeadlessBorn = opts.includeHeadlessBornSessions === true
  const includeIssueAttached = opts.includeIssueAttachedSessions === true
  if (!directory) {
    if (wanted !== 'active') return []
    return orderHarnessSessions(
      workspace.sessions
        .filter((session) => (session.presence ?? 'active') === 'active')
        .filter((session) => includeHeadlessBorn || !isHeadlessBornWithoutInteractive(session, null))
        .map((session) => toHarnessSession(workspace.id, session, null)),
    )
  }

  const directoryByResume = new Map(
    directory.sessions
      .filter((entry) => (entry.lifecycle ?? 'active') !== 'retired')
      .map((entry) => [entry.resumeId, entry]),
  )
  const rows = workspace.sessions.flatMap((session) => {
    const entry = directoryByResume.get(session.resumeId) ?? null
    if (entry?.rosterVisibility === 'hidden') return []
    if (!includeIssueAttached && entry?.issueAttached) return []
    const presence = entryPresence(entry, session.presence ?? 'active')
    if (presence !== wanted) return []
    if (!includeHeadlessBorn && isHeadlessBornWithoutInteractive(session, entry)) return []
    return [toHarnessSession(workspace.id, session, entry)]
  })
  return orderHarnessSessions(rows)
}

export function flattenHarnessSessions(
  workspaces: readonly Workspace[],
  directories: ReadonlyMap<string, WorkspaceSessionDirectory>,
  opts: HarnessSessionJoinOptions = {},
): HarnessSession[] {
  return orderHarnessSessions(workspaces.flatMap((workspace) =>
    joinWorkspaceHarnessSessions(workspace, directories.get(workspace.id) ?? null, opts)))
}
