/**
 * Inbox HTTP route — read history + dev-only seed.
 *
 *   GET    /history?limit=&before=&workspaceId= paginated, newest-first
 *   PUT    /:id/read                            mark one entry read
 *   DELETE /:id/read                            mark one entry unread
 *   POST   /seed                                dev-only: append an entry
 *
 * UI polls /history every 20s. Production writes still come from workspace
 * tools (`inbox_push` via MCP/CLI gateway); `/seed` is only for manual/dev
 * appends. Read/unread writes are user actions and stay in this HTTP surface.
 */
import { Hono } from 'hono'
import type { IInboxStore, InboxDoc } from '../../core/inbox-store.js'

export interface InboxRoutesDeps {
  inboxStore: IInboxStore
}

export function createInboxRoutes(deps: InboxRoutesDeps) {
  const app = new Hono()

  app.get('/history', async (c) => {
    const limit = Number(c.req.query('limit')) || 100
    const before = c.req.query('before') || undefined
    const workspaceId = c.req.query('workspaceId') || undefined
    const result = await deps.inboxStore.read({ limit, before, workspaceId })
    return c.json(result)
  })

  app.put('/:id/read', async (c) => {
    const id = c.req.param('id')
    const readAt = Date.now()
    const ok = await deps.inboxStore.markRead(id, readAt)
    if (!ok) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true, id, readAt })
  })

  app.delete('/:id/read', async (c) => {
    const id = c.req.param('id')
    const ok = await deps.inboxStore.markUnread(id)
    if (!ok) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true, id })
  })

  app.post('/seed', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    const b = body as Partial<{
      workspaceId: string
      workspaceLabel: string
      docs: unknown
      comments: string
    }>
    if (!b.workspaceId || typeof b.workspaceId !== 'string') {
      return c.json({ error: 'workspaceId required' }, 400)
    }

    // Validate docs shape if present
    let docs: InboxDoc[] | undefined
    if (b.docs !== undefined) {
      if (!Array.isArray(b.docs)) {
        return c.json({ error: 'docs must be an array' }, 400)
      }
      docs = []
      for (const d of b.docs) {
        if (typeof d !== 'object' || d === null) {
          return c.json({ error: 'each doc must be an object' }, 400)
        }
        const path = (d as { path?: unknown }).path
        if (typeof path !== 'string' || !path) {
          return c.json({ error: 'each doc must have a non-empty `path` string' }, 400)
        }
        docs.push({ path })
      }
    }

    const comments = typeof b.comments === 'string' ? b.comments : undefined

    try {
      const entry = await deps.inboxStore.append({
        workspaceId: b.workspaceId,
        workspaceLabel: typeof b.workspaceLabel === 'string' ? b.workspaceLabel : undefined,
        docs,
        comments,
      })
      return c.json({ entry })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Hard-delete an inbox entry. 204 on success, 404 when no entry
   *  matches. Matches the "archive" affordance in the inbox UI, but
   *  the semantics are full removal — we don't have an "underlying
   *  issue" the way Linear does, so the entry IS the artifact. */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await deps.inboxStore.delete(id)
    if (!removed) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })

  return app
}
