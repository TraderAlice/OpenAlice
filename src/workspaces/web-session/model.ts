/**
 * Neutral live-conversation model shared by every Web transport.
 *
 * This is presentation-grade state for the browser, not a persisted store.
 * Each runtime's own transcript (Pi JSONL, Claude project files, Codex
 * rollouts, ACP agent storage) stays the durable conversation; Alice keeps one
 * live process per Session record and projects its protocol into this shape.
 * The shape borrows Pi's minimal message model on purpose: every supported
 * wire maps onto it without inventing a new schema, and the browser presenter
 * already groups it into turns.
 */

import type { WebSessionWire } from '../cli-adapter.js'

export type { WebSessionWire }

export type WebContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly thinking: string }
  | { readonly type: 'toolCall'; readonly id: string; readonly name: string; readonly arguments: unknown }
  | { readonly type: 'data'; readonly value: unknown }

export type WebConversationMessage =
  | { readonly role: 'user'; readonly content: readonly WebContentPart[] | string; readonly timestamp?: number }
  | { readonly role: 'assistant'; readonly content: readonly WebContentPart[]; readonly timestamp?: number }
  | {
      readonly role: 'toolResult'
      readonly toolCallId: string
      readonly toolName: string
      readonly content: readonly WebContentPart[] | string
      readonly isError: boolean
      readonly timestamp?: number
    }
  | { readonly role: 'notice'; readonly text: string; readonly timestamp?: number }
  /** A runtime record the transport could not classify; kept for the audit trail. */
  | { readonly role: 'unknown'; readonly value: unknown; readonly timestamp?: number }

export type WebRequestOptionTone = 'allow' | 'deny' | 'neutral'

export interface WebRequestOption {
  readonly id: string
  readonly label: string
  readonly tone: WebRequestOptionTone
}

/**
 * A question the runtime cannot answer on its own: a tool permission, a file
 * change approval, or a free-form user question. The browser presents the
 * options verbatim and answers with one `optionId`, or text when allowed.
 */
export interface WebPermissionRequest {
  readonly id: string
  readonly kind: 'permission' | 'question'
  readonly allowText?: boolean
  readonly secret?: boolean
  readonly title: string
  readonly description?: string
  readonly tool?: { readonly name: string; readonly input: unknown }
  readonly options: readonly WebRequestOption[]
  readonly createdAt: number
}

export type WebSessionPhase =
  | 'starting'
  | 'idle'
  | 'working'
  | 'awaiting-input'
  | 'compacting'
  | 'retrying'
  | 'stopped'
  | 'failed'

export interface WebSessionSnapshot {
  readonly recordId: string
  readonly wsId: string
  readonly resumeId: string
  readonly agent: string
  readonly wire: WebSessionWire
  /** Runtime-owned session identity once the transport has learned it. */
  readonly nativeSessionId: string | null
  readonly pid: number | null
  readonly startedAt: number
  readonly phase: WebSessionPhase
  readonly messages: readonly WebConversationMessage[]
  /** Current cumulative in-flight assistant message; replaced, never accumulated. */
  readonly streamingMessage: WebConversationMessage | null
  readonly requests: readonly WebPermissionRequest[]
  readonly error: string | null
  readonly stderrTail: string
  readonly revision: number
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Plain text of a neutral message body, for presenters and summaries. */
export function webContentText(content: readonly WebContentPart[] | string): string {
  if (typeof content === 'string') return content
  return content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
}
