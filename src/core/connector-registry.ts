/**
 * Connector Registry — tracks active send channels and last user interaction.
 *
 * Connectors (Telegram, Web, MCP-ask, etc.) implement the Connector interface
 * and register themselves on startup. The scheduler uses this to route
 * heartbeat/cron responses back to the user through the last-interacted channel.
 *
 * Design: single-tenant, multi-channel. One user, potentially reachable via
 * multiple connectors. Send target follows the "last" strategy — replies
 * go to whichever channel the user most recently interacted through.
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
 * registers itself with the ConnectorRegistry.
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

// ==================== Convenience Helpers ====================

/** Options for sendMessage / sendNotification helpers. */
export interface SendOptions {
  media?: MediaAttachment[]
  source?: 'heartbeat' | 'cron' | 'manual'
}

/** Send a chat message through a connector. */
export function sendMessage(
  connector: Connector, text: string, opts?: SendOptions,
): Promise<SendResult> {
  return connector.send({ kind: 'message', text, ...opts })
}

/** Send a notification through a connector. */
export function sendNotification(
  connector: Connector, text: string, opts?: SendOptions,
): Promise<SendResult> {
  return connector.send({ kind: 'notification', text, ...opts })
}

// ==================== Types ====================

export interface LastInteraction {
  channel: string
  to: string
  ts: number
}

// ==================== Registry ====================

const connectors = new Map<string, Connector>()
let lastInteraction: LastInteraction | null = null

/** Register a Connector instance. Replaces any existing registration for this channel. */
export function registerConnector(connector: Connector): () => void {
  connectors.set(connector.channel, connector)
  return () => { connectors.delete(connector.channel) }
}

/** Record that the user just interacted via this channel. */
export function touchInteraction(channel: string, to: string): void {
  lastInteraction = { channel, to, ts: Date.now() }
}

/** Get the last interaction info (channel + recipient). */
export function getLastInteraction(): LastInteraction | null {
  return lastInteraction
}

/** Resolve the send target: the connector the user last interacted with. */
export function resolveDeliveryTarget(): Connector | null {
  if (!lastInteraction) {
    // No interaction yet — fall back to first registered connector
    const first = connectors.values().next()
    return first.done ? null : first.value
  }

  // Prefer the last-interacted channel
  const connector = connectors.get(lastInteraction.channel)
  if (connector) return connector

  // Channel was unregistered since — fall back to first available
  const first = connectors.values().next()
  return first.done ? null : first.value
}

/** List all registered connectors. */
export function listConnectors(): Connector[] {
  return [...connectors.values()]
}

/** Check if any connectors are registered. */
export function hasConnectors(): boolean {
  return connectors.size > 0
}

// ==================== Testing ====================

export function _resetForTest(): void {
  connectors.clear()
  lastInteraction = null
}
