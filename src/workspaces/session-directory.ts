import type { HeadlessTaskRecord, HeadlessTaskStatus } from './headless-task-registry.js'
import {
  issueAssigneeResumeId,
  isConnectorDeskIssue,
  type IssueRecord,
} from './issues/declaration.js'
import {
  sessionPresence,
  type ResumeIdentityRecord,
  type SessionPresence,
} from './resume-registry.js'
import { sessionPreferredTitle, type SessionRecord } from './session-registry.js'
import type { SessionCreatedBy } from './session-metadata.js'
import {
  projectPublicSessionRuntime,
  type PublicSessionRuntime,
} from './public-session.js'

export interface WorkspaceSessionDirectoryEntry {
  resumeId: string
  agent: string
  createdAt: number
  updatedAt: number
  lifecycle: ResumeIdentityRecord['lifecycle']
  successorResumeId?: string
  /** Missing means active. */
  presence?: SessionPresence
  /** Workspace-owned coworker nametag. Missing means unnamed. */
  displayName?: string
  resumable: boolean
  active: boolean
  /** Secret-free birth stamp when this product Session was first allocated. */
  createdBy?: SessionCreatedBy
  /** Product rosters must not offer transport-owned Sessions as coworkers. */
  rosterVisibility?: 'hidden'
  runtime?: PublicSessionRuntime
  latestExecution?: {
    taskId: string
    status: HeadlessTaskStatus
    startedAt: number
    finishedAt?: number
    durationMs?: number
    issueId?: string
    assistantPreview?: string
  }
  interactive?: {
    name: string
    title?: string
    state: SessionRecord['state']
    lastActiveAt: string
  }
}

export interface WorkspaceSessionDirectory {
  workspace: { id: string; tag: string }
  sessions: WorkspaceSessionDirectoryEntry[]
}

export function connectorDeskRosterExclusions(input: {
  issues: readonly Pick<IssueRecord, 'id' | 'assignee' | 'connectorDesk'>[]
  executionsForIssue(issueId: string): readonly Pick<HeadlessTaskRecord, 'resumeId'>[]
  inquiriesForIssue(issueId: string): readonly Pick<HeadlessTaskRecord, 'resumeId'>[]
}): Set<string> {
  const hidden = new Set<string>()
  for (const issue of input.issues) {
    if (!isConnectorDeskIssue(issue)) continue
    const assignee = issueAssigneeResumeId(issue.assignee)
    if (assignee) hidden.add(assignee)
    for (const task of input.executionsForIssue(issue.id)) hidden.add(task.resumeId)
    for (const task of input.inquiriesForIssue(issue.id)) hidden.add(task.resumeId)
  }
  return hidden
}

/** Build the public Session directory by joining backend registries while
 * deliberately whitelisting fields. Native runtime ids and launcher record ids
 * never cross this boundary; resumeId is the sole conversation handle. */
export function buildWorkspaceSessionDirectory(input: {
  workspace: { id: string; tag: string }
  identities: readonly ResumeIdentityRecord[]
  interactiveFor(resumeId: string): SessionRecord | undefined
  latestExecutionFor(resumeId: string): HeadlessTaskRecord | null
  isActive(resumeId: string): boolean
  rosterVisibilityFor?(resumeId: string): 'hidden' | undefined
}): WorkspaceSessionDirectory {
  return {
    workspace: input.workspace,
    sessions: input.identities.map((identity) => {
      const execution = input.latestExecutionFor(identity.resumeId)
      const interactive = input.interactiveFor(identity.resumeId)
      const interactiveTitle = interactive ? sessionPreferredTitle(interactive) : undefined
      return {
        resumeId: identity.resumeId,
        agent: identity.agent,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        lifecycle: identity.lifecycle ?? 'active',
        ...(identity.successorResumeId ? { successorResumeId: identity.successorResumeId } : {}),
        ...(sessionPresence(identity) !== 'active' ? { presence: sessionPresence(identity) } : {}),
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        resumable: identity.lifecycle !== 'retired'
          && sessionPresence(identity) !== 'deleted'
          && Boolean(identity.agentSessionId),
        active: identity.lifecycle !== 'retired' && input.isActive(identity.resumeId),
        ...(identity.metadata?.createdBy ? { createdBy: identity.metadata.createdBy } : {}),
        ...(input.rosterVisibilityFor?.(identity.resumeId) === 'hidden'
          ? { rosterVisibility: 'hidden' as const }
          : {}),
        ...(identity.runtimeBinding
          ? { runtime: projectPublicSessionRuntime(identity.runtimeBinding) }
          : {}),
        ...(execution
          ? {
              latestExecution: {
                taskId: execution.taskId,
                status: execution.status,
                startedAt: execution.startedAt,
                ...(execution.finishedAt !== undefined ? { finishedAt: execution.finishedAt } : {}),
                ...(execution.durationMs !== undefined ? { durationMs: execution.durationMs } : {}),
                ...(execution.trigger?.kind === 'issue' ? { issueId: execution.trigger.issueId } : {}),
                ...(execution.output?.assistantPreview
                  ? { assistantPreview: execution.output.assistantPreview }
                  : {}),
              },
            }
          : {}),
        ...(interactive
          ? {
              interactive: {
                name: interactive.name,
                ...(interactiveTitle ? { title: interactiveTitle } : {}),
                state: interactive.state,
                lastActiveAt: interactive.lastActiveAt,
              },
            }
          : {}),
      }
    }),
  }
}
