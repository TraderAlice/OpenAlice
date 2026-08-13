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
}

export async function ingestTelegramOwnerMessage(
  host: TelegramDeskChatHost,
  message: InboundOwnerMessage,
): Promise<{ ok: true; comment: IssueComment } | { ok: false; reason: string }> {
  if (message.connectorId !== 'telegram') {
    return { ok: false, reason: 'unsupported_connector' }
  }
  const desk = await findLiveDesk(host)
  if (!desk) return { ok: false, reason: 'desk_disabled' }
  const workspace = host.getWorkspace(desk.wsId)
  if (!workspace) return { ok: false, reason: 'workspace_missing' }

  const appended = await appendIssueComment(workspace.dir, desk.issue.id, 'human', message.text, {
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
  // can accept the text as a comment.
  if (!(await findLiveDesk(host))) return
  const messages = await client.drainInbound(AbortSignal.timeout(5_000))
  for (const message of messages) {
    const result = await ingestTelegramOwnerMessage(host, message)
    if (!result.ok) {
      console.warn('[connector] Telegram phone-desk inbound skipped:', result.reason)
    }
  }
}

export function startTelegramDeskInboundPoll(
  host: TelegramDeskChatHost,
  options: { intervalMs?: number; client?: ConnectorClient } = {},
): () => void {
  const client = options.client ?? new ConnectorClient(resolveConnectorUrl())
  const intervalMs = options.intervalMs ?? 1_500
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await pullTelegramDeskInbound(host, client)
    } catch {
      // Connector is optional.
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
