import type { Workspace } from '../components/workspace/api'

export function workspaceActivityMs(workspace: Pick<Workspace, 'createdAt' | 'sessions'>): number {
  const sessionActivity = workspace.sessions
    .map((session) => Date.parse(session.lastActiveAt))
    .filter(Number.isFinite)
  if (sessionActivity.length > 0) return Math.max(...sessionActivity)
  const created = Date.parse(workspace.createdAt)
  return Number.isFinite(created) ? created : 0
}

/** Resolve Ask Alice's current Chat workspace. Explicit selection wins, then
 *  the persisted recent Chat workspace, then latest activity when that pointer
 *  is missing or stale. */
export function resolveChatWorkspaceTarget(
  workspaces: readonly Workspace[],
  explicitWorkspaceId: string | null,
  recentWorkspaceId: string | null,
  templateName = 'chat',
): Workspace | null {
  const chats = workspaces.filter((workspace) => workspace.template === templateName)
  const explicit = explicitWorkspaceId
    ? chats.find((workspace) => workspace.id === explicitWorkspaceId)
    : undefined
  if (explicit) return explicit
  const recent = recentWorkspaceId
    ? chats.find((workspace) => workspace.id === recentWorkspaceId)
    : undefined
  if (recent) return recent
  return [...chats].sort((a, b) => workspaceActivityMs(b) - workspaceActivityMs(a))[0] ?? null
}
