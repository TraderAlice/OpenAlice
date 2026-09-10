import { inboxFiles } from '@traderalice/connector-protocol'
import { resolveInboxFile } from '../../core/inbox-files.js'
import { readFile, stat } from 'node:fs/promises'
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
import type { IInboxStore } from '../../core/inbox-store.js'

export interface InboxRoutesDeps {
  resolveWorkspace?: (id: string) => { dir: string } | undefined
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

  app.get('/:id/files', async c => {
    const entry = await deps.inboxStore.get(c.req.param('id'))
    if (!entry) return c.json({ error: 'not_found' }, 404)
    const root = deps.resolveWorkspace?.(entry.workspaceId)?.dir
    const files = await Promise.all(inboxFiles(entry).map(async (file, index) => ({
      ...file, available: Boolean(await resolveInboxFile(root, file.path)),
      href: `/api/inbox/${encodeURIComponent(entry.id)}/files/${index}`,
    })))
    return c.json({ files })
  })

  app.get('/:id/files/:index', async c => {
    const entry = await deps.inboxStore.get(c.req.param('id'))
    const index = c.req.param('index')
    if (!entry || !/^\d+$/.test(index)) return c.json({ error: 'not_found' }, 404)
    const file = inboxFiles(entry)[Number(index)]
    const path = file && await resolveInboxFile(deps.resolveWorkspace?.(entry.workspaceId)?.dir, file.path)
    if (!path) return c.json({ error: 'file_not_found' }, 404)
    const info = await stat(path)
    if (info.size > 16 * 1024 * 1024) return c.json({ error: 'file_too_large' }, 413)
    const bytes = await readFile(path)
    const extension = file.path.split('.').pop()?.toLowerCase() ?? ''
    const media: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
    c.header('Content-Type', media[extension] ?? 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Security-Policy', "sandbox; default-src 'none'")
    c.header('Cache-Control', 'no-store')
    c.header('Content-Disposition', `${media[extension] ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.path.split('/').pop()!)}`)
    return c.body(bytes)
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
      body: string
    }>
    if (!b.workspaceId || typeof b.workspaceId !== 'string') {
      return c.json({ error: 'workspaceId required' }, 400)
    }

    if (typeof b.body !== 'string' || !b.body.trim()) return c.json({ error: 'non-empty body required' }, 400)

    try {
      const entry = await deps.inboxStore.append({
        workspaceId: b.workspaceId,
        workspaceLabel: typeof b.workspaceLabel === 'string' ? b.workspaceLabel : undefined,
        body: b.body,
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
