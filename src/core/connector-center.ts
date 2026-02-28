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

import type { MediaAttachment } from './types.js'

// ==================== Send Types ====================

/** Structured payload for outbound send (heartbeat, cron, manual, etc.). */
export interface SendPayload {
  /** Whether this is a chat message or a notification. */
  kind: 'message' | 'notification'
  /** The text content to send. */
  text: string
  /** Media attachments (e.g. screenshots from tools). */
  media?: MediaAttachment[]
  /** Where this payload originated from. */
  source?: 'heartbeat' | 'cron' | 'manual'
}

/** Result of a send() call. */
export interface SendResult {
  /** Whether the message was actually sent (false for pull-based connectors). */
  delivered: boolean
}

// ==================== Connector Interface ====================

/** Discoverable capabilities a connector may support. */
export interface ConnectorCapabilities {
  /** Can push messages proactively (heartbeat/cron). False for pull-based. */
  push: boolean
  /** Can send media attachments (images). */
  media: boolean
}

/**
 * A connector that can send outbound messages to a user.
 *
 * Each plugin (Telegram, Web, MCP-ask) implements this interface and
 * registers itself with the ConnectorCenter.
 */
export interface Connector {
  /** Channel identifier, e.g. "telegram", "web", "mcp-ask". */
  readonly channel: string
  /** Recipient identifier (chat id, "default", session id, etc.). */
  readonly to: string
  /** What this connector can do. */
  readonly capabilities: ConnectorCapabilities
  /** Send a structured payload through this connector. */
  send(payload: SendPayload): Promise<SendResult>
}

// ==================== Notify Types ====================

/** Options for notify() / broadcast(). */
export interface NotifyOpts {
  kind?: 'message' | 'notification'
  media?: MediaAttachment[]
  source?: 'heartbeat' | 'cron' | 'manual'
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

export class ConnectorCenter {
  private connectors = new Map<string, Connector>()
  private lastInteraction: LastInteraction | null = null

  /** Register a Connector instance. Replaces any existing registration for this channel. */
  register(connector: Connector): () => void {
    this.connectors.set(connector.channel, connector)
    return () => { this.connectors.delete(connector.channel) }
  }

  /** Record that the user just interacted via this channel. */
  touch(channel: string, to: string): void {
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
