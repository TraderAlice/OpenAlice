/**
 * Telegram phone-desk chat hop.
 *
 * Connector only transports. Issue comments are the transcript. The literal
 * tag [[no-reply]] is filtered here so silent heartbeat comments stay local.
 */
import { randomUUID } from 'node:crypto'
import {
  ConnectorClient,
  type InboundOwnerMessage,
} from '@traderalice/connector-protocol'

import type { WorkspaceConversationControl } from '../../core/workspace-tool-center.js'
import type { IProvenanceStore } from '../../core/provenance-store.js'
import { resolveConnectorUrl } from '../../services/connector-client/index.js'
import type { HeadlessTaskRecord } from '../headless-task-registry.js'
import { sessionSignature } from '../session-signature.js'
import {
  appendIssueComment,
  updateIssueCommentDelivery,
  type IssueComment,
} from './comments.js'
import { dispatchIssueCommentReply } from './comment-delivery.js'
import {
  findTelegramConnectorDesks,
  type TelegramConnectorDesk,
} from './telegram-connector.js'
import { projectDeskComment } from './telegram-desk-project.js'

export {
  TELEGRAM_NO_REPLY_TAG,
  containsTelegramNoReply,
  projectDeskComment,
  shouldProjectDeskComment,
} from './telegram-desk-project.js'

export interface TelegramDeskChatHost {
  listWorkspaces(): readonly { id: string; dir: string }[]
  getWorkspace(id: string): { id: string; dir: string } | undefined
  provenanceStore(): IProvenanceStore | undefined
  conversation(): WorkspaceConversationControl | undefined
  /** True while a scheduled fire or comment reply for this desk is running. */
  deskGenerating?(desk: TelegramConnectorDesk): boolean
}

export function telegramDeskHasRunningWork(
  tasks: readonly Pick<HeadlessTaskRecord, 'status' | 'trigger' | 'inquiry'>[],
  desk: { wsId: string; issue: { id: string } },
): boolean {
  return tasks.some((task) => task.status === 'running' && isDeskTask(task, desk))
}

function isDeskTask(
  task: Pick<HeadlessTaskRecord, 'trigger' | 'inquiry'>,
  desk: { wsId: string; issue: { id: string } },
): boolean {
  const trigger = task.trigger
  if (trigger?.kind === 'issue' && trigger.workspaceId === desk.wsId && trigger.issueId === desk.issue.id) {
    return true
  }
  const subject = task.inquiry?.subject
  return subject?.kind === 'issue' && subject.workspaceId === desk.wsId && subject.issueId === desk.issue.id
}

/** One inbound stays as-is. Several become one stacked comment, each quoted. */
export function formatTelegramInboundStack(texts: readonly string[]): string {
  const parts = texts.map((text) => text.trim()).filter((text) => text.length > 0)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0] ?? ''
  return parts.map(quoteInboundMessage).join('\n')
}

function quoteInboundMessage(text: string): string {
  return text.split('\n').map((line) => (line.length > 0 ? `> ${line}` : '>')).join('\n')
}

export async function ingestTelegramOwnerMessage(
  host: TelegramDeskChatHost,
  message: InboundOwnerMessage,
): Promise<{ ok: true; comment: IssueComment } | { ok: false; reason: string }> {
  return ingestTelegramOwnerMessages(host, [message])
}

