import { isInteractiveSessionActive, projectPublicSessionRuntime } from '../public-session.js'
import { sessionPresence, type ResumeIdentityRecord } from '../resume-registry.js'
import type { SessionRecord } from '../session-registry.js'
import { issueAssigneeResumeId } from './declaration.js'
import type { IssueAssigneeSession } from './board.js'

/** Pure projection of an exact Issue owner. Registry lookup stays in the
 * service; keeping the state rules here makes every consumer share one tested
 * interpretation of terminal, WebPi, and headless activity. */
export function projectIssueAssigneeSession(input: {
  assignee: string
  identity?: ResumeIdentityRecord
  workspace?: { id: string; tag: string }
  interactive?: Pick<SessionRecord, 'state' | 'surface'>
  headlessActive?: boolean
}): IssueAssigneeSession | undefined {
  const resumeId = issueAssigneeResumeId(input.assignee)
  if (!resumeId) return undefined

  const identity = input.identity?.resumeId === resumeId ? input.identity : undefined
  if (!identity) return { resumeId, state: 'missing', active: false }

  const workspace = input.workspace?.id === identity.wsId ? input.workspace : undefined
  const presence = sessionPresence(identity)
  const state: IssueAssigneeSession['state'] = identity.lifecycle === 'retired'
    ? 'retired'
    : presence === 'deleted'
      ? 'deleted'
      : !workspace
        ? 'workspace_missing'
        : identity.agentSessionId
          ? 'ready'
          : 'unbound'

  return {
    resumeId,
    state,
    ...(workspace ? { workspace } : {}),
    agent: identity.agent,
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    active: state === 'ready' && (
      Boolean(input.headlessActive) || isInteractiveSessionActive(input.interactive)
    ),
    ...(identity.runtimeBinding
      ? { runtime: projectPublicSessionRuntime(identity.runtimeBinding) }
      : {}),
  }
}
