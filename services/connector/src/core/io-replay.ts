import type { InboxNotification } from '@traderalice/connector-protocol'
import type { ConnectorIOEvent } from './io-events.js'

export function parseConnectorIOJsonl(source: string): ConnectorIOEvent[] {
  return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = JSON.parse(line) as Partial<ConnectorIOEvent>
    if (value.version !== 1 || typeof value.stage !== 'string' || typeof value.correlationId !== 'string') {
      throw new Error(`Invalid Connector I/O event at line ${index + 1}`)
    }
    return value as ConnectorIOEvent
  })
}

/** Replays only service-ingress notifications; result events are evidence, not inputs. */
export async function replayConnectorNotifications(
  events: ConnectorIOEvent[],
  deliver: (notification: InboxNotification) => Promise<void>,
): Promise<number> {
  let count = 0
  for (const event of events) {
    if (event.stage !== 'notification.received') continue
    const notification = event.payload['notification'] as InboxNotification | undefined
    if (!notification?.id || !notification.workspaceId || !notification.title) {
      throw new Error(`Recorded notification ${event.correlationId} is not replayable`)
    }
    await deliver(notification)
    count += 1
  }
  return count
}
