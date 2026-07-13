import { tool } from 'ai'
import { z } from 'zod'

import type {
  WorkspaceConversationControl,
  WorkspaceConversationTask,
  WorkspaceConversationTarget,
  WorkspaceToolContext,
  WorkspaceToolFactory,
} from '../core/workspace-tool-center.js'
import type { HeadlessMessageBlock } from '../workspaces/headless-output.js'
import type { HeadlessInquirySubject } from '../workspaces/headless-task-registry.js'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_TIMEOUT_MS = 1_800_000
const MAX_PROMPT_CHARS = 16_000
const AWAIT_POLL_MS = 250

export const conversationAskCommonShape = {
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS)
    .describe('Question for the responsible Session or reconstructing worker.'),
  agent: z.string().min(1).optional()
    .describe('Optional runtime for reconstructed/fresh work only; exact Session runtime cannot be overridden.'),
  timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
    .describe(`Headless watchdog in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
  await: z.boolean().optional().default(false)
    .describe('Wait server-side for the final reply; on timeout, return the taskId for later await/read.'),
}

function taskProjection(task: WorkspaceConversationTask, mode: 'summary' | 'detailed') {
  const structured = task.structured
  const tools = structured?.blocks
    .filter((block): block is Extract<HeadlessMessageBlock, { type: 'tool' }> => block.type === 'tool')
    .map((block) => ({ name: block.name, status: block.status })) ?? []
  const errors = structured?.blocks
    .filter((block): block is Extract<HeadlessMessageBlock, { type: 'error' }> => block.type === 'error')
    .map((block) => block.message) ?? []
  const compactError = task.error ?? errors.at(-1)
  return {
    taskId: task.taskId,
    resumeId: task.resumeId,
    workspaceId: task.workspaceId,
    agent: task.agent,
    status: task.status,
    assistantText: structured?.assistantText ?? null,
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(compactError ? { error: compactError } : {}),
    ...(mode === 'detailed' ? {
      tools,
      errors,
      blocks: structured?.blocks ?? [],
    } : {}),
  }
}

async function awaitConversationTask(
  conversation: WorkspaceConversationControl,
  taskId: string,
  timeoutMs: number,
): Promise<WorkspaceConversationTask | null> {
  const deadline = Date.now() + timeoutMs
  let task = await conversation.read(taskId)
  while (task?.status === 'running') {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return task
    await new Promise((resolve) => setTimeout(resolve, Math.min(AWAIT_POLL_MS, remaining)))
    task = await conversation.read(taskId)
  }
  return task
}

export async function askWorkspaceConversation(
  ctx: WorkspaceToolContext,
  input: {
    prompt: string
    target: WorkspaceConversationTarget
    subject?: HeadlessInquirySubject
    agent?: string
    timeoutMs?: number
    await?: boolean
  },
) {
  if (!ctx.conversation) {
    return { ok: false as const, error: 'workspace conversation control is unavailable' }
  }
  try {
    const effectiveTimeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const result = await ctx.conversation.ask({
      prompt: input.prompt,
      target: input.target,
      timeoutMs: effectiveTimeoutMs,
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    })
    if (result.status === 'unavailable') {
      return {
        ok: false as const,
        status: result.status,
        resolution: { mode: result.resolution.mode, reason: result.resolution.reason },
      }
    }
    const dispatched = {
      ok: true as const,
      status: 'running' as const,
      taskId: result.taskId,
      resumeId: result.resumeId,
      workspaceId: result.workspaceId,
      workspace: result.workspace,
      agent: result.agent,
      resolution: result.resolution.mode === 'reconstructed'
        ? { mode: result.resolution.mode, reason: result.resolution.reason }
        : { mode: result.resolution.mode },
    }
    if (!input.await) return dispatched
    const task = await awaitConversationTask(ctx.conversation, result.taskId, effectiveTimeoutMs)
    if (!task) {
      return {
        ok: false as const,
        taskId: result.taskId,
        error: `conversation task disappeared while awaiting: ${result.taskId}`,
      }
    }
    return {
      ...dispatched,
      ...taskProjection(task, 'summary'),
      awaited: task.status !== 'running',
      ...(task.status === 'running'
        ? { next: `alice-workspace conversation await --task-id ${task.taskId}` }
        : {}),
    }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
}

export const conversationAskFactory: WorkspaceToolFactory = {
  name: 'conversation_ask',
  build(ctx) {
    return tool({
      description: [
        'Ask a known product Session, an Issue owner, or a fresh worker in one Workspace.',
        '',
        'Use exactly one addressing form: resumeId for an exact Session; issueId (optionally',
        'scoped by wsId) for Issue provenance; or wsId alone to recruit a fresh worker.',
        'The CLI exposes these as --resume-id, --issue-id, and --ws-id. It never requires',
        'callers to construct an internal target object.',
        '',
        'Prefer --await for one question: the server waits without shell sleep loops.',
        'Without --await the call returns a short taskId immediately, which lets several',
        'questions run concurrently before conversation_await collects their replies.',
      ].join('\n'),
      inputSchema: z.object({
        ...conversationAskCommonShape,
        resumeId: z.string().min(1).optional()
          .describe('Exact product Session to continue. Cannot be combined with wsId or issueId.'),
        wsId: z.string().min(1).optional()
          .describe('Workspace for a fresh worker, or optional scope for issueId.'),
        issueId: z.string().min(1).optional()
          .describe('Issue whose attributable Session should answer. Defaults to the current Workspace.'),
      }),
      execute: async ({ prompt, resumeId, wsId, issueId, agent, timeoutMs, await: shouldAwait = false }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        if (resumeId && (wsId || issueId)) {
          return {
            ok: false as const,
            error: 'choose one target: --resume-id, --issue-id [--ws-id], or --ws-id',
          }
        }
        if (!resumeId && !issueId && !wsId) {
          return {
            ok: false as const,
            error: 'provide --resume-id, --issue-id [--ws-id], or --ws-id',
          }
        }
        const target = resumeId
          ? { kind: 'resume' as const, resumeId }
          : issueId
            ? { kind: 'issue' as const, workspaceId: wsId ?? ctx.workspaceId, issueId }
            : { kind: 'workspace' as const, workspaceId: wsId! }
        return askWorkspaceConversation(ctx, {
          prompt,
          target,
          ...(agent ? { agent } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
          await: shouldAwait,
        })
      },
    })
  },
}

export const conversationAwaitFactory: WorkspaceToolFactory = {
  name: 'conversation_await',
  build(ctx) {
    return tool({
      description: [
        'Wait server-side for one conversation task to finish.',
        '',
        'Use after dispatching several conversation_ask calls so their headless runs execute',
        'concurrently. This replaces hand-written sleep loops. If the wait budget expires,',
        'the task remains running and can be awaited again or inspected with conversation_read.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('Short taskId returned by conversation_ask.'),
        timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
          .describe(`Server-side wait budget in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
      }),
      execute: async ({ taskId, timeoutMs }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const task = await awaitConversationTask(
            ctx.conversation,
            taskId,
            timeoutMs ?? DEFAULT_TIMEOUT_MS,
          )
          if (!task) return { ok: false as const, error: `conversation task not found: ${taskId}` }
          return {
            ok: true as const,
            ...taskProjection(task, 'summary'),
            awaited: task.status !== 'running',
            ...(task.status === 'running'
              ? { next: `alice-workspace conversation read --task-id ${task.taskId}` }
              : {}),
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const conversationCollectFactory: WorkspaceToolFactory = {
  name: 'conversation_collect',
  build(ctx) {
    return tool({
      description: [
        'Collect several already-dispatched conversation tasks in one server-side wait.',
        '',
        'Repeat --task-id for every peer. Tasks keep running concurrently; this command',
        'waits for all of them and returns compact final replies in the same order.',
        'It does not ask another model to summarize or merge the answers.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.array(z.string().min(1)).min(1).max(32)
          .describe('Task id to collect. Repeat --task-id for multiple concurrent peers.'),
        timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
          .describe(`Server-side wait budget per task in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
      }),
      execute: async ({ taskId, timeoutMs }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const ids = [...new Set(taskId)]
          const tasks = await Promise.all(ids.map((id) => awaitConversationTask(
            ctx.conversation!,
            id,
            timeoutMs ?? DEFAULT_TIMEOUT_MS,
          )))
          const results = tasks.map((task, index) => task
            ? {
                ok: true as const,
                ...taskProjection(task, 'summary'),
                awaited: task.status !== 'running',
              }
            : {
                ok: false as const,
                taskId: ids[index]!,
                error: `conversation task not found: ${ids[index]}`,
              })
          const running = results.filter((result) => result.ok && result.status === 'running').length
          const failed = results.filter((result) => result.ok && (
            result.status === 'failed' || result.status === 'interrupted'
          )).length
          const missing = results.filter((result) => !result.ok).length
          return {
            ok: missing === 0,
            complete: missing === 0 && running === 0,
            count: results.length,
            running,
            failed,
            missing,
            results,
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const conversationReadFactory: WorkspaceToolFactory = {
  name: 'conversation_read',
  build(ctx) {
    return tool({
      description: [
        'Read one headless follow-up started by conversation_ask.',
        '',
        'Summary returns the latest assistant reply and one compact failure when present.',
        'Tool activity and normalized message blocks are available only in detailed mode.',
        'Running tasks may have partial output.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('taskId returned by conversation_ask.'),
        mode: z.enum(['summary', 'detailed']).optional().default('summary'),
      }),
      execute: async ({ taskId, mode }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const task = await ctx.conversation.read(taskId)
          if (!task) return { ok: false as const, error: `conversation task not found: ${taskId}` }
          return {
            ok: true as const,
            ...taskProjection(task, mode),
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const conversationToolFactories: WorkspaceToolFactory[] = [
  conversationAskFactory,
  conversationAwaitFactory,
  conversationCollectFactory,
  conversationReadFactory,
]
