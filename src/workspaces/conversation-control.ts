import { readFile } from 'node:fs/promises'

import type {
  WorkspaceConversationControl,
  WorkspaceConversationTask,
} from '../core/workspace-tool-center.js'
import { isAgentRuntime } from './cli-adapter.js'
import type { HeadlessStructuredOutput } from './headless-output.js'
import { headlessLogPaths } from './headless-task-registry.js'
import type { WorkspaceService } from './service.js'

export function createWorkspaceConversationControl(
  svc: WorkspaceService,
): WorkspaceConversationControl {
  return {
    async ask(input) {
      const identity = input.resumeId ? svc.resumeRegistry.get(input.resumeId) : null
      if (input.resumeId && !identity) {
        throw new Error(`resume conversation not found: ${input.resumeId}`)
      }

      const wsId = identity?.wsId ?? input.workspaceId
      if (!wsId) throw new Error('resumeId or workspaceId is required')
      const meta = svc.registry.get(wsId)
      if (!meta) throw new Error(`workspace not found: ${wsId}`)

      if (identity && input.agent) {
        throw new Error('agent cannot override the runtime of an existing conversation')
      }
      const agentId = identity?.agent ?? input.agent ?? await svc.resolveDefaultAgentId(meta)
      if (!agentId) throw new Error(`workspace has no agent runtime: ${meta.tag}`)
      if (!identity && !meta.agents.includes(agentId)) {
        throw new Error(`agent "${agentId}" is not enabled on workspace ${meta.tag}`)
      }
      const adapter = svc.adapters.get(agentId)
      if (!adapter || !isAgentRuntime(adapter)) {
        throw new Error(`unknown agent runtime: ${agentId}`)
      }
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        throw new Error(`agent runtime has no headless mode: ${agentId}`)
      }

      await adapter.bootstrap?.({
        wsId: meta.id,
        cwd: meta.dir,
        launcherRepoRoot: svc.config.launcherRepoRoot,
      })
      const dispatched = await svc.dispatchHeadlessTask(
        meta,
        adapter,
        input.prompt,
        input.timeoutMs,
        undefined,
        identity?.resumeId,
      )
      return {
        ...dispatched,
        workspaceId: meta.id,
        workspace: meta.tag,
        agent: adapter.id,
        continued: identity !== null,
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
        ...(task.issueId ? { issueId: task.issueId } : {}),
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
