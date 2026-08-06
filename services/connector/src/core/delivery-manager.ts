import { randomUUID } from 'node:crypto'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  ConnectorConfig,
  ConnectorDeliveryReceipt,
  ConnectorServiceHealth,
  InboxNotification,
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
export class DeliveryManager {
  private readonly adapters = new Map<string, ConnectorAdapter>()
  private readonly commands = new Map<string, CommandRegistry>()
  private readonly startedAt: string
  private stopped = false

  constructor(private readonly options: DeliveryManagerOptions) {
    this.startedAt = options.startedAt ?? new Date().toISOString()
  }

  async start(): Promise<void> {
    for (const [id, config] of Object.entries(this.options.config.adapters)) {
      if (!config.enabled || !this.options.registry.has(id)) continue
      await this.startAdapter(id, config).catch((error) => {
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
          payload: {
            notificationId: notification.id,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        console.warn(`[connector] ${adapter.id} delivery failed:`, error instanceof Error ? error.message : error)
      }
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

  private async startAdapter(id: string, config: ConnectorAdapterConfig): Promise<void> {
    const adapter = this.options.registry.create(id)
    const commands = new CommandRegistry(id, this.recorder)
    const context: ConnectorAdapterContext = {
      commands,
      updateSettings: (patch) => this.options.updateAdapterSettings(id, patch),
      getServiceStatus: () => this.health().status,
      sendTest: (connectorId) => this.sendTest(connectorId),
    }
    // Keep the adapter registered while it starts. An adapter that reaches an
    // external service can fail after it has recorded a useful degraded health
    // reason; dropping it here reduced that evidence to a generic
    // "configured but not running" state in Settings.
    this.adapters.set(id, adapter)
    this.commands.set(id, commands)
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

  private async record(event: ConnectorIOEventInput): Promise<void> {
    await this.recorder.record(event).catch((error) => {
      console.warn('[connector] I/O delivery event could not be recorded:', error instanceof Error ? error.message : error)
    })
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
