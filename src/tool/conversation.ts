import { tool } from 'ai'
import { z } from 'zod'

import type {
  WorkspaceConversationControl,
  WorkspaceConversationTask,
  WorkspaceConversationTarget,
  WorkspaceToolContext,
  WorkspaceToolFactory,
} from '../core/workspace-tool-center.js'
import { sessionOriginFromInboxOrigin } from '../core/provenance-store.js'
import type { HeadlessMessageBlock } from '../workspaces/headless-output.js'
import type { HeadlessInquirySubject } from '../workspaces/headless-task-registry.js'

const MAX_TIMEOUT_MS = 2_147_478_647
const MAX_PROMPT_CHARS = 16_000
const AWAIT_POLL_MS = 250

export const conversationAskCommonShape = {
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS)
    .describe('Question for the responsible Session or reconstructing worker.'),
  agent: z.string().min(1).optional()
    .describe('Optional runtime for reconstructed/fresh work only; exact Session runtime cannot be overridden.'),
  timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
    .describe('Optional headless watchdog in milliseconds. Omit to allow the Session to run without a time limit.'),
  await: z.boolean().optional().default(false)
    .describe('Wait server-side for a reply needed now; omit for asynchronous delegation and use the returned taskId later.'),
  reconstruct: z.boolean().optional().default(false)
    .describe('Explicitly add artifact-reconstruction guidance if OpenAlice must recruit a fallback worker.'),
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
  timeoutMs?: number,
): Promise<WorkspaceConversationTask | null> {
  const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs
  let task = await conversation.read(taskId)
  while (task?.status === 'running') {
    const remaining = deadline === null ? AWAIT_POLL_MS : deadline - Date.now()
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
    reconstruct?: boolean
  },
) {
  if (!ctx.conversation) {
    return { ok: false as const, error: 'workspace conversation control is unavailable' }
  }
  try {
    const result = await ctx.conversation.ask({
      prompt: input.prompt,
      target: input.target,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      source: sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin) ?? {
        kind: 'workspace',
        workspaceId: ctx.workspaceId,
      },
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.reconstruct ? { reconstruct: true } : {}),
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
    const task = await awaitConversationTask(ctx.conversation, result.taskId, input.timeoutMs)
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

export async function resolveInboxConversationAddress(
  ctx: WorkspaceToolContext,
  inboxEntryId: string,
): Promise<{
  target: WorkspaceConversationTarget
  subject: Extract<HeadlessInquirySubject, { kind: 'inbox' }>
} | { error: string }> {
  const entry = await ctx.inboxStore.get(inboxEntryId)
  if (!entry) return { error: `inbox entry not found: ${inboxEntryId}` }
  const origin = ctx.resolveInboxOrigin?.(entry) ?? entry.origin
  const sessionOrigin = sessionOriginFromInboxOrigin(entry.workspaceId, origin)
  return {
    target: sessionOrigin
      ? { kind: 'resume', resumeId: sessionOrigin.resumeId }
      : {
          kind: 'inbox',
          inboxEntryId: entry.id,
          workspaceId: entry.workspaceId,
        },
    subject: { kind: 'inbox', entryId: entry.id },
  }
}

export const conversationAskFactory: WorkspaceToolFactory = {
  name: 'conversation_ask',
  build(ctx) {
    return tool({
      description: [
        "Ask a known product Session, an Inbox sender, an Issue's attributable creator, or a fresh worker.",
        '',
        'Use exactly one addressing form: resumeId for an exact Session; inboxId for the',
        'sender of one delivery; issueId (optionally scoped by wsId) for Issue creation',
        'provenance; wsId for a fresh worker in an exact desk; or harness for a fresh',
        'worker in the current default Chat/AutoQuant desk.',
        '',
        'Use --await when this turn needs the reply. Without it, the call returns a',
        'short taskId immediately for delegated work or several concurrent questions;',
        'retrieve those replies later with conversation_read/await/collect.',
        '',
        'Prompts are delivered unchanged by default. Use --reconstruct only when the',
        'intent is to have a fresh worker reconstruct an artifact whose author is absent.',
      ].join('\n'),
      inputSchema: z.object({
        ...conversationAskCommonShape,
        resumeId: z.string().min(1).optional()
          .describe('Exact product Session to continue. Cannot be combined with another target flag.'),
        inboxId: z.string().min(1).optional()
          .describe('Inbox entry whose attributable sender should answer; unattributed entries fall back only to their source Workspace.'),
        wsId: z.string().min(1).optional()
          .describe('Workspace for a fresh worker, or optional scope for issueId.'),
        issueId: z.string().min(1).optional()
          .describe("Issue whose attributable creator should answer. Defaults to the current Workspace; use `issue ask --owner` for the declared owner."),
        harness: z.enum(['chat', 'autoquant']).optional()
          .describe('Create a fresh Session in the default `chat` or `autoquant` Workspace.'),
      }),
      execute: async ({
        prompt,
        resumeId,
        inboxId,
        wsId,
        issueId,
        harness,
        agent,
        timeoutMs,
        await: shouldAwait = false,
        reconstruct = false,
      }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        const targetCount = Number(Boolean(resumeId))
          + Number(Boolean(inboxId))
          + Number(Boolean(issueId))
          + Number(Boolean(harness))
          + Number(Boolean(wsId && !issueId))
        if (targetCount !== 1) {
          return {
            ok: false as const,
            error: 'choose exactly one target: --resume-id, --inbox-id, --issue-id [--ws-id], --ws-id, or --harness',
          }
        }
        const inboxAddress = inboxId
          ? await resolveInboxConversationAddress(ctx, inboxId)
          : null
        if (inboxAddress && 'error' in inboxAddress) {
          return { ok: false as const, error: inboxAddress.error }
        }
        const target = inboxAddress
          ? inboxAddress.target
          : resumeId
          ? { kind: 'resume' as const, resumeId }
          : issueId
            ? { kind: 'issue' as const, workspaceId: wsId ?? ctx.workspaceId, issueId }
            : harness
              ? { kind: 'harness' as const, harness }
              : { kind: 'workspace' as const, workspaceId: wsId! }
        const result = await askWorkspaceConversation(ctx, {
          prompt,
          target,
          ...(inboxAddress ? { subject: inboxAddress.subject } : {}),
          ...(agent ? { agent } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          await: shouldAwait,
          reconstruct,
        })
        return inboxAddress
          ? { subject: { kind: 'inbox' as const, id: inboxAddress.subject.entryId }, ...result }
          : result
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
        'concurrently. This replaces hand-written sleep loops. With an explicit wait budget,',
        'an expired wait returns while the task keeps running; without one, this waits until',
        'the task reaches a terminal state.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('Short taskId returned by conversation_ask.'),
        timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
          .describe('Optional server-side wait budget in milliseconds. Omit to wait until the task finishes.'),
      }),
      execute: async ({ taskId, timeoutMs }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const task = await awaitConversationTask(ctx.conversation, taskId, timeoutMs)
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
          .describe('Optional server-side wait budget per task in milliseconds. Omit to wait until every task finishes.'),
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
            timeoutMs,
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
        mode: z.enum(['summary', 'detailed']).optional().default('summary')
          .describe('`summary` returns status and assistant text; `detailed` also returns normalized tool, error, and message blocks.'),
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
