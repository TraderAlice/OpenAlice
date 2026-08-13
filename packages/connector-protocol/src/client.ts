import {
  connectorDeliveryReceiptSchema,
  connectorServiceHealthSchema,
  inboxNotificationSchema,
  inboundOwnerMessageSchema,
  ownerChatMessageSchema,
  type ConnectorDeliveryReceipt,
  type ConnectorServiceHealth,
  type InboxNotification,
  type InboundOwnerMessage,
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

  async drainInbound(signal?: AbortSignal): Promise<InboundOwnerMessage[]> {
    const response = await this.fetchImpl(new URL('/v1/inbound/drain', this.baseUrl), {
      method: 'POST',
      signal,
    })
    if (!response.ok) throw new Error(`Connector Service inbound drain failed: ${response.status}`)
    const body = await response.json() as { messages?: unknown }
    if (!Array.isArray(body.messages)) return []
    return body.messages.flatMap((message) => {
      const parsed = inboundOwnerMessageSchema.safeParse(message)
      return parsed.success ? [parsed.data] : []
    })
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
}
