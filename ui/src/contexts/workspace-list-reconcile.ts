import type { Workspace } from '../components/workspace/api'
import { reconcileJsonCollection } from '../lib/reconcile-json-state'

/**
 * Preserve stable Workspace identities across the three-second list poll.
 * React consumers should only observe a new array/object when the server
 * snapshot actually changed; an identical HTTP response is not UI state.
 */
export function reconcileWorkspaceList(
  current: Workspace[],
  incoming: Workspace[],
): Workspace[] {
  return reconcileJsonCollection(current, incoming, (workspace) => workspace.id)
}
