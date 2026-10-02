export interface UpdateGuidance {
  setupCount?: number
  app: boolean
  backend: boolean
  workspaceIds: readonly string[]
  needsAttentionWorkspaceIds: readonly string[]
  availableCount: number
  needsAttentionCount: number
}

interface WorkspaceCandidate {
  id: string
  template?: string | null
  upgradeAvailable?: { to: string } | null
}

interface WorkspaceObservation {
  workspaceId: string
  phase: 'checking' | 'available' | 'applying' | 'current' | 'updated' | 'blocked' | 'failed'
  toVersion?: string
  reason?: string
}

interface WorkspacePolicy {
  autoUpdateAutoQuant: boolean
  autoUpdateAutoPrediction: boolean
}

/** Project observations and inventory are two views of the same target. A
 * blocked automatic merge is visible on its row, but does not ask the user to
 * review an update until a manual blocker or failure needs intervention. */
export function selectWorkspaceUpdateGuidance(
  workspaces: readonly WorkspaceCandidate[],
  observations: readonly WorkspaceObservation[],
  policy: WorkspacePolicy | null,
): Pick<UpdateGuidance, 'workspaceIds' | 'needsAttentionWorkspaceIds'> {
  const byId = new Map(observations.map(state => [state.workspaceId, state]))
  const available: string[] = []
  const needsAttention: string[] = []
  for (const workspace of workspaces) {
    // Overview currently renders only these managed Workspace families. A
    // global breadcrumb must never point to a row the destination omits.
    if (!['chat', 'auto-quant-v2', 'auto-prediction'].includes(workspace.template ?? '')) continue
    const state = byId.get(workspace.id)
    if (!state) continue
    const candidate = state.toVersion
    if (state?.phase === 'failed') {
      needsAttention.push(workspace.id)
      continue
    }
    if (state?.phase === 'blocked') {
      const blockers = state.reason?.split(/\s*,\s*/).filter(Boolean) ?? []
      if (blockers.length === 0 || blockers.some(blocker => blocker !== 'active_runtime')) needsAttention.push(workspace.id)
      continue
    }
    if (state?.phase === 'checking' || state?.phase === 'applying' || state?.phase === 'current') continue
    if (state?.phase === 'updated' && state.toVersion === candidate) continue
    if (!candidate) continue
    if ((workspace.template === 'auto-quant-v2' || workspace.template === 'auto-prediction') && !policy) continue
    const autoUpdate = workspace.template === 'auto-quant-v2'
      ? policy?.autoUpdateAutoQuant
      : workspace.template === 'auto-prediction' ? policy?.autoUpdateAutoPrediction : false
    if (!autoUpdate) available.push(workspace.id)
  }
  return { workspaceIds: available, needsAttentionWorkspaceIds: needsAttention }
}
