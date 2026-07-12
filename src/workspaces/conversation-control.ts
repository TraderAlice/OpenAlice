import { readFile } from 'node:fs/promises'

import type {
  WorkspaceConversationAskResult,
  WorkspaceConversationControl,
  WorkspaceConversationResolution,
  WorkspaceConversationTarget,
  WorkspaceConversationTask,
} from '../core/workspace-tool-center.js'
import type { ArtifactRef, ProvenanceAction, SessionOrigin } from '../core/provenance-store.js'
import { isAgentRuntime } from './cli-adapter.js'
import type { HeadlessStructuredOutput } from './headless-output.js'
import { headlessLogPaths } from './headless-task-registry.js'
import { logger as launcherLogger } from './logger.js'
import type { WorkspaceService } from './service.js'

interface ArtifactTarget {
  artifact: ArtifactRef
  action: ProvenanceAction
  fallbackWorkspaceId?: string
}

function artifactTarget(target: WorkspaceConversationTarget): ArtifactTarget | null {
  if (target.kind === 'inbox') {
    return {
      artifact: { kind: 'inbox', inboxEntryId: target.inboxEntryId },
      action: 'sent',
      ...(target.workspaceId ? { fallbackWorkspaceId: target.workspaceId } : {}),
    }
  }
  if (target.kind === 'issue') {
    return {
      artifact: { kind: 'issue', workspaceId: target.workspaceId, issueId: target.issueId },
      action: target.action ?? 'created',
      fallbackWorkspaceId: target.workspaceId,
    }
  }
  if (target.kind === 'report') {
    return {
      artifact: {
        kind: 'report',
        workspaceId: target.workspaceId,
        path: target.path,
        ...(target.revision ? { revision: target.revision } : {}),
      },
      action: target.action ?? 'sent',
      fallbackWorkspaceId: target.workspaceId,
    }
  }
  if (target.kind === 'trade-decision') {
    return {
      artifact: {
        kind: 'trade-decision',
        accountId: target.accountId,
        decisionId: target.decisionId,
      },
      action: 'decided',
      ...(target.workspaceId ? { fallbackWorkspaceId: target.workspaceId } : {}),
    }
  }
  return null
}

function sessionOrigin(identity: { resumeId: string; wsId: string; agent: string }): SessionOrigin {
  return {
    kind: 'session',
    workspaceId: identity.wsId,
    resumeId: identity.resumeId,
    agent: identity.agent,
  }
}

function unavailableWorkspaceReason(
  svc: WorkspaceService,
  workspaceId: string,
): 'departed-workspace' | 'purged-workspace' | 'deleted-workspace' {
  const lifecycle = svc.catalog.get(workspaceId)?.lifecycle
  if (lifecycle === 'purged' || lifecycle === 'purging') return 'purged-workspace'
  if (lifecycle && lifecycle !== 'active') return 'departed-workspace'
  return 'deleted-workspace'
}

function exactResolution(
  svc: WorkspaceService,
  origin: SessionOrigin,
  artifact?: ArtifactRef,
): WorkspaceConversationResolution {
  const identity = svc.resumeRegistry.get(origin.resumeId)
  if (!identity) {
    return { mode: 'unavailable', reason: 'missing-session', attributedOrigin: origin, ...(artifact ? { artifact } : {}) }
  }
  if (identity.lifecycle === 'retired') {
    return { mode: 'unavailable', reason: 'retired-session', attributedOrigin: origin, ...(artifact ? { artifact } : {}) }
  }
  if (!svc.registry.get(identity.wsId)) {
    return {
      mode: 'unavailable',
      reason: unavailableWorkspaceReason(svc, identity.wsId),
      attributedOrigin: origin,
      ...(artifact ? { artifact } : {}),
    }
  }
  if (!identity.agentSessionId) {
    return { mode: 'unavailable', reason: 'missing-native-session', attributedOrigin: origin, ...(artifact ? { artifact } : {}) }
  }
  const authoritativeOrigin: SessionOrigin = {
    ...sessionOrigin(identity),
    ...(origin.execution ? { execution: origin.execution } : {}),
  }
  return {
    mode: 'exact',
    origin: authoritativeOrigin,
    ...(artifact ? { artifact } : {}),
  }
}

