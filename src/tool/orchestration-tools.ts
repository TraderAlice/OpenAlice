/**
 * Orchestration control-plane tools — Orca-style worker dispatch, ask/reply,
 * worker-done reporting, follow-up steering, and mailbox inspection.
 *
 * Caller identity (`resumeId` / `workspaceId`) is resolved server-side from
 * `WorkspaceToolContext` so agents never spoof or traffic their own Session id.
 */
import { tool } from 'ai'
import { z } from 'zod'

import { MODEL_REASONING_EFFORTS } from '../ai-providers/model-semantics.js'
import { sessionOriginFromInboxOrigin } from '../core/provenance-store.js'
import type {
  WorkspaceToolContext,
  WorkspaceToolFactory,
} from '../core/workspace-tool-center.js'
import {
  OrchestrationError,
  type OrchestrationDeliverable,
  type OrchestrationMessage,
  type WorkerListItem,
} from '../workspaces/orchestration/index.js'

const MAX_TEXT_CHARS = 32_000

const ORCHESTRATION_UNAVAILABLE_ERROR =
  'Orchestration control plane is unavailable in this context.'
const SESSION_REQUIRED_ERROR =
  'Orchestration requires an active OpenAlice Session identity.'

const deliverableObjectSchema = z.object({
  path: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).optional(),
})

const deliverableInputSchema = z.union([
  deliverableObjectSchema,
  z.string().trim().min(1),
])

type DeliverableInput = z.infer<typeof deliverableInputSchema>

export function stripDispatchPrefix(raw: string): string {
  const trimmed = raw.trim()
  const stripped = trimmed.replace(/^dispatch:/i, '').trim()
  return stripped
}

function resolveCallerResumeId(ctx: WorkspaceToolContext): string | null {
  return (
    sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin)?.resumeId ??
    ctx.origin?.resumeId ??
    null
  )
}

function errorResponse(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof OrchestrationError) {
    return { ok: false as const, code: err.code, error: err.message }
  }
  return {
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }
}

