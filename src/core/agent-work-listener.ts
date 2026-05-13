/**
 * AgentWorkListener — single dispatch point for all `agent.work.requested`
 * events.
 *
 * Subscribes to one canonical event type; routes each event to the right
 * per-source configuration (preamble, session, gates, payload-metadata
 * builders) by looking up `payload.source` in a runtime registry.
 *
 * Each trigger source (heartbeat, cron, webhook) registers its config
 * at startup. Adding a new trigger source = registering one more
 * `AgentWorkSourceConfig`; no new listener, no new event type.
 *
 * The runner emits canonical `agent.work.{done,skip,error}` events
 * with the source label baked into the payload — downstream consumers
 * filter on the source field rather than subscribing to per-source event
 * types.
 */

import type { Listener, ListenerContext } from './listener.js'
import type { ListenerRegistry } from './listener-registry.js'
import type { ISessionStore } from './session.js'
import type { NotificationSource } from './notifications-store.js'
import type { AgentWorkRequest, AgentWorkRunner, AgentWorkSkip } from './agent-work.js'
import type { ProviderResult } from '../ai-providers/types.js'
import type { AgentWorkRequestedPayload } from './agent-event.js'

// ==================== Source config ====================

/** Per-source configuration. Each trigger source registers one of these
 *  at startup; the listener uses it to build an AgentWorkRequest when
 *  an event arrives with the matching `source` field. */
export interface AgentWorkSourceConfig {
  source: NotificationSource
  /** Session scope for this source. All work from a given source shares
   *  the same conversation history. */
  session: ISessionStore
  /** Build the AI history preamble. Receives the event's `metadata`
   *  so per-event context (e.g. cron job name) can be threaded in. */
  preamble: (metadata: Record<string, unknown> | undefined) => string
  /** Optional post-AI gate — decides deliver vs skip (with reason). */
  outputGate?: AgentWorkRequest['outputGate']
  /** Optional bookkeeping callback after a successful delivery. */
  onDelivered?: AgentWorkRequest['onDelivered']
  /** Source-specific metadata to attach to the `agent.work.done` payload.
   *  Defaults to passing through the request metadata. */
  buildDoneMetadata?: (
    req: AgentWorkRequest,
    result: ProviderResult,
  ) => Record<string, unknown> | undefined
  /** Source-specific metadata for `agent.work.skip` payloads. */
  buildSkipMetadata?: (
    req: AgentWorkRequest,
    skip: AgentWorkSkip,
  ) => Record<string, unknown> | undefined
  /** Source-specific metadata for `agent.work.error` payloads. */
  buildErrorMetadata?: (
    req: AgentWorkRequest,
    err: Error,
  ) => Record<string, unknown> | undefined
}

// ==================== Listener types ====================

const AGENT_WORK_EMITS = [
  'agent.work.done',
  'agent.work.skip',
  'agent.work.error',
] as const
type AgentWorkEmits = typeof AGENT_WORK_EMITS

export interface AgentWorkListenerOpts {
  runner: AgentWorkRunner
  registry: ListenerRegistry
  /** Inject logger for tests (defaults to console). */
  logger?: Pick<Console, 'warn' | 'error'>
}

export interface AgentWorkListener {
  start(): Promise<void>
  stop(): void
  /** Register a source config. Idempotent on `config.source` — re-registering
   *  the same source overwrites the previous entry. */
  registerSource(config: AgentWorkSourceConfig): void
  /** List registered source labels — surfaced by the Automation Flow UI. */
  listSources(): ReadonlyArray<NotificationSource>
  /** Expose the raw listener for direct testing. */
  readonly listener: Listener<'agent.work.requested', AgentWorkEmits>
}

// ==================== Factory ====================

export function createAgentWorkListener(opts: AgentWorkListenerOpts): AgentWorkListener {
  const { runner, registry } = opts
  const logger = opts.logger ?? console
  const sources = new Map<NotificationSource, AgentWorkSourceConfig>()
  let registered = false

  const listener: Listener<'agent.work.requested', AgentWorkEmits> = {
    name: 'agent-work-listener',
    subscribes: 'agent.work.requested',
    emits: AGENT_WORK_EMITS,
    async handle(
      entry,
      ctx: ListenerContext<AgentWorkEmits>,
    ): Promise<void> {
      const payload = entry.payload as AgentWorkRequestedPayload
      const config = sources.get(payload.source)
      if (!config) {
        // Unknown source — typically a misconfigured trigger or a
        // legitimately-new source whose registration hasn't run yet.
        // Don't emit (we don't know which source to attribute to);
        // log loudly and drop.
        logger.warn(
          `agent-work-listener: no source registered for '${payload.source}'; dropping (prompt: ${payload.prompt.slice(0, 60)})`,
        )
        return
      }

      // Build the AgentWorkRequest from the event + source config.
      // emitNames are FIXED canonical — the runner emits agent.work.*
      // events regardless of source. The source field is baked into
      // each payload via the build*Payload functions below.
      const request: AgentWorkRequest = {
        prompt: payload.prompt,
        session: config.session,
        preamble: config.preamble(payload.metadata),
        metadata: { source: config.source, ...(payload.metadata ?? {}) },
        outputGate: config.outputGate,
        onDelivered: config.onDelivered,
        emitNames: {
          done: 'agent.work.done',
          skip: 'agent.work.skip',
          error: 'agent.work.error',
        },
        buildDonePayload: (req, result, durationMs, delivered) => ({
          source: config.source,
          reply: result.text,
          durationMs,
          delivered,
          metadata: config.buildDoneMetadata?.(req, result) ?? payload.metadata,
        }),
        buildSkipPayload: (req, skip) => ({
          source: config.source,
          reason: skip.reason,
          metadata: config.buildSkipMetadata?.(req, skip) ?? payload.metadata,
        }),
        buildErrorPayload: (req, err, durationMs) => ({
          source: config.source,
          error: err.message,
          durationMs,
          metadata: config.buildErrorMetadata?.(req, err) ?? payload.metadata,
        }),
      }

      await runner.run(request, ctx.emit as never)
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
    registerSource(config) {
      sources.set(config.source, config)
    },
    listSources() {
      return [...sources.keys()]
    },
  }
}