export function resolveWorkspaceConversationTarget(
  svc: WorkspaceService,
  target: WorkspaceConversationTarget,
): WorkspaceConversationResolution {
  if (target.kind === 'resume') {
    const identity = svc.resumeRegistry.get(target.resumeId)
    if (!identity) return { mode: 'unavailable', reason: 'missing-session' }
    return exactResolution(svc, sessionOrigin(identity))
  }
  if (target.kind === 'workspace') {
    return svc.registry.get(target.workspaceId)
      ? { mode: 'reconstructed', workspaceId: target.workspaceId, reason: 'explicit-workspace' }
      : { mode: 'unavailable', reason: unavailableWorkspaceReason(svc, target.workspaceId) }
  }

  const resolvedTarget = artifactTarget(target)
  if (!resolvedTarget) return { mode: 'unavailable', reason: 'missing-workspace' }
  const record = svc.provenanceStore.latest({
    artifact: resolvedTarget.artifact,
    action: resolvedTarget.action,
  })
  if (record?.origin.kind === 'session') {
    return exactResolution(svc, record.origin, resolvedTarget.artifact)
  }
  const priorReconstruction = svc.provenanceStore.latest({
    artifact: resolvedTarget.artifact,
    action: 'reconstructed',
  })
  let reconstructionUnavailable = false
  if (priorReconstruction?.origin.kind === 'session') {
    const prior = exactResolution(svc, priorReconstruction.origin, resolvedTarget.artifact)
    if (prior.mode === 'exact') {
      return {
        mode: 'reconstructed',
        workspaceId: prior.origin.workspaceId,
        reason: 'prior-reconstruction',
        origin: prior.origin,
        artifact: resolvedTarget.artifact,
      }
    }
    reconstructionUnavailable = true
  }
  const fallbackWorkspaceId = resolvedTarget.fallbackWorkspaceId
  if (!fallbackWorkspaceId) {
    return {
      mode: 'unavailable',
      reason: 'missing-workspace',
      artifact: resolvedTarget.artifact,
    }
  }
  if (!svc.registry.get(fallbackWorkspaceId)) {
    return {
      mode: 'unavailable',
      reason: unavailableWorkspaceReason(svc, fallbackWorkspaceId),
      artifact: resolvedTarget.artifact,
    }
  }
  return {
    mode: 'reconstructed',
    workspaceId: fallbackWorkspaceId,
    reason: reconstructionUnavailable
      ? 'unavailable-reconstruction'
      : record
        ? 'non-session-origin'
        : 'missing-origin',
    artifact: resolvedTarget.artifact,
  }
}

function reconstructionPrompt(
  target: WorkspaceConversationTarget,
  prompt: string,
  continuing: boolean,
): string {
  return [
    continuing
      ? 'You are continuing as the reconstruction analyst for this artifact, not the original author.'
      : 'You are a fresh worker reconstructing a follow-up, not the original author.',
    `Target: ${JSON.stringify(target)}`,
    'Answer the question directly. Inspect only the Workspace evidence needed for this question; do not inventory or broadly search by default.',
    'If the named artifact is missing, say so once and distinguish recovered facts from inference.',
    '',
    `Question: ${prompt}`,
  ].join('\n')
}