function parseDeliverableItem(item: DeliverableInput): OrchestrationDeliverable {
  if (typeof item === 'string') {
    const trimmed = item.trim()
    if (!trimmed) {
      throw new OrchestrationError('invalid_input', 'Deliverable path must be non-empty.')
    }
    if (trimmed.startsWith('{')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        throw new OrchestrationError('invalid_input', `Invalid deliverable JSON: ${trimmed}`)
      }
      const checked = deliverableObjectSchema.safeParse(parsed)
      if (!checked.success) {
        throw new OrchestrationError(
          'invalid_input',
          `Invalid deliverable object: ${checked.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return checked.data
    }
    return { path: trimmed }
  }
  return {
    path: item.path,
    ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
  }
}

function normalizeDeliverables(
  deliverables: DeliverableInput[] | string | undefined,
  deliverable: DeliverableInput[] | undefined,
): OrchestrationDeliverable[] | undefined {
  const out: OrchestrationDeliverable[] = []

  if (deliverables !== undefined) {
    if (typeof deliverables === 'string') {
      const trimmed = deliverables.trim()
      if (!trimmed) {
        throw new OrchestrationError('invalid_input', 'deliverables must be non-empty.')
      }
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          throw new OrchestrationError('invalid_input', 'deliverables contains malformed JSON.')
        }
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const raw of items) {
          const checked = deliverableInputSchema.safeParse(raw)
          if (!checked.success) {
            throw new OrchestrationError(
              'invalid_input',
              `Invalid deliverable entry: ${checked.error.issues.map((i) => i.message).join('; ')}`,
            )
          }
          out.push(parseDeliverableItem(checked.data))
        }
      } else {
        out.push({ path: trimmed })
      }
    } else {
      for (const item of deliverables) {
        out.push(parseDeliverableItem(item))
      }
    }
  }

  if (deliverable !== undefined) {
    for (const item of deliverable) {
      out.push(parseDeliverableItem(item))
    }
  }

  return out.length > 0 ? out : undefined
}

function projectWorkerItem(item: WorkerListItem) {
  const { task } = item
  return {
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    status: task.status,
    live: item.live,
    turnCount: task.turnCount,
    parentResumeId: task.parentResumeId,
    parentWorkspaceId: task.parentWorkspaceId,
    workerResumeId: task.workerResumeId,
    workerWorkspaceId: task.workerWorkspaceId,
    workerAgent: task.workerAgent,
    ...(task.headlessTaskId ? { headlessTaskId: task.headlessTaskId } : {}),
    ...(task.outcome ? { outcome: task.outcome } : {}),
    ...(task.summary ? { summary: task.summary } : {}),
    ...(task.evidence ? { evidence: task.evidence } : {}),
    ...(task.deliverables ? { deliverables: task.deliverables } : {}),
    ...(task.stopReason ? { stopReason: task.stopReason } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.settledAt !== undefined ? { settledAt: task.settledAt } : {}),
    pendingQuestions: item.pendingQuestions.map((q) => ({
      id: q.id,
      ...(q.subject ? { subject: q.subject } : {}),
      body: q.body,
      createdAt: q.createdAt,
    })),
    unreadMessagesForParent: item.unreadMessagesForParent,
    queuedMessagesForWorker: item.queuedMessagesForWorker,
    nextAction: item.nextAction,
  }
}

function checkNextHint(messages: readonly OrchestrationMessage[]): string {
  const question = messages.find((m) => m.kind === 'question')
  if (question) {
    return `Answer pending question with: alice orchestration reply --id ${question.id} --body "<answer>"`
  }
  const escalation = messages.find((m) => m.kind === 'escalation')
  if (escalation) {
    return `Steer or resume escalated worker with: alice orchestration send --to dispatch:${escalation.dispatchId} --body "<instructions>"`
  }
  if (messages.length > 0) {
    return 'Pending orchestration messages acknowledged.'
  }
  return 'No pending orchestration messages. Use `alice orchestration inbox` for history or `alice orchestration worker-list` for active workers.'
}

export const orchestrationWorkerStartFactory: WorkspaceToolFactory = {
  name: 'orchestration_worker_start',
  build(ctx) {
    return tool({
      description: [
        'Dispatch a background orchestration worker with a strict Orca worker contract.',
        '',
        'The worker receives the task spec and MUST end its turn via `alice orchestration ask` or `alice orchestration worker-done`.',
        'After calling worker-start, end your turn and wait — OpenAlice wakes you automatically on question, escalation, or completion.',
      ].join('\n'),
      inputSchema: z.object({
        spec: z.string().trim().min(1).max(MAX_TEXT_CHARS)
          .describe('Complete task specification for the worker (inline cross-workspace file context when needed).'),
        harness: z.enum(['chat', 'autoquant', 'prediction']).optional()
          .describe('Target Harness Workspace (chat, autoquant, or prediction). Mutually exclusive with wsId.'),
        wsId: z.string().trim().min(1).optional()
          .describe('Explicit target Workspace id. Defaults to caller Workspace; mutually exclusive with harness.'),
        agent: z.string().trim().min(1).optional()
          .describe('Optional agent runtime id (e.g. codex, claude, pi).'),
        credential: z.string().trim().min(1).optional()
          .describe('Vault credential slug. Mutually exclusive with credentialSource.'),
        credentialSource: z.literal('native').optional()
          .describe('Use the runtime native login. Mutually exclusive with credential.'),
        model: z.string().trim().min(1).optional()
          .describe('Optional model id, or "default" to use the runtime default.'),
        effort: z.enum(MODEL_REASONING_EFFORTS).optional()
          .describe('Optional reasoning effort level.'),
        maxIdleMs: z.coerce.number().int().positive().optional()
          .describe('Optional stall watchdog budget in milliseconds before escalating as "stalled".'),
      }),
      execute: async (input) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        if (input.wsId && input.harness) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'Specify either --ws-id or --harness, not both.',
          }
        }
        if (input.credential && input.credentialSource) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'credential and credentialSource are mutually exclusive.',
          }
        }
        try {
          const res = await ctx.orchestration.workerStart({
            parentResumeId: callerResumeId,
            parentWorkspaceId: ctx.workspaceId,
            spec: input.spec,
            ...(input.wsId ? { workspaceId: input.wsId } : {}),
            ...(input.harness ? { harness: input.harness } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.credential ? { credential: input.credential } : {}),
            ...(input.credentialSource ? { credentialSource: input.credentialSource } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.maxIdleMs !== undefined ? { maxIdleMs: input.maxIdleMs } : {}),
          })
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            status: res.task.status,
            headlessTaskId: res.headlessTaskId,
            workerResumeId: res.workerResumeId,
            workerWorkspaceId: res.workerWorkspaceId,
            workerWorkspaceTag: res.workerWorkspaceTag,
            workerAgent: res.workerAgent,
            next: `Worker dispatched (${res.task.dispatchId}). End your current turn now and wait — OpenAlice will automatically wake you when it asks a question, escalates, or calls worker-done. Do not sleep or poll in a loop.`,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationWorkerListFactory: WorkspaceToolFactory = {
  name: 'orchestration_worker_list',
  build(ctx) {
    return tool({
      description: 'List orchestrated worker dispatches with live status, pending questions, and next-action hints.',
      inputSchema: z.object({
        status: z.enum(['running', 'waiting_parent', 'done', 'failed', 'stopped']).optional()
          .describe('Filter by dispatch status.'),
        dispatch: z.string().trim().min(1).optional()
          .describe('Filter to a single dispatchId (accepts dispatch:<id> or raw <id>).'),
        limit: z.coerce.number().int().min(1).max(200).optional()
          .describe('Maximum dispatches to return (default 50).'),
      }),
      execute: async ({ status, dispatch, limit = 50 }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        const dispatchId = dispatch ? stripDispatchPrefix(dispatch) : undefined
        if (dispatch && !dispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'dispatch must contain a non-empty dispatchId.',
          }
        }
        try {
          const items = ctx.orchestration.workerList({
            ...(dispatchId
              ? { dispatchId }
              : callerResumeId
                ? { parentResumeId: callerResumeId }
                : {}),
            ...(status ? { status } : {}),
            limit,
          })
          const workers = items.map(projectWorkerItem)
          return {
            ok: true as const,
            count: workers.length,
            workers,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationWorkerStopFactory: WorkspaceToolFactory = {
  name: 'orchestration_worker_stop',
  build(ctx) {
    return tool({
      description: 'Stop an orchestrated worker dispatch cleanly without triggering a failure escalation.',
      inputSchema: z.object({
        dispatch: z.string().trim().min(1)
          .describe('Dispatch id to stop (accepts dispatch:<id> or raw <id>).'),
        reason: z.string().trim().min(1).max(500).optional()
          .describe('Optional stop reason (default "stopped_by_coordinator").'),
      }),
      execute: async ({ dispatch, reason }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const dispatchId = stripDispatchPrefix(dispatch)
        if (!dispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'dispatch must contain a non-empty dispatchId.',
          }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        const existing = ctx.orchestration.getTask(dispatchId)
        if (callerResumeId && existing && existing.parentResumeId !== callerResumeId) {
          return {
            ok: false as const,
            code: 'unauthorized' as const,
            error: `Session ${callerResumeId} is not the coordinator for dispatch ${dispatchId}.`,
          }
        }
        try {
          const res = await ctx.orchestration.workerStop(dispatchId, reason)
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            status: res.task.status,
            ...(res.task.stopReason ? { stopReason: res.task.stopReason } : {}),
            stoppedExecution: res.stoppedExecution,
            next: `Worker ${res.task.dispatchId} stopped. Resume later with: alice orchestration send --to dispatch:${res.task.dispatchId} --body "<instructions>"`,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationSendFactory: WorkspaceToolFactory = {
  name: 'orchestration_send',
  build(ctx) {
    return tool({
      description: [
        'Send follow-up instructions to a worker dispatch in any state.',
        'Queues if the worker is running; resumes the worker Session immediately if idle, waiting, done, failed, or stopped.',
      ].join('\n'),
      inputSchema: z.object({
        to: z.string().trim().min(1)
          .describe('Target dispatch address ("dispatch:<id>" or raw "<dispatchId>").'),
        subject: z.string().trim().min(1).max(200).optional()
          .describe('Optional short subject line.'),
        body: z.string().trim().min(1).max(MAX_TEXT_CHARS)
          .describe('Message body to deliver to the worker.'),
      }),
      execute: async ({ to, subject, body }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        const toDispatchId = stripDispatchPrefix(to)
        if (!toDispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'Target --to must contain a non-empty dispatchId.',
          }
        }
        try {
          const res = await ctx.orchestration.send({
            toDispatchId,
            fromResumeId: callerResumeId,
            ...(subject ? { subject } : {}),
            body,
          })
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            messageId: res.message.id,
            mode: res.mode,
            status: res.task.status,
            turnCount: res.task.turnCount,
            ...(res.headlessTaskId ? { headlessTaskId: res.headlessTaskId } : {}),
            next:
              res.mode === 'resumed'
                ? `Worker ${res.task.dispatchId} resumed (turn ${res.task.turnCount}). End your turn and wait for OpenAlice to wake you when it reports back.`
                : `Message queued for running worker ${res.task.dispatchId}; it will be delivered when the current turn settles. End your turn and wait for wake.`,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationAskFactory: WorkspaceToolFactory = {
  name: 'orchestration_ask',
  build(ctx) {
    return tool({
      description: [
        'Worker-only: ask your coordinator a blocking question or request a decision.',
        'End your turn immediately after calling ask — OpenAlice will wake you automatically when your coordinator replies.',
      ].join('\n'),
      inputSchema: z.object({
        dispatch: z.string().trim().min(1)
          .describe('Your worker dispatchId from the Orchestration Worker Contract.'),
        subject: z.string().trim().min(1).max(200).optional()
          .describe('Optional short question subject.'),
        body: z.string().trim().min(1).max(MAX_TEXT_CHARS)
          .describe('Question, approval request, or decision needed from your coordinator.'),
      }),
      execute: async ({ dispatch, subject, body }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        const dispatchId = stripDispatchPrefix(dispatch)
        if (!dispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'dispatch must contain a non-empty dispatchId.',
          }
        }
        try {
          const res = await ctx.orchestration.ask({
            dispatchId,
            fromResumeId: callerResumeId,
            ...(subject ? { subject } : {}),
            body,
          })
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            messageId: res.message.id,
            status: res.task.status,
            wakeResult: res.wakeResult,
            next: 'Question sent to your coordinator. End your turn immediately — OpenAlice will wake you automatically when your coordinator replies.',
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationReplyFactory: WorkspaceToolFactory = {
  name: 'orchestration_reply',
  build(ctx) {
    return tool({
      description: 'Coordinator-only: answer a worker question message by id and wake the waiting worker.',
      inputSchema: z.object({
        id: z.string().trim().min(1)
          .describe('Question messageId to answer (from wake payload, check, or worker-list).'),
        body: z.string().trim().min(1).max(MAX_TEXT_CHARS)
          .describe('Answer or decision for the waiting worker.'),
      }),
      execute: async ({ id, body }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        try {
          const res = await ctx.orchestration.reply({
            messageId: id,
            fromResumeId: callerResumeId,
            body,
          })
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            questionId: res.question.id,
            replyId: res.reply.id,
            status: res.task.status,
            wakeResult: res.wakeResult,
            next:
              res.wakeResult === 'delivered'
                ? `Reply delivered and worker ${res.task.dispatchId} resumed. End your turn and wait for the next wake.`
                : `Reply queued for worker ${res.task.dispatchId} (wakeResult: ${res.wakeResult}); it will be delivered as soon as the worker finishes its current turn. End your turn and wait for wake.`,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationWorkerDoneFactory: WorkspaceToolFactory = {
  name: 'orchestration_worker_done',
  build(ctx) {
    return tool({
      description: [
        'Worker-only: report structured completion (`completed`, `failed`, or `inconclusive`) to your coordinator.',
        'End your turn immediately after calling worker-done.',
      ].join('\n'),
      inputSchema: z.object({
        dispatch: z.string().trim().min(1)
          .describe('Your worker dispatchId from the Orchestration Worker Contract.'),
        outcome: z.enum(['completed', 'failed', 'inconclusive'])
          .describe('Final task outcome.'),
        summary: z.string().trim().min(1).max(MAX_TEXT_CHARS)
          .describe('Concise summary of results, findings, or blockers.'),
        evidence: z.string().trim().min(1).max(MAX_TEXT_CHARS).optional()
          .describe('Optional verification output, metrics, run IDs, or key evidence.'),
        deliverables: z.union([z.array(deliverableInputSchema), z.string().trim().min(1)]).optional()
          .describe('Optional deliverables as a JSON array of { path, workspaceId?, summary? } or path strings.'),
        deliverable: z.array(deliverableInputSchema).optional()
          .describe('Optional repeatable deliverable path or JSON object { path, workspaceId?, summary? }.'),
      }),
      execute: async ({ dispatch, outcome, summary, evidence, deliverables, deliverable }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        const dispatchId = stripDispatchPrefix(dispatch)
        if (!dispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'dispatch must contain a non-empty dispatchId.',
          }
        }
        let normalizedDeliverables: OrchestrationDeliverable[] | undefined
        try {
          normalizedDeliverables = normalizeDeliverables(deliverables, deliverable)
        } catch (err) {
          return errorResponse(err)
        }
        try {
          const res = await ctx.orchestration.workerDone({
            dispatchId,
            fromResumeId: callerResumeId,
            outcome,
            summary,
            ...(evidence ? { evidence } : {}),
            ...(normalizedDeliverables ? { deliverables: normalizedDeliverables } : {}),
          })
          return {
            ok: true as const,
            taskId: res.task.taskId,
            dispatchId: res.task.dispatchId,
            messageId: res.message.id,
            status: res.task.status,
            outcome: res.task.outcome,
            ...(res.task.deliverables ? { deliverables: res.task.deliverables } : {}),
            wakeResult: res.wakeResult,
            next: 'Completion reported to your coordinator. End your turn immediately.',
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationCheckFactory: WorkspaceToolFactory = {
  name: 'orchestration_check',
  build(ctx) {
    return tool({
      description: 'Read and acknowledge all pending orchestration messages for this Session.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        try {
          const messages = await ctx.orchestration.check({
            recipientResumeId: callerResumeId,
          })
          return {
            ok: true as const,
            count: messages.length,
            messages,
            next: checkNextHint(messages),
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationInboxFactory: WorkspaceToolFactory = {
  name: 'orchestration_inbox',
  build(ctx) {
    return tool({
      description: 'Read-only orchestration message history for this Session (including already-acknowledged messages), newest-first.',
      inputSchema: z.object({
        limit: z.coerce.number().int().min(1).max(200).optional()
          .describe('Maximum messages to return, newest-first (default 50).'),
        dispatch: z.string().trim().min(1).optional()
          .describe('Optional dispatchId filter (accepts dispatch:<id> or raw <id>).'),
      }),
      execute: async ({ limit = 50, dispatch }) => {
        if (!ctx.orchestration) {
          return { ok: false as const, error: ORCHESTRATION_UNAVAILABLE_ERROR }
        }
        const callerResumeId = resolveCallerResumeId(ctx)
        if (!callerResumeId) {
          return { ok: false as const, error: SESSION_REQUIRED_ERROR }
        }
        const dispatchId = dispatch ? stripDispatchPrefix(dispatch) : undefined
        if (dispatch && !dispatchId) {
          return {
            ok: false as const,
            code: 'invalid_input' as const,
            error: 'dispatch must contain a non-empty dispatchId.',
          }
        }
        try {
          const messages = dispatchId
            ? ctx.orchestration
                .inbox({ recipientResumeId: callerResumeId })
                .filter((m) => m.dispatchId === dispatchId)
                .slice(0, limit)
            : ctx.orchestration.inbox({
                recipientResumeId: callerResumeId,
                limit,
              })
          return {
            ok: true as const,
            count: messages.length,
            messages,
          }
        } catch (err) {
          return errorResponse(err)
        }
      },
    })
  },
}

export const orchestrationToolFactories: readonly WorkspaceToolFactory[] = [
  orchestrationWorkerStartFactory,
  orchestrationWorkerListFactory,
  orchestrationWorkerStopFactory,
  orchestrationSendFactory,
  orchestrationAskFactory,
  orchestrationReplyFactory,
  orchestrationWorkerDoneFactory,
  orchestrationCheckFactory,
  orchestrationInboxFactory,
]
