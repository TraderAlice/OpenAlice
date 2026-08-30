import { randomUUID } from 'node:crypto'
import {
  CONNECTOR_ACTION_TTL_MS,
  MAX_CONNECTOR_ACTION_REQUESTS,
  connectorArtifactDeliverySchema,
  connectorArtifactFailureSchema,
  connectorArtifactRequestSchema,
  connectorUtaFailureSchema,
  connectorUtaPresentationSchema,
  connectorUtaRequestSchema,
  inboundOwnerMessageSchema,
  isInboxPushEnabled,
  type ConnectorAdapterConfig,
  type ConnectorAdapterHealth,
  type ConnectorArtifactDelivery,
  type ConnectorArtifactFailure,
  type ConnectorArtifactRequest,
  type ConnectorConfig,
  type ConnectorDeliveryReceipt,
  type ConnectorServiceHealth,
  type ConnectorUtaFailure,
  type ConnectorUtaPresentation,
  type ConnectorUtaRequest,
  type InboxNotification,
  type InboundOwnerMessage,
  type OwnerChatMessage,
} from '@traderalice/connector-protocol'
import {
  CommandRegistry,
  ConnectorRegistry,
  type ConnectorAdapter,
  type ConnectorAdapterContext,
} from './adapter.js'
import {
  noopConnectorIORecorder,
  type ConnectorIOEventInput,
  type ConnectorIORecorder,
} from './io-events.js'
import {
  ConnectorWorkQueue,
  type ConnectorWorkClaim,
  type ConnectorWorkQueueStore,
} from './work-queue.js'

export interface DeliveryManagerOptions {
  registry: ConnectorRegistry
  config: ConnectorConfig
  updateAdapterSettings(id: string, patch: Record<string, string | number | boolean>): Promise<void>
  startedAt?: string
  recorder?: ConnectorIORecorder
  /** First retry delay after a transient adapter start failure. Doubles each attempt up to 60s. */
  adapterStartRetryDelayMs?: number
  workQueue?: ConnectorWorkQueueStore
}

/**
 * One adapter failure is intentionally isolated from every other adapter and
 * from the caller that originally wrote the Inbox item. Enqueue accepts the
 * durable notification and performs external delivery after returning.
 */
export const MAX_INBOUND_OWNER_MESSAGES = 100
export const DEFAULT_ADAPTER_START_RETRY_DELAY_MS = 5_000
const MAX_ADAPTER_START_RETRY_DELAY_MS = 60_000

export class DeliveryManager {
  private readonly adapters = new Map<string, ConnectorAdapter>()
  private readonly commands = new Map<string, CommandRegistry>()
  private readonly bootRetries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly reconnects = new Map<string, Promise<ConnectorAdapterHealth>>()
  private readonly startedAt: string
  private stopped = false
  private readonly workQueue: ConnectorWorkQueueStore

  constructor(private readonly options: DeliveryManagerOptions) {
    this.startedAt = options.startedAt ?? new Date().toISOString()
    this.workQueue = options.workQueue ?? new ConnectorWorkQueue()
  }

  /**
   * Create enabled adapters without reaching external APIs. The health
   * endpoint can then report `starting` instead of the generic
   * "configured but not running" state while Guardian is already probing.
   */
  installEnabledAdapters(): void {
    for (const [id, config] of Object.entries(this.options.config.adapters)) {
      if (!config.enabled || !this.options.registry.has(id) || this.adapters.has(id)) continue
      this.installAdapter(id)
    }
  }

  async start(): Promise<void> {
    this.installEnabledAdapters()
    for (const [id, config] of Object.entries(this.options.config.adapters)) {
      if (!config.enabled || !this.adapters.has(id)) continue
      await this.bootAdapter(id, config).catch((error) => {
        this.handleAdapterStartFailure(id, config, error, 0)
      })
    }
  }

  enqueue(notification: InboxNotification): ConnectorDeliveryReceipt {
    const deliveryId = `delivery-${randomUUID()}`
    queueMicrotask(() => {
      if (this.stopped) return
      void this.record({
        correlationId: deliveryId,
        direction: 'inbound',
        stage: 'notification.received',
        payload: journalNotificationPayload(notification),
      }).then(() => this.deliver(notification, deliveryId))
    })
    return { accepted: true, deliveryId }
  }

