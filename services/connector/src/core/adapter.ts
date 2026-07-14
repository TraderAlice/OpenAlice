import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  ConnectorDefinition,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { randomUUID } from 'node:crypto'
import {
  noopConnectorIORecorder,
  pseudonymizeExternalId,
  type ConnectorIOEventInput,
  type ConnectorIORecorder,
} from './io-events.js'

export interface ConnectorCommandContext {
  connectorId: string
  command: string
  userId: string
  chatId?: string
  reply(message: string): Promise<void>
}

export type ConnectorCommandHandler = (context: ConnectorCommandContext) => Promise<void>

export interface ConnectorAdapterContext {
  commands: CommandRegistry
  updateSettings(patch: Record<string, string | number | boolean>): Promise<void>
  getServiceStatus(): string
  sendTest(connectorId: string): Promise<string>
}

export interface ConnectorAdapter {
  readonly id: string
  start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void>
  stop(): Promise<void>
  deliver(notification: InboxNotification): Promise<void>
  health(): ConnectorAdapterHealth
}

export interface ConnectorAdapterRegistration {
  definition: ConnectorDefinition
  create(): ConnectorAdapter
}

export class ConnectorRegistry {
  private readonly registrations = new Map<string, ConnectorAdapterRegistration>()

  register(registration: ConnectorAdapterRegistration): void {
    const id = registration.definition.id
    if (this.registrations.has(id)) throw new Error(`Connector adapter already registered: ${id}`)
    this.registrations.set(id, registration)
  }

  create(id: string): ConnectorAdapter {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown connector adapter: ${id}`)
    const adapter = registration.create()
    if (adapter.id !== id) throw new Error(`Connector adapter factory mismatch: expected ${id}, got ${adapter.id}`)
    return adapter
  }

  definitions(): ConnectorDefinition[] {
    return [...this.registrations.values()].map(({ definition }) => definition)
  }

  has(id: string): boolean {
    return this.registrations.has(id)
  }
}

export class CommandRegistry {
  private readonly handlers = new Map<string, ConnectorCommandHandler>()

  constructor(
    private readonly connectorId: string,
    private readonly recorder: ConnectorIORecorder = noopConnectorIORecorder,
  ) {}

  register(name: string, handler: ConnectorCommandHandler): void {
    const normalized = name.replace(/^\//, '').trim().toLowerCase()
    if (!normalized) throw new Error('Connector command name cannot be empty')
    if (this.handlers.has(normalized)) throw new Error(`Connector command already registered: ${normalized}`)
    this.handlers.set(normalized, handler)
  }

  async execute(context: ConnectorCommandContext): Promise<boolean> {
    const normalized = context.command.replace(/^\//, '').trim().toLowerCase()
    const handler = this.handlers.get(normalized)
    if (!handler) return false
    const correlationId = `command-${randomUUID()}`
    await this.record({
      correlationId,
      direction: 'inbound',
      stage: 'command.received',
      connectorId: this.connectorId,
      payload: {
        command: normalized,
        user: pseudonymizeExternalId(context.userId),
        chat: pseudonymizeExternalId(context.chatId),
      },
    })
    try {
      await handler({
        ...context,
        command: normalized,
        reply: async (message) => {
          await this.record({
            correlationId,
            direction: 'outbound',
            stage: 'command.replied',
            connectorId: this.connectorId,
            payload: { message },
          })
          await context.reply(message)
        },
      })
      return true
    } catch (error) {
      await this.record({
        correlationId,
        direction: 'outbound',
        stage: 'command.failed',
        connectorId: this.connectorId,
        payload: { error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }
  }

  private async record(event: ConnectorIOEventInput): Promise<void> {
    await this.recorder.record(event).catch((error) => {
      console.warn('[connector] I/O command event could not be recorded:', error instanceof Error ? error.message : error)
    })
  }
}
