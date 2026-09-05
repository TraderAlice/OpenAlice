/**
 * First-Session claim for `@new-then-resume`.
 *
 * The first successful dispatch — scheduled fire or human comment reply —
 * rewrites the Issue to that Session's exact `@resumeId`. Later fires and
 * comments continue the same owner. Creator provenance must not win over this
 * pending-owner policy.
 */
import type { ArtifactOrigin, IProvenanceStore } from '../../core/provenance-store.js'
import { ACTIVITY_UPDATE_COALESCE_MS } from '../../core/provenance-store.js'
import { logger as launcherLogger } from '../logger.js'
import type { SessionRuntimeSelection } from '../session-runtime-binding.js'
import { sessionSignature } from '../session-signature.js'
import { issueMutation, issueMutationFingerprint } from './change-tracker.js'
import {
  issueAssigneeClaimsFirstSession,
  readWorkspaceIssues,
  type IssueRecord,
} from './declaration.js'
import { updateIssueFields } from './mutate.js'

/** Freeze Issue credential/model/effort into a fresh Session birth. */
export function issueRuntimeSelection(
  issue: Pick<IssueRecord, 'credential' | 'credentialSource' | 'model' | 'effort'>,
): SessionRuntimeSelection | undefined {
  if (!issue.credential && !issue.credentialSource && !issue.model && !issue.effort) return undefined
  return {
    ...(issue.credentialSource === 'native' ? { credentialSource: 'native' as const } : {}),
    ...(issue.credential ? { credentialSlug: issue.credential } : {}),
    ...(issue.model ? { model: issue.model } : {}),
    ...(issue.effort ? { reasoningEffort: issue.effort } : {}),
  }
}

export async function claimIssueFirstSession(input: {
  issueWorkspace: { id: string; dir: string }
  issueId: string
  taskId: string
  resumeId: string
  agent: string
  provenanceStore: IProvenanceStore
  observeIssues?: (
    workspace: { id: string; dir: string },
    issues: readonly IssueRecord[],
    origin: ArtifactOrigin,
  ) => Promise<void>
}): Promise<'claimed' | 'skipped'> {
  const live = await readWorkspaceIssues(input.issueWorkspace.dir)
  const candidate = live.ok ? live.issues.find((issue) => issue.id === input.issueId) : undefined
  if (!candidate || !issueAssigneeClaimsFirstSession(candidate.assignee)) {
    launcherLogger.info('issue.first_session_claim_skipped', {
      wsId: input.issueWorkspace.id,
      issueId: input.issueId,
      taskId: input.taskId,
      resumeId: input.resumeId,
      reason: candidate ? 'assignee_changed' : 'issue_unavailable',
    })
    return 'skipped'
  }
  const claimed = await updateIssueFields(input.issueWorkspace.dir, input.issueId, {
    assignee: sessionSignature(input.resumeId),
  })
  if (!claimed.ok) {
    throw new Error(
      claimed.reason === 'invalid'
        ? claimed.error
        : `Issue disappeared before its first Session could claim it: ${input.issueId}`,
    )
  }
  const mutation = issueMutation(claimed.previous, claimed.issue)
  const origin: ArtifactOrigin = {
    kind: 'session',
    workspaceId: input.issueWorkspace.id,
    resumeId: input.resumeId,
    agent: input.agent,
    execution: { kind: 'headless', taskId: input.taskId },
  }
  await input.provenanceStore.append({
    artifact: { kind: 'issue', workspaceId: input.issueWorkspace.id, issueId: input.issueId },
    action: 'updated',
    origin,
    at: Date.now(),
    ...(mutation ? { mutation } : {}),
    fingerprint: issueMutationFingerprint(input.issueWorkspace.id, input.issueId, claimed.issue),
  }, { coalesceWithinMs: ACTIVITY_UPDATE_COALESCE_MS })
  if (input.observeIssues) {
    const reread = await readWorkspaceIssues(input.issueWorkspace.dir)
    if (reread.ok) await input.observeIssues(input.issueWorkspace, reread.issues, origin)
  }
  launcherLogger.info('issue.first_session_claimed', {
    wsId: input.issueWorkspace.id,
    issueId: input.issueId,
    taskId: input.taskId,
    resumeId: input.resumeId,
    agent: input.agent,
  })
  return 'claimed'
}