export function createWorkspaceConversationControl(
  svc: WorkspaceService,
): WorkspaceConversationControl {
  return {
    async ask(input): Promise<WorkspaceConversationAskResult> {
      const resolution = resolveWorkspaceConversationTarget(svc, input.target)
      if (resolution.mode === 'unavailable') return { status: 'unavailable', resolution }

      const continuingOrigin = resolution.origin
      const wsId = continuingOrigin?.workspaceId ?? (
        resolution.mode === 'reconstructed' ? resolution.workspaceId : ''
      )
      const meta = svc.registry.get(wsId)
      if (!meta) {
        return {
          status: 'unavailable',
          resolution: {
            mode: 'unavailable',
            reason: unavailableWorkspaceReason(svc, wsId),
            ...(resolution.artifact ? { artifact: resolution.artifact } : {}),
            ...(resolution.mode === 'exact' ? { attributedOrigin: resolution.origin } : {}),
          },
        }
      }

      if (continuingOrigin && input.agent) {
        throw new Error('agent cannot override the runtime of an existing Session')
      }
      const agentId = continuingOrigin
        ? continuingOrigin.agent
        : input.agent ?? await svc.resolveDefaultAgentId(meta)
      if (!agentId) throw new Error(`workspace has no agent runtime: ${meta.tag}`)
      if (resolution.mode === 'reconstructed' && !continuingOrigin && !meta.agents.includes(agentId)) {
        throw new Error(`agent "${agentId}" is not enabled on workspace ${meta.tag}`)
      }
      const adapter = svc.adapters.get(agentId)
      if (!adapter || !isAgentRuntime(adapter)) throw new Error(`unknown agent runtime: ${agentId}`)
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        throw new Error(`agent runtime has no headless mode: ${agentId}`)
      }

      await adapter.bootstrap?.({
        wsId: meta.id,
        cwd: meta.dir,
        launcherRepoRoot: svc.config.launcherRepoRoot,
      })
      const prompt = resolution.mode === 'exact'
        ? input.prompt
        : reconstructionPrompt(input.target, input.prompt, Boolean(continuingOrigin))
      const inquiry = input.subject
        ? {
            subject: input.subject,
            question: input.prompt,
            resolution: {
              mode: resolution.mode,
              ...(resolution.mode === 'reconstructed' ? { reason: resolution.reason } : {}),
            },
          }
        : undefined
      const dispatched = inquiry
        ? await svc.dispatchHeadlessTask(
            meta, adapter, prompt, input.timeoutMs, undefined, continuingOrigin?.resumeId, inquiry,
          )
        : await svc.dispatchHeadlessTask(
            meta, adapter, prompt, input.timeoutMs, undefined, continuingOrigin?.resumeId,
          )
      let effectiveResolution = resolution
      if (resolution.mode === 'reconstructed' && resolution.artifact && !resolution.origin) {
        const origin: SessionOrigin = {
          kind: 'session',
          workspaceId: meta.id,
          resumeId: dispatched.resumeId,
          agent: adapter.id,
          execution: { kind: 'headless', taskId: dispatched.taskId },
        }
        effectiveResolution = { ...resolution, origin }
        try {
          await svc.provenanceStore.append({
            artifact: resolution.artifact,
            action: 'reconstructed',
            origin,
            at: Date.now(),
            fingerprint: `artifact-reconstruction:${dispatched.taskId}`,
          })
        } catch (err) {
          launcherLogger.warn('conversation_reconstruction_provenance.append_failed', { err })
        }
      }
      return {
        status: 'dispatched',
        ...dispatched,
        workspaceId: meta.id,
        workspace: meta.tag,
        agent: adapter.id,
        resolution: effectiveResolution,
      }
    },

    async read(taskId) {
      const task = svc.headlessTasks.get(taskId)
      if (!task) return null
      const structured = await readStructuredSnapshot(
        headlessLogPaths(svc.headlessLogsDir, taskId).structured,
      )
      const result: WorkspaceConversationTask = {
        taskId: task.taskId,
        resumeId: task.resumeId,
        workspaceId: task.wsId,
        agent: task.agent,
        status: task.status,
        startedAt: task.startedAt,
        structured,
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.trigger?.kind === 'issue' ? { issueId: task.trigger.issueId } : {}),
        ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
        ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
        ...(task.error ? { error: task.error } : {}),
      }
      return result
    },
  }
}

async function readStructuredSnapshot(path: string): Promise<HeadlessStructuredOutput | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as HeadlessStructuredOutput
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.blocks)) return null
    return parsed
  } catch {
    return null
  }
}
