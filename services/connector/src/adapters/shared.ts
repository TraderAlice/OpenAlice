import { createHash } from 'node:crypto'
import type {
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'

export class AdapterHealthTracker {
  private value: ConnectorAdapterHealth

  constructor(id: string) {
    this.value = { id, enabled: true, status: 'starting' }
  }

  healthy(owner?: string): void {
    this.value = { ...this.value, status: 'healthy', detail: undefined, lastError: undefined, owner }
  }

  awaitingLink(): void {
    this.value = {
      ...this.value,
      status: 'awaiting_link',
      detail: 'Bot is online and waiting for the owner to run /link.',
      lastError: undefined,
      owner: undefined,
    }
  }

  degraded(error: unknown): void {
    this.value = {
      ...this.value,
      status: 'degraded',
      detail: 'External connector is unavailable.',
      lastError: error instanceof Error ? error.message : String(error),
    }
  }

  attempt(): void {
    this.value = { ...this.value, lastAttemptAt: new Date().toISOString() }
  }

  success(owner?: string): void {
    const now = new Date().toISOString()
    this.value = {
      ...this.value,
      status: 'healthy',
      detail: undefined,
      lastError: undefined,
      lastAttemptAt: this.value.lastAttemptAt ?? now,
      lastSuccessAt: now,
      owner: owner ?? this.value.owner,
    }
  }

  stopped(): void {
    this.value = { ...this.value, status: 'stopped' }
  }

  get(): ConnectorAdapterHealth {
    return { ...this.value }
  }
}

export function formatInboxNotification(notification: InboxNotification): string {
  const workspace = notification.workspaceLabel ?? notification.workspaceId
  const provenance = formatProvenance(notification)
  const parts = [
    `**${escapeMarkdown(notification.title)}**`,
    `Workspace: ${escapeMarkdown(workspace)}`,
  ]
  if (provenance) parts.push(`From: ${escapeMarkdown(provenance)}`)
  if (notification.body.trim()) parts.push('', truncate(notification.body.trim(), 1_600))
  if (notification.href) parts.push('', notification.href)
  return parts.join('\n')
}

export function formatPlainInboxNotification(notification: InboxNotification): string {
  const workspace = notification.workspaceLabel ?? notification.workspaceId
  const provenance = formatProvenance(notification)
  const parts = [notification.title, `Workspace: ${workspace}`]
  if (provenance) parts.push(`From: ${provenance}`)
  if (notification.body.trim()) parts.push('', truncate(notification.body.trim(), 1_600))
  if (notification.href) parts.push('', notification.href)
  return parts.join('\n')
}

export interface DecodedConnectorAttachment {
  filename: string
  mediaType: string
  content: Buffer
}

/** Decode and verify the Alice-produced attachment before handing bytes to a
 * platform SDK. Size and digest checks keep malformed loopback payloads from
 * becoming opaque Discord/Telegram upload failures. */
export function decodeInboxAttachments(notification: InboxNotification): DecodedConnectorAttachment[] {
  return (notification.attachments ?? []).map((attachment) => {
    if (!isCanonicalBase64(attachment.contentBase64)) {
      throw new Error(`Connector attachment is not valid base64: ${attachment.filename}`)
    }
    const content = Buffer.from(attachment.contentBase64, 'base64')
    if (content.byteLength !== attachment.sizeBytes) {
      throw new Error(`Connector attachment size mismatch: ${attachment.filename}`)
    }
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== attachment.contentSha256) {
      throw new Error(`Connector attachment digest mismatch: ${attachment.filename}`)
    }
    return {
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      content,
    }
  })
}

function formatProvenance(notification: InboxNotification): string | undefined {
  const actor = notification.provenance?.actorLabel?.trim()
  const resumeId = notification.provenance?.resumeId?.trim()
  const signature = resumeId ? `@${resumeId}` : undefined
  return actor && signature ? `${actor} · ${signature}` : actor ?? signature
}

function isCanonicalBase64(value: string): boolean {
  if (value === '') return true
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1')
}
