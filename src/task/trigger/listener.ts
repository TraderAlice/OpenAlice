/**
 * Trigger Listener — subscribes to `trigger` events from the EventLog
 * and routes them through the AgentCenter for processing.
 *
 * Triggers come from external sources (webhook, HTTP ingest, any producer
 * calling eventLog.append('trigger', ...)). This is the default routing
 * listener — it builds a prompt from the payload, asks the AI, notifies
 * via the connector center, and emits trigger.done / trigger.error events.
 */

import type { EventLogEntry } from '../../core/event-log.js'
import type { TriggerPayload } from '../../core/agent-event.js'
import type { AgentCenter } from '../../core/agent-center.js'
import { SessionStore } from '../../core/session.js'
import type { ConnectorCenter } from '../../core/connector-center.js'
import type { Listener, ListenerContext } from '../../core/listener.js'
import type { ListenerRegistry } from '../../core/listener-registry.js'

// ==================== Types ====================

const TRIGGER_EMITS = ['trigger.done', 'trigger.error'] as const
type TriggerEmits = typeof TRIGGER_EMITS

export interface TriggerListenerOpts {
  connectorCenter: ConnectorCenter
  agentCenter: AgentCenter
  /** Registry to auto-register this listener with. */
  registry: ListenerRegistry
  /** Optional: inject a session for testing. Otherwise creates a dedicated trigger session. */
  session?: SessionStore
}

export interface TriggerListener {
  /** Register the listener with the registry (idempotent). */
  start(): Promise<void>
  /** Unregister the listener from the registry. */
  stop(): void
  /** Expose the raw Listener object (for testing `handle()` directly). */
  readonly listener: Listener<'trigger', TriggerEmits>
}

// ==================== Prompt ====================

function buildPrompt(payload: TriggerPayload): string {
  return [
    'External event received.',
    '',
    `Source: ${payload.source}`,
    `Name:   ${payload.name}`,
    '',
    'Data:',
    JSON.stringify(payload.data, null, 2),
  ].join('\n')
}

// ==================== Factory ====================

export function createTriggerListener(opts: TriggerListenerOpts): TriggerListener {
  const { connectorCenter, agentCenter, registry } = opts
  const session = opts.session ?? new SessionStore('trigger/default')

  let processing = false
  let registered = false

  const listener: Listener<'trigger', TriggerEmits> = {
    name: 'trigger-router',
    eventType: 'trigger',
    emits: TRIGGER_EMITS,
    async handle(
      entry: EventLogEntry<TriggerPayload>,
      ctx: ListenerContext<TriggerEmits>,
    ): Promise<void> {
      const payload = entry.payload

      // Guard: skip if already processing (serial execution)
      if (processing) {
        console.warn(`trigger-listener: skipping ${payload.source}/${payload.name} (already processing)`)
        return
      }

      processing = true
      const startMs = Date.now()

      try {
        const prompt = buildPrompt(payload)
        const result = await agentCenter.askWithSession(prompt, session, {
          historyPreamble: `You are operating in the trigger-routing context (session: trigger/default, source: ${payload.source}). An external event was just received.`,
        })

        try {
          await connectorCenter.notify(result.text, {
            media: result.media,
            source: 'trigger',
          })
        } catch (sendErr) {
          console.warn(`trigger-listener: send failed for ${payload.source}/${payload.name}:`, sendErr)
        }

        await ctx.emit('trigger.done', {
          source: payload.source,
          name: payload.name,
          reply: result.text,
          durationMs: Date.now() - startMs,
        })
      } catch (err) {
        console.error(`trigger-listener: error processing ${payload.source}/${payload.name}:`, err)
        await ctx.emit('trigger.error', {
          source: payload.source,
          name: payload.name,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        })
      } finally {
        processing = false
      }
    },
  }

  return {
    listener,
    async start() {
      if (registered) return
      registry.register(listener)
      registered = true
    },
    stop() {
      if (registered) {
        registry.unregister(listener.name)
        registered = false
      }
    },
  }
}
