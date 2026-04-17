/**
 * Listener — standard interface for subscribing to AgentEvent types.
 *
 * A Listener represents a single handler for one event type. Filtering,
 * serial locks, and internal state are the listener's own responsibility —
 * the registry only manages subscription lifecycle and error isolation.
 *
 * Listeners declare what event types they emit via the `emits` field. The
 * Registry passes a `ListenerContext` into `handle()` whose `emit()` method
 * is constrained (compile + runtime) to the declared set. This keeps emit
 * declarations load-bearing — if a listener tries to emit an undeclared
 * type, it fails.
 */

import type { AgentEventMap } from './agent-event.js'
import type { AppendOpts, EventLog, EventLogEntry } from './event-log.js'

/** Handle-time context passed to a listener. Wraps the EventLog with
 *  a constrained emitter and read-only history access. */
export interface ListenerContext<
  Emits extends readonly (keyof AgentEventMap)[] = readonly (keyof AgentEventMap)[],
> {
  /**
   * Emit a child event. The `type` must be in this listener's declared `emits`.
   * `causedBy` defaults to the currently-handled event's seq (override via opts).
   */
  emit<E extends Emits[number]>(
    type: E,
    payload: AgentEventMap[E],
    opts?: AppendOpts,
  ): Promise<EventLogEntry<AgentEventMap[E]>>

  /** Read-only access to the event log (history queries). */
  readonly events: {
    read: EventLog['read']
    recent: EventLog['recent']
    query: EventLog['query']
    lastSeq: EventLog['lastSeq']
  }
}

export interface Listener<
  K extends keyof AgentEventMap = keyof AgentEventMap,
  Emits extends readonly (keyof AgentEventMap)[] = readonly (keyof AgentEventMap)[],
> {
  /** Unique name for identification (registry key, future UI display). */
  name: string
  /** Event type this listener subscribes to. */
  eventType: K
  /** Event types this listener may emit. Omitted = emits nothing. */
  emits?: Emits
  /** Called when a matching event is appended. */
  handle(
    entry: EventLogEntry<AgentEventMap[K]>,
    ctx: ListenerContext<Emits>,
  ): Promise<void>
}
