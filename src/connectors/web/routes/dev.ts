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
 * and cron: connectorCenter.notify(text, opts).
 */
import { Hono } from 'hono'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectorCenter } from '../../../core/connector-center.js'

export function createDevRoutes(connectorCenter: ConnectorCenter) {
  const app = new Hono()

  /** List all registered connectors + last interaction info. */
  app.get('/registry', (c) => {
    const connectors = connectorCenter.list().map((cn) => ({
      channel: cn.channel,
      to: cn.to,
      capabilities: cn.capabilities,
    }))
    return c.json({ connectors, lastInteraction: connectorCenter.getLastInteraction() })
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

    const opts = {
      kind: body.kind ?? 'notification' as const,
      media: body.media,
      source: (body.source as 'heartbeat' | 'cron' | 'manual') ?? 'manual',
    }

    try {
      if (body.channel) {
        // Send to a specific channel
        const target = connectorCenter.get(body.channel)
        if (!target) return c.json({ error: `No connector for channel: ${body.channel}` }, 404)
        const result = await target.send({ text: body.text, ...opts })
        return c.json({ channel: target.channel, to: target.to, ...result })
      }

      // Default: notify via last-interacted connector
      const result = await connectorCenter.notify(body.text, opts)
      return c.json(result)
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
