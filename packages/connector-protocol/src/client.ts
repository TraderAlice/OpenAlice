import {
  connectorArtifactDeliverySchema,
  connectorArtifactFailureSchema,
  connectorArtifactRequestSchema,
  connectorDeliveryReceiptSchema,
  connectorServiceHealthSchema,
  connectorUtaFailureSchema,
  connectorUtaPresentationSchema,
  connectorUtaRequestSchema,
  inboxNotificationSchema,
  inboundOwnerMessageSchema,
  ownerChatMessageSchema,
  type ConnectorArtifactDelivery,
  type ConnectorArtifactFailure,
  type ConnectorArtifactRequest,
  type ClaimedInboundOwnerMessage,
  type ConnectorDeliveryReceipt,
  type ConnectorServiceHealth,
  type ConnectorUtaFailure,
  type ConnectorUtaPresentation,
  type ConnectorUtaRequest,
  type InboxNotification,
  type ConnectorWorkClaim,
  type OwnerChatMessage,
} from './types.js'

export class ConnectorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async health(signal?: AbortSignal): Promise<ConnectorServiceHealth> {
    const response = await this.fetchImpl(new URL('/__connector/health', this.baseUrl), { signal })
    if (!response.ok) throw new Error(`Connector Service health failed: ${response.status}`)
    return connectorServiceHealthSchema.parse(await response.json())
  }

  async pushInbox(notification: InboxNotification, signal?: AbortSignal): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/notifications/inbox', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(inboxNotificationSchema.parse(notification)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service delivery failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  async claimInbound(signal?: AbortSignal): Promise<ConnectorWorkClaim<ClaimedInboundOwnerMessage>> {
    const response = await this.fetchImpl(new URL('/v1/inbound/claim', this.baseUrl), {
      method: 'POST',
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service inbound claim failed: ${response.status}`)
    const body = await response.json() as { claimId?: unknown; messages?: unknown }
    const claimId = typeof body.claimId === 'string' ? body.claimId : ''
    const items = Array.isArray(body.messages) ? body.messages.flatMap((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return []
      const queueId = (message as { queueId?: unknown }).queueId
      const parsed = inboundOwnerMessageSchema.safeParse(message)
      return parsed.success && typeof queueId === 'string' ? [{ ...parsed.data, queueId }] : []
    }) : []
    return { claimId, items }
  }

  ackInbound(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/inbound/${encodeURIComponent(claimId)}/ack`, itemIds, signal)
  }

  releaseInbound(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/inbound/${encodeURIComponent(claimId)}/release`, itemIds, signal)
  }

  async sendOwnerMessage(message: OwnerChatMessage, signal?: AbortSignal): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/notifications/owner-chat', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ownerChatMessageSchema.parse(message)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service owner-chat delivery failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  async claimActions(signal?: AbortSignal): Promise<ConnectorWorkClaim<ConnectorArtifactRequest>> {
    const response = await this.fetchImpl(new URL('/v1/actions/claim', this.baseUrl), {
      method: 'POST',
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service action claim failed: ${response.status}`)
    const body = await response.json() as { claimId?: unknown; requests?: unknown }
    const items = Array.isArray(body.requests) ? body.requests.flatMap((request) => {
      const parsed = connectorArtifactRequestSchema.safeParse(request)
      return parsed.success ? [parsed.data] : []
    }) : []
    return { claimId: typeof body.claimId === 'string' ? body.claimId : '', items }
  }

  ackActions(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/actions/${encodeURIComponent(claimId)}/ack`, itemIds, signal)
  }

  releaseActions(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/actions/${encodeURIComponent(claimId)}/release`, itemIds, signal)
  }

  async deliverArtifact(
    delivery: ConnectorArtifactDelivery,
    signal?: AbortSignal,
  ): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/artifacts/deliver', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(connectorArtifactDeliverySchema.parse(delivery)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service artifact delivery failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  async failArtifact(
    failure: ConnectorArtifactFailure,
    signal?: AbortSignal,
  ): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/artifacts/fail', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(connectorArtifactFailureSchema.parse(failure)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service artifact failure notify failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  async claimUtaActions(signal?: AbortSignal): Promise<ConnectorWorkClaim<ConnectorUtaRequest>> {
    const response = await this.fetchImpl(new URL('/v1/actions/uta/claim', this.baseUrl), {
      method: 'POST',
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service UTA claim failed: ${response.status}`)
    const body = await response.json() as { claimId?: unknown; requests?: unknown }
    const items = Array.isArray(body.requests) ? body.requests.flatMap((request) => {
      const parsed = connectorUtaRequestSchema.safeParse(request)
      return parsed.success ? [parsed.data] : []
    }) : []
    return { claimId: typeof body.claimId === 'string' ? body.claimId : '', items }
  }

  ackUtaActions(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/actions/uta/${encodeURIComponent(claimId)}/ack`, itemIds, signal)
  }

  releaseUtaActions(claimId: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    return this.finishWork(`/v1/actions/uta/${encodeURIComponent(claimId)}/release`, itemIds, signal)
  }

  async presentUta(
    presentation: ConnectorUtaPresentation,
    signal?: AbortSignal,
  ): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/uta/present', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(connectorUtaPresentationSchema.parse(presentation)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service UTA present failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  async failUta(
    failure: ConnectorUtaFailure,
    signal?: AbortSignal,
  ): Promise<ConnectorDeliveryReceipt> {
    const response = await this.fetchImpl(new URL('/v1/uta/fail', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(connectorUtaFailureSchema.parse(failure)),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service UTA failure notify failed: ${response.status}`)
    return connectorDeliveryReceiptSchema.parse(await response.json())
  }

  private async finishWork(path: string, itemIds: string[], signal?: AbortSignal): Promise<void> {
    if (itemIds.length === 0) return
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemIds }),
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service work disposition failed: ${response.status}`)
  }
}
