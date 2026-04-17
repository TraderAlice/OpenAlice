import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'
import { AgentEventSchemas } from '../../../core/agent-event.js'

/**
 * Topology routes: GET /
 *
 * Returns the static shape of the agent's event-driven nervous system:
 * every known event type + every registered listener (with its subscribed
 * event type and declared emits). The frontend uses this to render a DAG
 * of Alice's async lifecycle.
 */
export function createTopologyRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/', (c) => {
    const eventTypes = Object.keys(AgentEventSchemas)
    const listeners = ctx.listenerRegistry.list().map((l) => ({
      name: l.name,
      eventType: l.eventType,
      emits: [...l.emits],
    }))
    return c.json({ eventTypes, listeners })
  })

  return app
}