export async function ingestTelegramOwnerMessages(
  host: TelegramDeskChatHost,
  messages: readonly InboundOwnerMessage[],
): Promise<{ ok: true; comment: IssueComment } | { ok: false; reason: string }> {
  const texts = messages
    .filter((message) => message.connectorId === 'telegram')
    .map((message) => message.text)
  if (texts.length === 0 && messages.length > 0) {
    return { ok: false, reason: 'unsupported_connector' }
  }
  const markdown = formatTelegramInboundStack(texts)
  if (!markdown) return { ok: false, reason: 'empty' }
  const desk = await findLiveDesk(host)
  if (!desk) return { ok: false, reason: 'desk_disabled' }
  const workspace = host.getWorkspace(desk.wsId)
  if (!workspace) return { ok: false, reason: 'workspace_missing' }

  const appended = await appendIssueComment(workspace.dir, desk.issue.id, 'human', markdown, {
    id: `telegram-${randomUUID()}`,
    via: 'telegram',
  })
  if (!appended.ok) {
    return { ok: false, reason: appended.reason === 'invalid' ? appended.error : 'issue_missing' }
  }

  await host.provenanceStore()?.append({
    artifact: { kind: 'issue', workspaceId: desk.wsId, issueId: desk.issue.id },
    action: 'commented',
    origin: { kind: 'external', system: 'telegram' },
    at: Date.now(),
  })

  const conversation = host.conversation()
  const dispatched = await dispatchIssueCommentReply({
    conversation,
    issueWorkspaceId: desk.wsId,
    issue: appended.issue,
    comment: appended.comment,
    source: { kind: 'human' },
  })
  if (dispatched.status !== 'not_requested') {
    await updateIssueCommentDelivery(workspace.dir, desk.issue.id, appended.comment.id, dispatched.delivery)
  }
  return { ok: true, comment: appended.comment }
}

export async function stampTelegramDeskScheduledFire(input: {
  host: TelegramDeskChatHost
  workspaceId: string
  issueId: string
  task: HeadlessTaskRecord
  assistantText?: string | null
}): Promise<IssueComment | null> {
  // A native CLI can emit partial assistant text before exiting with an error
  // or interruption. Keep that diagnostic in the run record, but do not turn
  // it into a durable phone-desk reply or project it to Telegram.
  if (input.task.status !== 'done') return null
  const text = input.assistantText?.trim()
  if (!text) return null
  const workspace = input.host.getWorkspace(input.workspaceId)
  if (!workspace) return null
  const desks = await findTelegramConnectorDesks(input.host.listWorkspaces())
  const desk = desks.find((item) => item.wsId === input.workspaceId && item.issue.id === input.issueId)
  if (!desk || desk.issue.status === 'canceled') return null

  const appended = await appendIssueComment(
    workspace.dir,
    desk.issue.id,
    sessionSignature(input.task.resumeId),
    text,
    { id: `comment-fire-${input.task.taskId}` },
  )
  if (!appended.ok) return null
  await input.host.provenanceStore()?.append({
    artifact: { kind: 'issue', workspaceId: desk.wsId, issueId: desk.issue.id },
    action: 'commented',
    origin: {
      kind: 'session',
      workspaceId: input.task.wsId,
      resumeId: input.task.resumeId,
      agent: input.task.agent,
      execution: { kind: 'headless', taskId: input.task.taskId },
    },
    at: input.task.finishedAt ?? Date.now(),
    fingerprint: `telegram-desk-fire:${input.task.taskId}`,
  })
  await projectDeskComment(appended.issue, appended.comment).catch(() => undefined)
  return appended.comment
}

export async function pullTelegramDeskInbound(
  host: TelegramDeskChatHost,
  client: ConnectorClient,
): Promise<void> {
  // Drain is destructive. Leave Connector's queue untouched until a live desk
  // can accept the stack as one comment, and until any in-flight generation
  // has finished so later DMs can pile up instead of racing the same Session.
  const desk = await findLiveDesk(host)
  if (!desk) return
  if (host.deskGenerating?.(desk)) return
  const messages = await client.drainInbound(AbortSignal.timeout(5_000))
  if (messages.length === 0) return
  const result = await ingestTelegramOwnerMessages(host, messages)
  if (!result.ok) {
    console.warn('[connector] Telegram phone-desk inbound skipped:', result.reason)
  }
}

export function startTelegramDeskInboundPoll(
  host: TelegramDeskChatHost,
  options: { intervalMs?: number; client?: ConnectorClient } = {},
): () => void {
  const client = options.client ?? new ConnectorClient(resolveConnectorUrl())
  const intervalMs = options.intervalMs ?? 1_500
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      await pullTelegramDeskInbound(host, client)
    } catch {
      // Connector is optional.
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  timer.unref?.()
  void tick()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

async function findLiveDesk(host: TelegramDeskChatHost): Promise<TelegramConnectorDesk | null> {
  const desks = await findTelegramConnectorDesks(host.listWorkspaces())
  const desk = desks[0]
  if (!desk || desk.issue.status === 'canceled') return null
  return desk
}
