/**
 * Dev Routes — debug endpoints for inspecting and testing the connector
 * send pipeline without waiting for heartbeat/cron to fire.
 *
 * Endpoints:
 *   GET  /registry  — list registered connectors + lastInteraction
 *   POST /send      — manually push a message through a connector
 *   GET  /sessions  — list session JSONL files on disk
 *
 * The /send endpoint exercises the exact same code path as heartbeat
 * and cron: resolveDeliveryTarget() → connector.send(payload).
 */
import { Hono } from 'hono'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  listConnectors,
  resolveDeliveryTarget,
  getLastInteraction,
  type Connector,
} from '../../../core/connector-registry.js'

export function createDevRoutes() {
  const app = new Hono()

  /** List all registered connectors + last interaction info. */
  app.get('/registry', (c) => {
    const connectors = listConnectors().map((cn) => ({
      channel: cn.channel,
      to: cn.to,
      capabilities: cn.capabilities,
    }))
    return c.json({ connectors, lastInteraction: getLastInteraction() })
  })

  /** Manually send a test message through a connector. */
  app.post('/send', async (c) => {
    const body = await c.req.json<{
      channel?: string
      kind?: 'message' | 'notification'
      text: string
      media?: Array<{ type: 'image'; path: string }>
      source?: string
    }>()

    let target: Connector | null
    if (body.channel) {
      target = listConnectors().find((cn) => cn.channel === body.channel) ?? null
    } else {
      target = resolveDeliveryTarget()
    }

    if (!target) {
      return c.json({ error: 'No connector available' }, 404)
    }

    try {
      const result = await target.send({
        kind: body.kind ?? 'notification',
        text: body.text,
        media: body.media,
        source: (body.source as 'heartbeat' | 'cron' | 'manual') ?? 'manual',
      })
      return c.json({ channel: target.channel, to: target.to, ...result })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** List all session files (id + size). */
  app.get('/sessions', async (c) => {
    const dir = join(process.cwd(), 'data', 'sessions')
    try {
      const files = await readdir(dir)
      const sessions = await Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map(async (f) => {
            const s = await stat(join(dir, f))
            return { id: f.replace('.jsonl', ''), sizeBytes: s.size }
          }),
      )
      return c.json({ sessions })
    } catch {
      return c.json({ sessions: [] })
    }
  })

  return app
}
