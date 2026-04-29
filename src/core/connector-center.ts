/**
 * ConnectorCenter — centralized management of outbound message delivery.
 *
 * Owns connector registration, interaction tracking, delivery targeting,
 * and outbound notification sending. Heartbeat, cron, and other callers
 * use `notify()` / `broadcast()` without knowing which connector is chosen.
 *
 * Design: single-tenant, multi-channel. One user, potentially reachable via
 * multiple connectors. Default send target follows the "last" strategy —
 * replies go to whichever channel the user most recently interacted through.
 */

import type { AppendOpts, EventLog, EventLogEntry } from './event-log.js'
import type { MediaAttachment } from './types.js'
import type { StreamableResult } from './ai-provider-manager.js'
import type { Connector, SendPayload, SendResult } from '../connectors/types.js'
import type { Listener } from './listener.js'
import type { ListenerRegistry } from './listener-registry.js'
import type { ProducerHandle } from './producer.js'
import type { MessageReceivedPayload, MessageSentPayload } from './agent-event.js'

export type { Connector, SendPayload, SendResult, ConnectorCapabilities } from '../connectors/types.js'

// ==================== Notify Types ====================

/** Options for notify() / broadcast(). */
export interface NotifyOpts {
  kind?: 'message' | 'notification'
  media?: MediaAttachment[]
  source?: 'heartbeat' | 'cron' | 'manual' | 'task'
}

/** Result of a notify() call. */
export interface NotifyResult extends SendResult {
  /** Which channel was used for delivery (undefined if no connector available). */
  channel?: string
}

// ==================== Interaction Tracking ====================

export interface LastInteraction {
  channel: string
  to: string
  ts: number
}

// ==================== ConnectorCenter ====================

export interface ConnectorCenterOpts {
  eventLog?: EventLog
  listenerRegistry?: ListenerRegistry
}

export class ConnectorCenter {
  private connectors = new Map<string, Connector>()
  private lastInteraction: LastInteraction | null = null
  private listenerRegistry: ListenerRegistry | null = null
  /** Shared producer for `message.received` / `message.sent` across every
   *  connector. Declared once on construction when a registry is available;
   *  null when ConnectorCenter runs without a registry (legacy test setup). */
  private producer: ProducerHandle<readonly ['message.received', 'message.sent']> | null = null
  /** Name under which the interaction-tracking listener was registered, so
   *  `stop()` can unregister it symmetrically. */
  private interactionListenerName: string | null = null

  constructor(opts?: ConnectorCenterOpts | EventLog) {
    // Backward-compat: accept bare EventLog for tests that pre-date the options shape
    const resolved: ConnectorCenterOpts =
      opts && typeof (opts as EventLog).subscribeType === 'function'
        ? { eventLog: opts as EventLog }
        : (opts as ConnectorCenterOpts | undefined) ?? {}

    const { eventLog, listenerRegistry } = resolved

    // Restore last interaction from event log buffer (survives restart)
    if (eventLog) {
      const recent = eventLog.recent({ type: 'message.received' })
      if (recent.length > 0) {
        const last = recent[recent.length - 1]
        const { channel, to } = last.payload as { channel: string; to: string }
        this.lastInteraction = { channel, to, ts: last.ts }
      }
    }

    // Register interaction-tracking listener + declare the shared message
    // producer. Both require a registry; when absent (legacy test doubles)
    // ConnectorCenter still works for delivery but can't emit messaging
    // events — callers that try hit a loud error from emitMessageReceived /
    // emitMessageSent rather than silently dropping.
    if (listenerRegistry) {
      this.listenerRegistry = listenerRegistry

      const listener: Listener<'message.received'> = {
        name: 'connector-interaction-tracker',
        subscribes: 'message.received',
        handle: async (entry) => {
          this.touch(entry.payload.channel, entry.payload.to)
        },
      }
      listenerRegistry.register(listener)
      this.interactionListenerName = listener.name

      this.producer = listenerRegistry.declareProducer({
        name: 'connectors',
        emits: ['message.received', 'message.sent'] as const,
      })
    }
  }

  /** Register a Connector instance. Replaces any existing registration for this channel. */
  register(connector: Connector): () => void {
    this.connectors.set(connector.channel, connector)
    return () => { this.connectors.delete(connector.channel) }
  }

  /** Emit a `message.received` event on behalf of any connector. The
   *  payload's `channel` field carries source attribution (`'web'`,
   *  `'telegram'`, etc.). Throws if the center was constructed without
   *  a ListenerRegistry — emitting messages without a bus is a bug. */
  async emitMessageReceived(
    payload: MessageReceivedPayload,
    opts?: AppendOpts,
  ): Promise<EventLogEntry<MessageReceivedPayload>> {
    if (!this.producer) {
      throw new Error(
        'ConnectorCenter: cannot emit message.received — no ListenerRegistry was supplied at construction',
      )
    }
    return this.producer.emit('message.received', payload, opts)
  }

