/**
 * Read-only Web UI projection for the active-Workspace Agent Dispatch board.
 */
import { Hono } from 'hono'
import { compress } from 'hono/compress'

import { buildDispatchBoardSnapshot } from '../../workspaces/dispatch-board.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function parseTimestampParam(raw: string | undefined): { ok: true; value?: number } | { ok: false } {
  if (raw === undefined || raw === '') return { ok: true }
  if (!/^-?\d+$/.test(raw.trim())) return { ok: false }
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? { ok: true, value: parsed } : { ok: false }
}

export function createDispatchRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()
  app.use('*', compress())

  app.get('/', async (c) => {
    const fromParsed = parseTimestampParam(c.req.query('from'))
    const toParsed = parseTimestampParam(c.req.query('to'))
    if (!fromParsed.ok || !toParsed.ok) {
      return c.json({ error: 'Invalid from/to query timestamp' }, 400)
    }

    const snapshot = await buildDispatchBoardSnapshot(svc, {
      ...(fromParsed.value !== undefined ? { fromMs: fromParsed.value } : {}),
      ...(toParsed.value !== undefined ? { toMs: toParsed.value } : {}),
    })
    return c.json(snapshot)
  })

  return app
}
