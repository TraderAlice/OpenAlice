import { randomUUID } from 'node:crypto'
import {
  CONNECTOR_ACTION_TTL_MS,
  MAX_CONNECTOR_ACTION_REQUESTS,
  connectorArtifactDeliverySchema,
  connectorArtifactFailureSchema,
  connectorArtifactRequestSchema,
  artifactFailureMessage,
  inboundOwnerMessageSchema,
  isConnectorActionExpired,
  isInboxPushEnabled,
  type ConnectorAdapterConfig,
  type ConnectorAdapterHealth,
  type ConnectorArtifactDelivery,
  type ConnectorArtifactFailure,
  type ConnectorArtifactRequest,
  type ConnectorConfig,
  type ConnectorDeliveryReceipt,
  type ConnectorServiceHealth,
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

export interface DeliveryManagerOptions {
  registry: ConnectorRegistry
  config: ConnectorConfig
  updateAdapterSettings(id: string, patch: Record<string, string | number | boolean>): Promise<void>
  startedAt?: string
  recorder?: ConnectorIORecorder
}

/**
 * One adapter failure is intentionally isolated from every other adapter and
 * from the caller that originally wrote the Inbox item. Enqueue accepts the
 * durable notification and performs external delivery after returning.
 */
export const MAX_INBOUND_OWNER_MESSAGES = 100

export class DeliveryManager {
  private readonly adapters = new Map<string, ConnectorAdapter>()
  private readonly commands = new Map<string, CommandRegistry>()
  private readonly inbound: InboundOwnerMessage[] = []
  private readonly actions: ConnectorArtifactRequest[] = []
  private readonly startedAt: string
  private stopped = false

  constructor(private readonly options: DeliveryManagerOptions) {
    this.startedAt = options.startedAt ?? new Date().toISOString()
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
        console.warn(`[connector] ${id} failed to start:`, error instanceof Error ? error.message : error)
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

  acceptInbound(input: InboundOwnerMessage): void {
    const parsed = inboundOwnerMessageSchema.safeParse(input)
    if (!parsed.success) return
    this.inbound.push(parsed.data)
    const overflow = this.inbound.length - MAX_INBOUND_OWNER_MESSAGES
    if (overflow > 0) this.inbound.splice(0, overflow)
  }

  drainInbound(limit = MAX_INBOUND_OWNER_MESSAGES): InboundOwnerMessage[] {
    return this.inbound.splice(0, Math.max(0, limit))
  }

  enqueueArtifactRequest(connectorId: string, input: { entryId: string; docIndex: number }): string {
    const expired = this.expireActions()
    for (const request of expired) {
      void this.failArtifact({
        requestId: request.requestId,
        connectorId: request.connectorId,
        entryId: request.entryId,
        docIndex: request.docIndex,
        reason: 'expired',
        message: artifactFailureMessage('expired'),
      }).catch((error) => {
        console.warn(
          `[connector] ${request.connectorId} expired file-request notify failed:`,
          error instanceof Error ? error.message : error,
        )
      })
    }
    if (this.actions.length >= MAX_CONNECTOR_ACTION_REQUESTS) {
      throw new Error('Too many pending file requests. Try again in a moment.')
    }
    const request = connectorArtifactRequestSchema.parse({
      requestId: `art-${randomUUID()}`,
      connectorId,
      entryId: input.entryId,
      docIndex: input.docIndex,
      createdAt: new Date().toISOString(),
    })
    this.actions.push(request)
    void this.record({
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

  drainActions(limit = MAX_CONNECTOR_ACTION_REQUESTS): ConnectorArtifactRequest[] {
    return this.actions.splice(0, Math.max(0, limit))
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
      payload: { kind: 'owner-chat', textLength: message.text.length },
    })
    try {
      await adapter.sendOwnerText(message.text)
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.succeeded',
        connectorId: adapter.id,
        payload: { kind: 'owner-chat' },
      })
    } catch (error) {
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'delivery.failed',
        connectorId: adapter.id,
        payload: { kind: 'owner-chat', error: error instanceof Error ? error.message : String(error) },
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
        this.acceptInbound({
          connectorId: id,
          userId: input.userId,
          text: input.text,
          ...(input.chatId ? { chatId: input.chatId } : {}),
        })
      },
      enqueueArtifactRequest: (input) => this.enqueueArtifactRequest(id, input),
    }
    // Keep a failed adapter registered. start() may record a useful degraded
    // reason; dropping it here reduced Settings to "configured but not running".
    await adapter.start(config, context)
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

  private expireActions(now = Date.now()): ConnectorArtifactRequest[] {
    const expired: ConnectorArtifactRequest[] = []
    for (let index = this.actions.length - 1; index >= 0; index -= 1) {
      const request = this.actions[index]
      if (!request || isConnectorActionExpired(request.createdAt, now)) {
        if (request) expired.push(request)
        this.actions.splice(index, 1)
      }
    }
    return expired
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
