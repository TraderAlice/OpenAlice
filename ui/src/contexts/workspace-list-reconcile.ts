import type { Workspace } from '../components/workspace/api'

function sameSnapshot(a: Workspace, b: Workspace): boolean {
  // Workspace DTOs are JSON-only and arrive from the same endpoint. Comparing
  // their serialized snapshots lets a polling refresh preserve object identity
  // without maintaining a second, inevitably incomplete field checklist.
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Preserve stable Workspace identities across the three-second list poll.
 * React consumers should only observe a new array/object when the server
 * snapshot actually changed; an identical HTTP response is not UI state.
 */
export function reconcileWorkspaceList(
  current: Workspace[],
  incoming: Workspace[],
): Workspace[] {
  const currentById = new Map(current.map((workspace) => [workspace.id, workspace]))
  let changed = current.length !== incoming.length

  const next = incoming.map((workspace, index) => {
    const previous = currentById.get(workspace.id)
    if (!previous || !sameSnapshot(previous, workspace)) {
      changed = true
      return workspace
    }
    if (current[index] !== previous) changed = true
    return previous
  })

  return changed ? next : current
}
