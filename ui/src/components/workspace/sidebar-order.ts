import type { SessionRecord, Workspace } from './api'

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function workspaceActivityMs(workspace: Workspace): number {
  const sessionActivity = workspace.sessions.map((session) => timestamp(session.lastActiveAt))
  return sessionActivity.length > 0
    ? Math.max(timestamp(workspace.createdAt), ...sessionActivity)
    : timestamp(workspace.createdAt)
}

/**
 * Rank the workspace tree by active work, then by recency. Selection is
 * deliberately presentation-only: inspecting a paused session must not move
 * its workspace. A workspace is lifted only when one of its sessions is
 * actually running.
 */
export function orderWorkspacesForSidebar(
  workspaces: readonly Workspace[],
): Workspace[] {
  return [...workspaces].sort((a, b) => {
    const running = Number(b.sessions.some((session) => session.state === 'running'))
      - Number(a.sessions.some((session) => session.state === 'running'))
    if (running !== 0) return running

    const activity = workspaceActivityMs(b) - workspaceActivityMs(a)
    if (activity !== 0) return activity

    const created = timestamp(b.createdAt) - timestamp(a.createdAt)
    if (created !== 0) return created
    return a.id.localeCompare(b.id)
  })
}

/** Running sessions need immediate attention; within the same state, the
 * latest activity wins. Merely selecting a paused session never reorders it. */
export function orderSessionsForSidebar(
  sessions: readonly SessionRecord[],
): SessionRecord[] {
  return [...sessions].sort((a, b) => {
    const running = Number(b.state === 'running') - Number(a.state === 'running')
    if (running !== 0) return running

    const activity = timestamp(b.lastActiveAt) - timestamp(a.lastActiveAt)
    if (activity !== 0) return activity

    const created = timestamp(b.createdAt) - timestamp(a.createdAt)
    if (created !== 0) return created
    return a.id.localeCompare(b.id)
  })
}
