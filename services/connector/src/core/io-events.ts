import { createHash, randomUUID } from 'node:crypto'

export type ConnectorIODirection = 'inbound' | 'outbound'
export type ConnectorIOStage =
  | 'notification.received'
  | 'delivery.attempted'
  | 'delivery.succeeded'
  | 'delivery.failed'
  | 'command.received'
  | 'command.replied'
  | 'command.failed'

export interface ConnectorIOEvent {
  version: 1
  eventId: string
  at: string
  correlationId: string
  direction: ConnectorIODirection
  stage: ConnectorIOStage
  connectorId?: string
  payload: Record<string, unknown>
}

export type ConnectorIOEventInput = Omit<ConnectorIOEvent, 'version' | 'eventId' | 'at'>

export interface ConnectorIORecorder {
  record(event: ConnectorIOEventInput): Promise<void>
}

export const noopConnectorIORecorder: ConnectorIORecorder = {
  async record() { /* intentionally empty */ },
}

export function createConnectorIOEvent(input: ConnectorIOEventInput): ConnectorIOEvent {
  return {
    version: 1,
    eventId: `connector-event-${randomUUID()}`,
    at: new Date().toISOString(),
    ...input,
  }
}

/** Stable pseudonyms preserve owner-equality cases without storing platform IDs. */
export function pseudonymizeExternalId(value: string | undefined): string | undefined {
  if (!value) return undefined
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 20)}`
}
