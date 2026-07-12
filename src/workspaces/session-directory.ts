import type { HeadlessTaskRecord, HeadlessTaskStatus } from './headless-task-registry.js'
import type { ResumeIdentityRecord } from './resume-registry.js'
import type { SessionRecord } from './session-registry.js'

export interface WorkspaceSessionDirectoryEntry {
  resumeId: string
  agent: string
  createdAt: number
  updatedAt: number
  lifecycle: ResumeIdentityRecord['lifecycle']
  successorResumeId?: string
  resumable: boolean
  active: boolean
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

/** Build the public Session directory by joining backend registries while
 * deliberately whitelisting fields. Native runtime ids and launcher record ids
 * never cross this boundary; resumeId is the sole conversation handle. */
export function buildWorkspaceSessionDirectory(input: {
  workspace: { id: string; tag: string }
  identities: readonly ResumeIdentityRecord[]
  interactiveFor(resumeId: string): SessionRecord | undefined
  latestExecutionFor(resumeId: string): HeadlessTaskRecord | null
  isActive(resumeId: string): boolean
}): WorkspaceSessionDirectory {
  return {
    workspace: input.workspace,
    sessions: input.identities.map((identity) => {
      const execution = input.latestExecutionFor(identity.resumeId)
      const interactive = input.interactiveFor(identity.resumeId)
      return {
        resumeId: identity.resumeId,
        agent: identity.agent,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        lifecycle: identity.lifecycle ?? 'active',
        ...(identity.successorResumeId ? { successorResumeId: identity.successorResumeId } : {}),
        resumable: identity.lifecycle !== 'retired' && Boolean(identity.agentSessionId),
        active: identity.lifecycle !== 'retired' && input.isActive(identity.resumeId),
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
                ...(interactive.title ? { title: interactive.title } : {}),
                state: interactive.state,
                lastActiveAt: interactive.lastActiveAt,
              },
            }
          : {}),
      }
    }),
  }
}
