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
import { dataPath } from '@/core/paths.js'
import type { ConnectorCenter } from '../../core/connector-center.js'

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

  /** Manually append a notification (exercises the same path as heartbeat / cron). */
  app.post('/send', async (c) => {
    const body = await c.req.json<{
      text: string
      media?: Array<{ type: 'image'; path: string }>
      source?: 'heartbeat' | 'cron' | 'manual' | 'task'
    }>()

    try {
      const entry = await connectorCenter.notify(body.text, {
        media: body.media,
        source: body.source ?? 'manual',
      })
      return c.json({ entry })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** List all session files (id + size). */
  app.get('/sessions', async (c) => {
    const dir = dataPath('sessions')
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
