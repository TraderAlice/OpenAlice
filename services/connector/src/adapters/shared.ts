import { createHash } from 'node:crypto'
import type {
  ConnectorAdapterHealth,
  ConnectorAttachment,
  InboxNotification,
} from '@traderalice/connector-protocol'
import type { ConnectorStartFailureDisposition } from '../core/adapter.js'

/**
 * Shared default for adapters whose SDK exposes transport failures only as
 * errors. Keep this at the adapter boundary: DeliveryManager must never infer
 * platform lifecycle semantics from third-party error text.
 */
export function classifyNetworkStartFailure(error: unknown): ConnectorStartFailureDisposition {
  const message = formatAdapterError(error)
  return /did not become ready|did not answer getme|api is unreachable|network request|fetch failed|econn|etimedout|enotfound|enetunreach|ehostunreach|socket disconnected|aborted delay|certificate|eai_again|socket hang up|tls connection/i.test(message)
    ? 'retry'
    : 'fatal'
}

export class AdapterHealthTracker {
  private value: ConnectorAdapterHealth

  constructor(id: string) {
    this.value = { id, enabled: true, status: 'starting' }
  }

  healthy(owner?: string): void {
    this.value = {
      ...this.value,
      status: 'healthy',
      detail: undefined,
      lastError: undefined,
      nextAttemptAt: undefined,
      consecutiveFailures: 0,
      owner,
    }
  }

  awaitingLink(): void {
    this.value = {
      ...this.value,
      status: 'awaiting_link',
      detail: 'Bot is online and waiting for the owner to run /link.',
      lastError: undefined,
      nextAttemptAt: undefined,
      consecutiveFailures: 0,
      owner: undefined,
    }
  }

  degraded(error: unknown): void {
    this.value = {
      ...this.value,
      status: 'degraded',
      detail: 'External connector is unavailable.',
      lastError: formatAdapterError(error),
    }
  }

  attempt(): void {
    this.value = {
      ...this.value,
      lastAttemptAt: new Date().toISOString(),
      nextAttemptAt: undefined,
    }
  }

  retryScheduled(delayMs: number, consecutiveFailures: number): void {
    this.value = {
      ...this.value,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      consecutiveFailures,
    }
  }

  success(owner?: string): void {
    const now = new Date().toISOString()
    this.value = {
      ...this.value,
      status: 'healthy',
      detail: undefined,
      lastError: undefined,
      nextAttemptAt: undefined,
      consecutiveFailures: 0,
      lastAttemptAt: this.value.lastAttemptAt ?? now,
      lastSuccessAt: now,
      owner: owner ?? this.value.owner,
    }
  }

  connecting(detail?: string): void {
    this.value = {
      ...this.value,
      status: 'starting',
      detail: detail ?? 'Connecting to the external platform.',
    }
  }

  stopped(): void {
    this.value = { ...this.value, status: 'stopped' }
  }

  get(): ConnectorAdapterHealth {
    return { ...this.value }
  }
}

export const DEFAULT_CONNECTION_ATTEMPT_TIMEOUT_MS = 30_000
export const DEFAULT_CONNECTION_RETRY_DELAY_MS = 5_000
export const MAX_CONNECTION_RETRY_DELAY_MS = 60_000

export async function superviseLongConnection(options: {
  isStopped: () => boolean
  runSession: () => Promise<void>
  isSessionHealthy?: () => boolean
  disconnect: () => Promise<void>
  onFailure: (error: unknown) => void
  onAttempt?: () => void
  onRetryScheduled?: (delayMs: number, consecutiveFailures: number) => void
  delay: (ms: number) => Promise<void>
  reconnectDelayMs?: number
  retryJitterRatio?: number
  random?: () => number
  label: string
}): Promise<void> {
  let failures = 0
  const baseDelay = options.reconnectDelayMs ?? DEFAULT_CONNECTION_RETRY_DELAY_MS
  while (!options.isStopped()) {
    try {
      options.onAttempt?.()
      await options.runSession()
      if (options.isStopped()) return
      if (options.isSessionHealthy?.()) failures = 0
      failures += 1
      options.onFailure(new Error(`${options.label} session ended`))
    } catch (error) {
      if (options.isStopped()) return
      if (options.isSessionHealthy?.()) failures = 0
      failures += 1
      options.onFailure(error)
    }
    await options.disconnect().catch(() => undefined)
    if (options.isStopped()) return
    const unjittered = Math.min(baseDelay * 2 ** Math.max(0, failures - 1), MAX_CONNECTION_RETRY_DELAY_MS)
    const jitterRatio = options.retryJitterRatio ?? 0.2
    const random = options.random ?? Math.random
    const delayMs = Math.max(0, Math.round(unjittered * (1 + (random() * 2 - 1) * jitterRatio)))
    options.onRetryScheduled?.(delayMs, failures)
    console.warn(`[connector] ${options.label} reconnect in ${delayMs}ms`)
    await options.delay(delayMs)
  }
}

export function formatAdapterError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const parts = [error.message]
  const nested = 'error' in error ? (error as { error?: unknown }).error : undefined
  let current: unknown = error.cause ?? nested
  const seen = new Set<unknown>([error])
  while (current && !seen.has(current) && parts.length < 4) {
    seen.add(current)
    if (current instanceof Error) {
      if (current.message && !parts.includes(current.message)) parts.push(current.message)
      current = current.cause
      continue
    }
    const text = String(current)
    if (text && !parts.includes(text)) parts.push(text)
    break
  }
  return parts.join(' — ')
}

export function formatInboxNotification(notification: InboxNotification): string {
  const workspace = notification.workspaceLabel ?? notification.workspaceId
  const provenance = formatInboxProvenance(notification)
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
  const provenance = formatInboxProvenance(notification)
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
export function decodeConnectorAttachment(attachment: ConnectorAttachment): DecodedConnectorAttachment {
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
}

export function decodeInboxAttachments(notification: InboxNotification): DecodedConnectorAttachment[] {
  return (notification.attachments ?? []).map(decodeConnectorAttachment)
}

export function formatInboxProvenance(notification: InboxNotification): string | undefined {
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