  async deliver(notification: InboxNotification, correlationId = `delivery-${randomUUID()}`): Promise<void> {
    await Promise.allSettled([...this.adapters.values()].map(async (adapter) => {
      const settings = this.options.config.adapters[adapter.id]?.settings ?? {}
      if (!isInboxPushEnabled(settings)) {
        await this.record({
          correlationId,
          direction: 'outbound',
          stage: 'delivery.skipped',
          connectorId: adapter.id,
          payload: { notificationId: notification.id, reason: 'inbox-push-disabled' },
        })
        return
      }
      await this.deliverToAdapter(adapter, notification, correlationId)
    }))
  }

  async sendTest(id: string): Promise<string> {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`Connector is not running: ${id}`)
    const probeId = `connector-probe-${randomUUID().slice(0, 8)}`
    const notification: InboxNotification = {
      id: probeId,
      createdAt: new Date().toISOString(),
      workspaceId: 'openalice',
      workspaceLabel: 'OpenAlice',
      title: 'Connector test',
      body: `Your OpenAlice Connector Service is working. Probe: ${probeId}`,
    }
    await this.deliverToAdapter(adapter, notification, probeId)
    return probeId
  }

  async reconnect(id: string): Promise<ConnectorAdapterHealth> {
    const config = this.options.config.adapters[id]
    if (!config?.enabled) throw new Error(`Connector is not enabled: ${id}`)
    return this.reconcile(id, config)
  }

  async reconcile(id: string, config: ConnectorAdapterConfig): Promise<ConnectorAdapterHealth> {
    const active = this.reconnects.get(id)
    if (active) return active
    const operation = this.reconcileAdapter(id, config)
    this.reconnects.set(id, operation)
    try {
      return await operation
    } finally {
      if (this.reconnects.get(id) === operation) this.reconnects.delete(id)
    }
  }

  private async reconcileAdapter(id: string, config: ConnectorAdapterConfig): Promise<ConnectorAdapterHealth> {
    if (!this.options.registry.has(id)) throw new Error(`Unknown connector adapter: ${id}`)
    this.clearAdapterStartRetry(id)
    const previous = this.adapters.get(id)
    try {
      if (previous) await previous.stop()
    } finally {
      this.adapters.delete(id)
      this.commands.delete(id)
    }
    this.options.config.adapters[id] = {
      enabled: config.enabled,
      settings: { ...config.settings },
    }
    if (!config.enabled) {
      return { id, enabled: false, status: 'disabled' }
    }
    this.installAdapter(id)
    try {
      await this.bootAdapter(id, config)
    } catch (error) {
      this.handleAdapterStartFailure(id, config, error, 0)
      throw error
    }
    return this.adapters.get(id)!.health()
  }

  async acceptInbound(input: InboundOwnerMessage): Promise<void> {
    const parsed = inboundOwnerMessageSchema.safeParse(input)
    if (!parsed.success) return
    const id = parsed.data.eventId
      ? `in-${parsed.data.connectorId}-${parsed.data.eventId}`
      : `in-${randomUUID()}`
    await this.workQueue.enqueue('inbound', id, parsed.data)
  }

  claimInbound(limit = MAX_INBOUND_OWNER_MESSAGES): Promise<ConnectorWorkClaim<InboundOwnerMessage>> {
    return this.workQueue.claim('inbound', limit)
  }

  ackInbound(claimId: string, itemIds: readonly string[]): Promise<void> {
    return this.workQueue.ack(claimId, itemIds)
  }

  releaseInbound(claimId: string, itemIds: readonly string[]): Promise<void> {
    return this.workQueue.release(claimId, itemIds)
  }

  async enqueueArtifactRequest(connectorId: string, input: { entryId: string; docIndex: number }): Promise<string> {
    const request = connectorArtifactRequestSchema.parse({
      requestId: `art-${randomUUID()}`,
      connectorId,
      entryId: input.entryId,
      docIndex: input.docIndex,
      createdAt: new Date().toISOString(),
    })
    await this.workQueue.enqueue('artifact', request.requestId, request)
    await this.record({
      correlationId: request.requestId,
      direction: 'inbound',
      stage: 'action.enqueued',
      connectorId,
      payload: {
        requestId: request.requestId,
        entryId: request.entryId,
        docIndex: request.docIndex,
        ttlMs: CONNECTOR_ACTION_TTL_MS,
      },
    })
    return request.requestId
  }

  claimActions(limit = MAX_CONNECTOR_ACTION_REQUESTS): Promise<ConnectorWorkClaim<ConnectorArtifactRequest>> {
    return this.workQueue.claim('artifact', limit)
  }

  async enqueueUtaRequest(connectorId: string, input: {
    action: 'review' | 'push' | 'reject'
    utaId?: string
    pendingHash?: string
  }): Promise<string> {
    const request = connectorUtaRequestSchema.parse({
      requestId: `uta-${randomUUID()}`,
      connectorId,
      createdAt: new Date().toISOString(),
      action: input.action,
      ...(input.utaId ? { utaId: input.utaId } : {}),
      ...(input.pendingHash ? { pendingHash: input.pendingHash } : {}),
    })
    await this.workQueue.enqueue('uta', request.requestId, request)
    await this.record({
      correlationId: request.requestId,
      direction: 'inbound',
      stage: 'action.enqueued',
      connectorId,
      payload: {
        kind: 'uta',
        requestId: request.requestId,
        action: request.action,
        utaId: request.utaId,
        ttlMs: CONNECTOR_ACTION_TTL_MS,
      },
    })
    return request.requestId
  }

  claimUtaActions(limit = MAX_CONNECTOR_ACTION_REQUESTS): Promise<ConnectorWorkClaim<ConnectorUtaRequest>> {
    return this.workQueue.claim('uta', limit)
  }

  ackActions(claimId: string, itemIds: readonly string[]): Promise<void> {
    return this.workQueue.ack(claimId, itemIds)
  }

  releaseActions(claimId: string, itemIds: readonly string[]): Promise<void> {
    return this.workQueue.release(claimId, itemIds)
  }

  async presentUta(presentation: ConnectorUtaPresentation): Promise<void> {
    const parsed = connectorUtaPresentationSchema.parse(presentation)
    const adapter = this.adapters.get(parsed.connectorId)
    if (!adapter) throw new Error(`Connector is not running: ${parsed.connectorId}`)
    await this.record({
      correlationId: parsed.requestId,
      direction: 'outbound',
      stage: 'delivery.attempted',
      connectorId: adapter.id,
      payload: {
        kind: 'uta',
        requestId: parsed.requestId,
        accountCount: parsed.review.accounts.length,
        result: parsed.result?.kind,
      },
    })
    try {
      if (adapter.presentUta) await adapter.presentUta(parsed)
      else {
        const waiting = parsed.review.accounts.filter((account) => account.pendingMessage).length
        await adapter.sendOwnerText(
          parsed.result?.message
          ?? parsed.review.unavailable
          ?? (waiting > 0
            ? `UTA: ${waiting} account${waiting === 1 ? '' : 's'} waiting for approval. Open /uta in Telegram or Trading as Git in OpenAlice.`
            : 'UTA: nothing waiting for approval.'),
        )
      }
      await this.record({
        correlationId: parsed.requestId,
        direction: 'outbound',
        stage: 'delivery.succeeded',
        connectorId: adapter.id,
        payload: { kind: 'uta', requestId: parsed.requestId },
      })
    } catch (error) {
      await this.record({
        correlationId: parsed.requestId,
        direction: 'outbound',
        stage: 'delivery.failed',
        connectorId: adapter.id,
        payload: {
          kind: 'uta',
          requestId: parsed.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  async failUta(failure: ConnectorUtaFailure): Promise<void> {
    const parsed = connectorUtaFailureSchema.parse(failure)
    const adapter = this.adapters.get(parsed.connectorId)
    if (!adapter) throw new Error(`Connector is not running: ${parsed.connectorId}`)
    if (adapter.failUta) await adapter.failUta(parsed)
    else await adapter.sendOwnerText(parsed.message)
  }

  async deliverArtifact(delivery: ConnectorArtifactDelivery): Promise<void> {
    const parsed = connectorArtifactDeliverySchema.parse(delivery)
    const adapter = this.adapters.get(parsed.connectorId)
    if (!adapter) throw new Error(`Connector is not running: ${parsed.connectorId}`)
    if (!adapter.deliverArtifact) {
      throw new Error(`Inbox file delivery is not implemented for ${parsed.connectorId} yet.`)
    }
    await this.record({
      correlationId: parsed.requestId,
      direction: 'outbound',
      stage: 'artifact.attempted',
      connectorId: adapter.id,
      payload: journalArtifactPayload(parsed),
    })
    try {
      await adapter.deliverArtifact(parsed)
      await this.record({
        correlationId: parsed.requestId,
        direction: 'outbound',
        stage: 'artifact.succeeded',
        connectorId: adapter.id,
        payload: { requestId: parsed.requestId, entryId: parsed.entryId, docIndex: parsed.docIndex },
      })
    } catch (error) {
      await this.record({
        correlationId: parsed.requestId,
        direction: 'outbound',
        stage: 'artifact.failed',
        connectorId: adapter.id,
        payload: {
          requestId: parsed.requestId,
          entryId: parsed.entryId,
          docIndex: parsed.docIndex,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  async failArtifact(failure: ConnectorArtifactFailure): Promise<void> {
    const parsed = connectorArtifactFailureSchema.parse(failure)
    const adapter = this.adapters.get(parsed.connectorId)
    if (!adapter) throw new Error(`Connector is not running: ${parsed.connectorId}`)
    await adapter.sendOwnerText(parsed.message)
  }

  enqueueOwnerChat(message: OwnerChatMessage): ConnectorDeliveryReceipt {
    const deliveryId = message.id
    queueMicrotask(() => {
      if (this.stopped) return
      void this.sendOwnerChat(message, deliveryId).catch((error) => {
        // The Issue comment is already durable before Alice projects it here.
        // Keep owner-chat delivery best-effort like ordinary Inbox projection:
        // a stopped/unlinked adapter or external outage must not become an
        // unhandled rejection that can terminate Connector Service.
        console.warn(
          `[connector] ${message.adapterId} owner-chat delivery failed:`,
          error instanceof Error ? error.message : error,
        )
      })
    })
    return { accepted: true, deliveryId }
  }

  async sendOwnerChat(message: OwnerChatMessage, correlationId = message.id): Promise<void> {
    const adapter = this.adapters.get(message.adapterId)
    if (!adapter) throw new Error(`Connector is not running: ${message.adapterId}`)
    await this.record({
      correlationId,
      direction: 'outbound',
      stage: 'delivery.attempted',
      connectorId: adapter.id,
      payload: {
        kind: 'owner-chat',
        phase: message.phase,
        conversationId: message.conversationId,
        textLength: message.text?.length ?? 0,
      },
    })
    try {
      if (adapter.sendOwnerChat) {
        await adapter.sendOwnerChat(message)
      } else if (message.phase !== 'accepted' && message.text) {
        await adapter.sendOwnerText(message.text)
      }
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.succeeded',
        connectorId: adapter.id,
        payload: { kind: 'owner-chat', phase: message.phase, conversationId: message.conversationId },
      })
    } catch (error) {
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.failed',
        connectorId: adapter.id,
        payload: {
          kind: 'owner-chat',
          phase: message.phase,
          conversationId: message.conversationId,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  health(): ConnectorServiceHealth {
    const adapters: ConnectorAdapterHealth[] = []
    for (const [id, config] of Object.entries(this.options.config.adapters)) {
      const adapter = this.adapters.get(id)
      adapters.push(adapter?.health() ?? {
        id,
        enabled: config.enabled,
        status: config.enabled ? 'degraded' : 'disabled',
        detail: config.enabled ? 'Adapter is configured but not running.' : undefined,
      })
    }
    return {
      status: adapters.some((adapter) => adapter.status === 'degraded') ? 'degraded' : 'healthy',
      startedAt: this.startedAt,
      adapters,
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const id of [...this.bootRetries.keys()]) this.clearAdapterStartRetry(id)
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.stop()))
    this.adapters.clear()
    this.commands.clear()
  }

  private installAdapter(id: string): void {
    const adapter = this.options.registry.create(id)
    this.adapters.set(id, adapter)
    this.commands.set(id, new CommandRegistry(id, this.recorder))
  }

  private async bootAdapter(id: string, config: ConnectorAdapterConfig): Promise<void> {
    const adapter = this.adapters.get(id)
    const commands = this.commands.get(id)
    if (!adapter || !commands) throw new Error(`Connector adapter is not installed: ${id}`)
    const context: ConnectorAdapterContext = {
      commands,
      updateSettings: async (patch) => {
        await this.options.updateAdapterSettings(id, patch)
        const current = this.options.config.adapters[id] ?? { enabled: false, settings: {} }
        this.options.config.adapters[id] = {
          ...current,
          settings: { ...current.settings, ...patch },
        }
      },
      getServiceStatus: () => this.health().status,
      sendTest: (connectorId) => this.sendTest(connectorId),
      forwardOwnerText: async (input) => {
        await this.acceptInbound({
          connectorId: id,
          userId: input.userId,
          text: input.text,
          ...(input.chatId ? { chatId: input.chatId } : {}),
          ...(input.eventId ? { eventId: input.eventId } : {}),
        })
      },
      enqueueArtifactRequest: (input) => this.enqueueArtifactRequest(id, input),
      enqueueUtaRequest: (input) => this.enqueueUtaRequest(id, input),
    }
    // Keep a failed adapter registered. start() may record a useful degraded
    // reason; dropping it here reduced Settings to "configured but not running".
    await adapter.start(config, context)
  }

  private handleAdapterStartFailure(
    id: string,
    config: ConnectorAdapterConfig,
    error: unknown,
    attempt: number,
  ): void {
    console.warn(`[connector] ${id} failed to start:`, error instanceof Error ? error.message : error)
    const adapter = this.adapters.get(id)
    if (adapter?.classifyStartFailure?.(error) !== 'retry') return
    this.scheduleAdapterStartRetry(id, config, attempt)
  }

  private scheduleAdapterStartRetry(id: string, config: ConnectorAdapterConfig, attempt: number): void {
    if (this.stopped) return
    this.clearAdapterStartRetry(id)
    const base = this.options.adapterStartRetryDelayMs ?? DEFAULT_ADAPTER_START_RETRY_DELAY_MS
    const delayMs = Math.min(base * 2 ** attempt, MAX_ADAPTER_START_RETRY_DELAY_MS)
    console.warn(`[connector] ${id} will retry start in ${delayMs}ms`)
    const timer = setTimeout(() => {
      this.bootRetries.delete(id)
      if (this.stopped) return
      const current = this.options.config.adapters[id]
      if (!current?.enabled) return
      void this.bootAdapter(id, current).catch((error) => {
        this.handleAdapterStartFailure(id, current, error, attempt + 1)
      })
    }, delayMs)
    timer.unref?.()
    this.bootRetries.set(id, timer)
  }

  private clearAdapterStartRetry(id: string): void {
    const timer = this.bootRetries.get(id)
    if (timer) clearTimeout(timer)
    this.bootRetries.delete(id)
  }

  private get recorder(): ConnectorIORecorder {
    return this.options.recorder ?? noopConnectorIORecorder
  }

  private async deliverToAdapter(
    adapter: ConnectorAdapter,
    notification: InboxNotification,
    correlationId: string,
  ): Promise<void> {
    await this.record({
      correlationId,
      direction: 'outbound',
      stage: 'delivery.attempted',
      connectorId: adapter.id,
      payload: journalNotificationPayload(notification),
    })
    try {
      await adapter.deliver(notification)
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.succeeded',
        connectorId: adapter.id,
        payload: { notificationId: notification.id },
      })
    } catch (error) {
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.failed',
        connectorId: adapter.id,
        payload: { notificationId: notification.id, error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }
  }

  private async record(event: ConnectorIOEventInput): Promise<void> {
    await this.recorder.record(event).catch((error) => {
      console.warn('[connector] I/O delivery event could not be recorded:', error instanceof Error ? error.message : error)
    })
  }
}

function journalArtifactPayload(delivery: ConnectorArtifactDelivery): Record<string, unknown> {
  return {
    requestId: delivery.requestId,
    entryId: delivery.entryId,
    docIndex: delivery.docIndex,
    filename: delivery.attachment.filename,
    mediaType: delivery.attachment.mediaType,
    sizeBytes: delivery.attachment.sizeBytes,
    contentSha256: delivery.attachment.contentSha256,
  }
}

/** The replay journal proves which source file and normalized delivery bytes
 * were offered without copying base64 bodies into connector-io.jsonl once per
 * adapter and stage. The live adapter still receives the complete notification. */
function journalNotificationPayload(notification: InboxNotification): Record<string, unknown> {
  const { attachments, ...safeNotification } = notification
  return {
    notification: safeNotification,
    ...(attachments && attachments.length > 0 ? {
      attachmentEvidence: attachments.map((attachment) => ({
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
        contentSha256: attachment.contentSha256,
        ...(attachment.source ? {
          source: attachment.source,
          normalized: attachment.source.contentSha256 !== attachment.contentSha256,
        } : {}),
      })),
    } : {}),
  }
}
