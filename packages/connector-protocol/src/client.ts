import {
  connectorDeliveryReceiptSchema,
  connectorServiceHealthSchema,
  inboxNotificationSchema,
  type ConnectorDeliveryReceipt,
  type ConnectorServiceHealth,
  type InboxNotification,
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
}
