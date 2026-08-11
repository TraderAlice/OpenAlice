import { useCallback, useMemo } from 'react'

import {
  updatePausedSessionRuntime,
  type PausedSessionRuntimeUpdate,
  type SessionRecord,
  type Workspace,
} from '../components/workspace/api'
import { useWorkspaces } from '../contexts/workspaces-context'

export interface WorkspaceDataSnapshot {
  readonly workspace: Workspace | null
  readonly sessions: readonly SessionRecord[]
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

export interface WorkspaceSessionDataSnapshot extends WorkspaceDataSnapshot {
  readonly session: SessionRecord | null
  updateRuntime(update: PausedSessionRuntimeUpdate): Promise<SessionRecord>
}

/**
 * Domain read boundary for one backend-backed Workspace snapshot.
 * Presentation components consume this hook (or props selected by a parent)
 * instead of reaching into the polling context or calling the API directly.
 */
export function useWorkspaceData(workspaceId: string): WorkspaceDataSnapshot {
  const context = useWorkspaces()
  const workspace = useMemo(
    () => context.workspaces.find((candidate) => candidate.id === workspaceId) ?? null,
    [context.workspaces, workspaceId],
  )

  return useMemo(() => ({
    workspace,
    sessions: workspace?.sessions ?? [],
    loading: !context.hasLoaded && workspace === null,
    error: context.listError,
    refresh: context.refresh,
  }), [context.hasLoaded, context.listError, context.refresh, workspace])
}

/** Select one Session without duplicating Workspace lookup/error semantics. */
export function useWorkspaceSessionData(
  workspaceId: string,
  sessionId: string | null,
): WorkspaceSessionDataSnapshot {
  const workspace = useWorkspaceData(workspaceId)
  const session = useMemo(
    () => sessionId
      ? workspace.sessions.find((candidate) => candidate.id === sessionId) ?? null
      : null,
    [sessionId, workspace.sessions],
  )
  const updateRuntime = useCallback(async (update: PausedSessionRuntimeUpdate) => {
    if (!sessionId) throw new Error('No Session is selected')
    const updated = await updatePausedSessionRuntime(workspaceId, sessionId, update)
    await workspace.refresh()
    return updated
  }, [sessionId, workspace, workspaceId])

  return useMemo(
    () => ({ ...workspace, session, updateRuntime }),
    [session, updateRuntime, workspace],
  )
}
