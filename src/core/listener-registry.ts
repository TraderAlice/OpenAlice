/**
 * ListenerRegistry — centralized lifecycle management for Listeners.
 *
 * Each module that needs to listen owns its Listener and calls
 * `registry.register(...)` during its own setup. The registry activates
 * all registered listeners together via `start()` and tears them down
 * via `stop()`.
 *
 * On subscription, the registry wraps the EventLog into a `ListenerContext`
 * whose `emit()` is constrained to the listener's declared `emits`. This
 * both enforces the declaration at runtime and auto-populates `causedBy`
 * with the currently-handled event's seq.
 *
 * Errors thrown inside a listener's `handle()` are caught and logged —
 * they do not affect other listeners.
 */

import type { AgentEventMap } from './agent-event.js'
import type { AppendOpts, EventLog, EventLogEntry } from './event-log.js'
import type { Listener, ListenerContext } from './listener.js'

export interface ListenerInfo {
  name: string
  eventType: string
  emits: ReadonlyArray<string>
}

export interface ListenerRegistry {
  /** Register a listener. Throws if the name is already taken. */
  register<K extends keyof AgentEventMap, E extends readonly (keyof AgentEventMap)[]>(
    listener: Listener<K, E>,
  ): void
  /** Unregister a listener by name. Unsubscribes it if the registry is started. No-op if not found. */
  unregister(name: string): void
  /** Activate all registered listeners (subscribe to EventLog). */
  start(): Promise<void>
  /** Deactivate all listeners (unsubscribe). */
  stop(): Promise<void>
  /** Introspection — registered listener names, event types, emits. */
  list(): ReadonlyArray<ListenerInfo>
}

export function createListenerRegistry(eventLog: EventLog): ListenerRegistry {
  // Storage is necessarily wide-typed (union across all event types).
  // Per-call type precision is preserved via the generic `register<K, E>` signature.
  type AnyListener = Listener<keyof AgentEventMap, readonly (keyof AgentEventMap)[]>
  const listeners = new Map<string, AnyListener>()
  const unsubscribes = new Map<string, () => void>()
  let started = false

  function register<K extends keyof AgentEventMap, E extends readonly (keyof AgentEventMap)[]>(
    listener: Listener<K, E>,
  ): void {
    if (listeners.has(listener.name)) {
      throw new Error(`ListenerRegistry: listener "${listener.name}" already registered`)
    }
    listeners.set(listener.name, listener as unknown as AnyListener)
    // If registry is already running, subscribe immediately
    if (started) {
      subscribeOne(listener as unknown as AnyListener)
    }
  }

  function buildContext(
    listener: AnyListener,
    parentEntry: EventLogEntry,
  ): ListenerContext<readonly (keyof AgentEventMap)[]> {
    const declared = new Set<string>(listener.emits ?? [])

    return {
      async emit(type, payload, opts?: AppendOpts) {
        if (!declared.has(type as string)) {
          const declaredList = [...declared].join(', ') || '(none)'
          throw new Error(
            `Listener '${listener.name}' tried to emit '${type as string}' but declared emits: ${declaredList}`,
          )
        }
        // Auto-set causedBy unless caller explicitly provided one
        const mergedOpts: AppendOpts = {
          ...opts,
          causedBy: opts?.causedBy ?? parentEntry.seq,
        }
        return eventLog.append(type as keyof AgentEventMap, payload as never, mergedOpts) as never
      },
      events: {
        read: eventLog.read,
        recent: eventLog.recent,
        query: eventLog.query,
        lastSeq: eventLog.lastSeq,
      },
    }
  }

  function subscribeOne(listener: AnyListener): void {
    const unsub = eventLog.subscribeType(listener.eventType, (entry) => {
      const ctx = buildContext(listener, entry)
      // Fire-and-forget with error isolation
      Promise.resolve()
        .then(() => listener.handle(entry, ctx))
        .catch((err) => {
          console.error(`listener[${listener.name}]: unhandled error:`, err)
        })
    })
    unsubscribes.set(listener.name, unsub)
  }

  function unregister(name: string): void {
    const existing = listeners.get(name)
    if (!existing) return
    listeners.delete(name)
    const unsub = unsubscribes.get(name)
    if (unsub) {
      try { unsub() } catch { /* swallow */ }
      unsubscribes.delete(name)
    }
  }

  async function start(): Promise<void> {
    if (started) return
    started = true
    for (const listener of listeners.values()) {
      subscribeOne(listener)
    }
  }

  async function stop(): Promise<void> {
    if (!started) return
    started = false
    for (const unsub of unsubscribes.values()) {
      try { unsub() } catch { /* swallow */ }
    }
    unsubscribes.clear()
  }

  function list(): ReadonlyArray<ListenerInfo> {
    return Array.from(listeners.values()).map((l) => ({
      name: l.name,
      eventType: l.eventType,
      emits: [...(l.emits ?? [])],
    }))
  }

  return { register, unregister, start, stop, list }
}
