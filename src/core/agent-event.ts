/**
 * Agent Event Type System — typed event registry with runtime validation.
 *
 * Defines `AgentEventMap` (type → payload mapping) and TypeBox schemas
 * for runtime validation of event payloads. Used by EventLog to enforce
 * type safety on `append()` and `subscribeType()`.
 *
 * Adding a new event type:
 *   1. Define its payload interface
 *   2. Add it to `AgentEventMap`
 *   3. Add its TypeBox schema to `AgentEventSchemas`
 */

import { Type, type TSchema } from '@sinclair/typebox'
import AjvPkg from 'ajv'

// Re-export CronFirePayload from its canonical location
export type { CronFirePayload } from '../task/cron/engine.js'

// ==================== Payload Interfaces ====================

export interface CronDonePayload {
  jobId: string
  jobName: string
  reply: string
  durationMs: number
}

export interface CronErrorPayload {
  jobId: string
  jobName: string
  error: string
  durationMs: number
}

export interface HeartbeatDonePayload {
  reply: string
  reason: string
  durationMs: number
  delivered: boolean
}

export interface HeartbeatSkipPayload {
  reason: string
  parsedReason?: string
}

export interface HeartbeatErrorPayload {
  error: string
  durationMs: number
}

export interface MessageReceivedPayload {
  channel: string
  to: string
  prompt: string
}

export interface MessageSentPayload {
  channel: string
  to: string
  prompt: string
  reply: string
  durationMs: number
}

/** Generic external event — used by webhooks, API ingest, or any external producer. */
export interface TriggerPayload {
  source: string
  name: string
  data: Record<string, unknown>
}

// ==================== Event Map ====================

// Import the actual CronFirePayload type for use in the map
import type { CronFirePayload } from '../task/cron/engine.js'

export interface AgentEventMap {
  'cron.fire': CronFirePayload
  'cron.done': CronDonePayload
  'cron.error': CronErrorPayload
  'heartbeat.done': HeartbeatDonePayload
  'heartbeat.skip': HeartbeatSkipPayload
  'heartbeat.error': HeartbeatErrorPayload
  'message.received': MessageReceivedPayload
  'message.sent': MessageSentPayload
  'trigger': TriggerPayload
}

// ==================== TypeBox Schemas ====================

const CronFireSchema = Type.Object({
  jobId: Type.String(),
  jobName: Type.String(),
  payload: Type.String(),
})

const CronDoneSchema = Type.Object({
  jobId: Type.String(),
  jobName: Type.String(),
  reply: Type.String(),
  durationMs: Type.Number(),
})

const CronErrorSchema = Type.Object({
  jobId: Type.String(),
  jobName: Type.String(),
  error: Type.String(),
  durationMs: Type.Number(),
})

const HeartbeatDoneSchema = Type.Object({
  reply: Type.String(),
  reason: Type.String(),
  durationMs: Type.Number(),
  delivered: Type.Boolean(),
})

const HeartbeatSkipSchema = Type.Object({
  reason: Type.String(),
  parsedReason: Type.Optional(Type.String()),
})

const HeartbeatErrorSchema = Type.Object({
  error: Type.String(),
  durationMs: Type.Number(),
})

const MessageReceivedSchema = Type.Object({
  channel: Type.String(),
  to: Type.String(),
  prompt: Type.String(),
})

const MessageSentSchema = Type.Object({
  channel: Type.String(),
  to: Type.String(),
  prompt: Type.String(),
  reply: Type.String(),
  durationMs: Type.Number(),
})

const TriggerSchema = Type.Object({
  source: Type.String(),
  name: Type.String(),
  data: Type.Record(Type.String(), Type.Unknown()),
})

/** Schema registry — same keys as AgentEventMap. */
export const AgentEventSchemas: { [K in keyof AgentEventMap]: TSchema } = {
  'cron.fire': CronFireSchema,
  'cron.done': CronDoneSchema,
  'cron.error': CronErrorSchema,
  'heartbeat.done': HeartbeatDoneSchema,
  'heartbeat.skip': HeartbeatSkipSchema,
  'heartbeat.error': HeartbeatErrorSchema,
  'message.received': MessageReceivedSchema,
  'message.sent': MessageSentSchema,
  'trigger': TriggerSchema,
}

// ==================== Runtime Validation ====================

// Ajv ESM interop (same pattern as openclaw/gateway/protocol)
const ajv = new (AjvPkg as unknown as new (opts?: object) => import('ajv').default)({
  allErrors: true,
  strict: false,
})

const validators = new Map<string, ReturnType<typeof ajv.compile>>()
for (const [type, schema] of Object.entries(AgentEventSchemas)) {
  validators.set(type, ajv.compile(schema))
}

/**
 * Validate a payload against its registered schema.
 * - Registered type + valid payload → returns silently
 * - Registered type + invalid payload → throws Error
 * - Unregistered type → returns silently (no schema to check)
 */
export function validateEventPayload(type: string, payload: unknown): void {
  const validate = validators.get(type)
  if (!validate) return
  if (!validate(payload)) {
    const errors = validate.errors?.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ')
    throw new Error(`Invalid payload for event "${type}": ${errors}`)
  }
}
