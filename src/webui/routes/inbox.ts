import { inboxFiles } from '@traderalice/connector-protocol'
import { resolveInboxFile } from '../../core/inbox-files.js'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
/**
 * Inbox HTTP route — read history + dev-only seed.
 *
 *   GET    /history?limit=&before=&workspaceId= paginated, newest-first
 *   PUT    /:id/read                            mark one entry read
 *   DELETE /:id/read                            mark one entry unread
 *   POST   /seed                                dev-only: append an entry
 *
 * UI polls /history every 20s with conditional If-None-Match (ETag) so
 * unchanged ticks return 304 Not Modified with zero payload bytes. Production
 * writes still come from workspace tools (`inbox_push` via MCP/CLI gateway);
 * `/seed` is only for manual/dev appends.
 */
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import type { IInboxStore } from '../../core/inbox-store.js'

function weakEtag(input: string): string {
  const hash = createHash('sha1').update(input).digest('base64url').slice(0, 20)
  return `W/"${hash}"`
}

function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const normalizedTarget = etag.replace(/^W\//, '')
  return header
    .split(',')
    .map((part) => part.trim())
    .some((tag) => tag === '*' || tag === etag || tag.replace(/^W\//, '') === normalizedTarget)
}

export interface InboxRoutesDeps {
  resolveWorkspace?: (id: string) => { dir: string } | undefined
  inboxStore: IInboxStore
}

export function createInboxRoutes(deps: InboxRoutesDeps) {
  const app = new Hono()
  app.use('*', compress())

  app.get('/history', async (c) => {
    const limit = Number(c.req.query('limit')) || 100
    const before = c.req.query('before') || undefined
    const workspaceId = c.req.query('workspaceId') || undefined
    const fp = deps.inboxStore.fingerprint ? await deps.inboxStore.fingerprint() : null
    if (fp !== null) {
      const etag = weakEtag(`history|${fp}|${limit}|${before ?? ''}|${workspaceId ?? ''}`)
      c.header('ETag', etag)
      c.header('Cache-Control', 'private, no-cache')
      if (matchesIfNoneMatch(c.req.header('if-none-match'), etag)) {
        return c.body(null, 304)
      }
    }
    const result = await deps.inboxStore.read({ limit, before, workspaceId })
    return c.json(result)
  })

  app.put('/read-all', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('excludeIds' in body)
      || !Array.isArray(body.excludeIds)
      || body.excludeIds.length > 100
      || !body.excludeIds.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200)) {
      return c.json({ error: 'excludeIds must be an array of entry IDs' }, 400)
    }
    return c.json(await deps.inboxStore.markAllRead(body.excludeIds))
  })

  app.get('/:id/files', async c => {
    const entry = await deps.inboxStore.get(c.req.param('id'))
    if (!entry) return c.json({ error: 'not_found' }, 404)
    const root = deps.resolveWorkspace?.(entry.workspaceId)?.dir
    const resolved = await Promise.all(inboxFiles(entry).map(async (file, index) => {
      const resolvedPath = await resolveInboxFile(root, file.path)
      let statPart = 'missing'
      let size: number | undefined
      if (resolvedPath) {
        try {
          const info = await stat(resolvedPath)
          statPart = `${info.size}:${info.mtimeMs}`
          size = info.size
        } catch {
          statPart = 'missing'
        }
      }
      return {
        file: {
          ...file,
          available: statPart !== 'missing',
          ...(size !== undefined ? { size } : {}),
          href: `/api/inbox/${encodeURIComponent(entry.id)}/files/${index}`,
        },
        sig: `${file.path}:${file.revision ?? ''}:${statPart}`,
      }
    }))
    const etag = weakEtag(`files|${entry.id}|${resolved.map((r) => r.sig).join('|')}`)
    c.header('ETag', etag)
    c.header('Cache-Control', 'private, no-cache')
    if (matchesIfNoneMatch(c.req.header('if-none-match'), etag)) {
      return c.body(null, 304)
    }
    return c.json({ files: resolved.map((r) => r.file) })
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
    const etag = weakEtag(`file|${entry.id}|${index}|${info.ino}:${info.size}:${info.mtimeMs}`)
    c.header('ETag', etag)
    c.header('Cache-Control', 'private, no-cache')
    if (matchesIfNoneMatch(c.req.header('if-none-match'), etag)) {
      return c.body(null, 304)
    }
    const bytes = await readFile(path)
    const extension = file.path.split('.').pop()?.toLowerCase() ?? ''
    const media: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
    c.header('Content-Type', media[extension] ?? 'application/octet-stream')
    c.header('Content-Length', String(bytes.byteLength))
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Security-Policy', "sandbox; default-src 'none'")
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
