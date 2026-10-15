import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { workspacePlanKey, type WorkspacePlanRequest } from './workspacePlans'

/** Internal binding to the existing public lifecycle owner, never a second cache. */
export function useWorkspacePlan(request: WorkspacePlanRequest) {
  const { workspacePlans, workspaceStates, projectWorkspaces, checking, preferences, error: discoveryError, refresh } = useUpdateLifecycle()
  const observation = workspaceStates.find(state => state.workspaceId === request.workspaceId)
  const sourceObserved = request.kind === 'source' && (Boolean(observation) || projectWorkspaces.some(item => item.workspace?.id === request.workspaceId))
  const hasCandidate = observation && ['available', 'blocked'].includes(observation.phase) && observation.toVersion
  const enabled = !sourceObserved || Boolean(hasCandidate)
  if (!request.targetVersion && hasCandidate && (request.kind === 'source' || (!request.projection && request.layer !== 'alice-harness'))) request = { ...request, targetVersion: observation.toVersion }
  const key = workspacePlanKey(request)
  const resource = workspacePlans.resource(request)
  const current = useRef(resource)
  current.current = resource
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot)
  // A content/receipt invalidation also refreshes a review that is already open.
  // Settled success and error observations remain cached when reopened.
  useEffect(() => { if (enabled) void workspacePlans.ensure(request) }, [workspacePlans, key, resource, snapshot, enabled])
  return {
    plan: enabled ? snapshot.value?.plan ?? null : null, loading: enabled ? snapshot.checking : observation?.phase === 'checking' || checking || !preferences,
    current: sourceObserved && (observation?.phase === 'current' || observation?.phase === 'updated'),
    error: enabled ? (observation ? discoveryError : null) ?? snapshot.error ?? snapshot.value?.error ?? null : observation?.phase === 'failed' ? observation.reason ?? null : discoveryError ?? (!observation && preferences ? 'Workspace update status is unavailable.' : null), unsupported: snapshot.value?.unsupported ?? false,
    refresh: async () => { if (sourceObserved) await refresh(); else await workspacePlans.refresh(request) },
    replace: (plan: NonNullable<typeof snapshot.value>['plan']) => plan ? workspacePlans.replace(request, plan) : Promise.resolve(),
    invalidate: () => workspacePlans.invalidateWorkspace(request.workspaceId),
    identity: resource,
    isActive: workspacePlans.isActive,
    isCurrent: () => workspacePlans.isActive() && current.current === resource,
  }
}