  /** Emit a `message.sent` event on behalf of any connector. See
   *  {@link emitMessageReceived} for the `listenerRegistry` requirement. */
  async emitMessageSent(
    payload: MessageSentPayload,
    opts?: AppendOpts,
  ): Promise<EventLogEntry<MessageSentPayload>> {
    if (!this.producer) {
      throw new Error(
        'ConnectorCenter: cannot emit message.sent — no ListenerRegistry was supplied at construction',
      )
    }
    return this.producer.emit('message.sent', payload, opts)
  }

  /** Tear down registry-held resources: dispose the shared producer and
   *  unregister the interaction-tracking listener. Safe to call on a
   *  registry-less center (no-op). Call before `listenerRegistry.stop()`
   *  during shutdown. */
  stop(): void {
    this.producer?.dispose()
    this.producer = null
    if (this.interactionListenerName && this.listenerRegistry) {
      this.listenerRegistry.unregister(this.interactionListenerName)
      this.interactionListenerName = null
    }
  }

  /** Record that the user just interacted via this channel. */
  private touch(channel: string, to: string): void {
    this.lastInteraction = { channel, to, ts: Date.now() }
  }

  /** Get the last interaction info (channel + recipient). */
  getLastInteraction(): LastInteraction | null {
    return this.lastInteraction
  }

  /** Get a specific connector by channel name. */
  get(channel: string): Connector | null {
    return this.connectors.get(channel) ?? null
  }

  /** List all registered connectors. */
  list(): Connector[] {
    return [...this.connectors.values()]
  }

  /** Check if any connectors are registered. */
  hasConnectors(): boolean {
    return this.connectors.size > 0
  }

  /**
   * Send a notification to the last-interacted connector.
   * Falls back to the first registered connector if no interaction yet.
   */
  async notify(text: string, opts?: NotifyOpts): Promise<NotifyResult> {
    const target = this.resolveTarget()
    if (!target) return { delivered: false }

    const payload = this.buildPayload(text, opts)
    const result = await target.send(payload)
    return { ...result, channel: target.channel }
  }

  /**
   * Stream a notification to the last-interacted connector.
   * If the connector supports sendStream, delegates streaming directly.
   * Otherwise drains the stream and falls back to send() with the completed result.
   */
  async notifyStream(stream: StreamableResult, opts?: NotifyOpts): Promise<NotifyResult> {
    const target = this.resolveTarget()
    if (!target) {
      await stream // drain to prevent hanging generator
      return { delivered: false }
    }

    if (target.sendStream) {
      const result = await target.sendStream(stream, {
        kind: opts?.kind ?? 'notification',
        source: opts?.source,
      })
      return { ...result, channel: target.channel }
    }

    // Fallback: drain stream, send completed result
    const completed = await stream
    const payload = this.buildPayload(completed.text, {
      kind: opts?.kind,
      media: completed.media,
      source: opts?.source,
    })
    const result = await target.send(payload)
    return { ...result, channel: target.channel }
  }

  /**
   * Broadcast a notification to all push-capable connectors.
   * Returns one result per connector that was attempted.
   */
  async broadcast(text: string, opts?: NotifyOpts): Promise<NotifyResult[]> {
    const pushable = this.list().filter((c) => c.capabilities.push)
    if (pushable.length === 0) return []

    const payload = this.buildPayload(text, opts)
    const results: NotifyResult[] = []

    for (const connector of pushable) {
      try {
        const result = await connector.send(payload)
        results.push({ ...result, channel: connector.channel })
      } catch {
        results.push({ delivered: false, channel: connector.channel })
      }
    }

    return results
  }

  // ==================== Private ====================

  /** Resolve the send target: the connector the user last interacted with. */
  private resolveTarget(): Connector | null {
    if (!this.lastInteraction) {
      const first = this.connectors.values().next()
      return first.done ? null : first.value
    }

    const connector = this.connectors.get(this.lastInteraction.channel)
    if (connector) return connector

    // Channel was unregistered since — fall back to first available
    const first = this.connectors.values().next()
    return first.done ? null : first.value
  }

  /** Build a SendPayload from text + options. */
  private buildPayload(text: string, opts?: NotifyOpts): SendPayload {
    return {
      kind: opts?.kind ?? 'notification',
      text,
      media: opts?.media,
      source: opts?.source,
    }
  }
}
