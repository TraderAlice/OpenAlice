import type { HeadlessTaskRecord, HeadlessTaskStatus } from './headless-task-registry.js'
import {
  sessionPresence,
  type ResumeIdentityRecord,
  type SessionPresence,
} from './resume-registry.js'
import { sessionPreferredTitle, type SessionRecord } from './session-registry.js'
import type { SessionCreatedBy } from './session-metadata.js'
import type { ModelReasoningEffort } from '@/ai-providers/model-semantics.js'

export interface WorkspaceSessionDirectoryEntry {
  resumeId: string
  agent: string
  createdAt: number
  updatedAt: number
  lifecycle: ResumeIdentityRecord['lifecycle']
  successorResumeId?: string
  /** Missing means active. */
  presence?: SessionPresence
  resumable: boolean
  active: boolean
  /** Secret-free birth stamp when this product Session was first allocated. */
  createdBy?: SessionCreatedBy
  runtime?: {
    credentialSource: 'native' | 'vault' | 'workspace'
    credentialSlug?: string
    model?: string
    reasoningEffort?: ModelReasoningEffort
  }
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
      const interactiveTitle = interactive ? sessionPreferredTitle(interactive) : undefined
      return {
        resumeId: identity.resumeId,
        agent: identity.agent,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        lifecycle: identity.lifecycle ?? 'active',
        ...(identity.successorResumeId ? { successorResumeId: identity.successorResumeId } : {}),
        ...(sessionPresence(identity) !== 'active' ? { presence: sessionPresence(identity) } : {}),
        resumable: identity.lifecycle !== 'retired'
          && sessionPresence(identity) !== 'deleted'
          && Boolean(identity.agentSessionId),
        active: identity.lifecycle !== 'retired' && input.isActive(identity.resumeId),
        ...(identity.metadata?.createdBy ? { createdBy: identity.metadata.createdBy } : {}),
        ...(identity.runtimeBinding
          ? {
              runtime: {
                credentialSource: identity.runtimeBinding.credential.source,
                ...(identity.runtimeBinding.credential.source === 'vault'
                  ? { credentialSlug: identity.runtimeBinding.credential.credentialSlug }
                  : {}),
                ...(identity.runtimeBinding.model ? { model: identity.runtimeBinding.model } : {}),
                ...(identity.runtimeBinding.reasoningEffort
                  ? { reasoningEffort: identity.runtimeBinding.reasoningEffort }
                  : {}),
              },
            }
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
