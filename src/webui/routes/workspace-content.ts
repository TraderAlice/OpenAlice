import { Hono } from 'hono'
import { readFile, stat } from 'node:fs/promises'
import { resolveInboxFile } from '../../core/inbox-files.js'

/** Read-only Workspace projection; the consumer owns rendering and delivery. */
export function createWorkspaceContentRoutes(root: (id: string) => string | undefined) {
  const app = new Hono()
  app.get('/:id/content', async c => {
    const path = c.req.query('path') ?? ''
    const file = await resolveInboxFile(root(c.req.param('id')), path)
    if (!file) return c.json({ error: 'file_not_found' }, 404)
    const info = await stat(file)
    if (c.req.query('metadata') === '1') return c.json({ path, size: info.size, modified: info.mtimeMs })
    if (info.size > 16 * 1024 * 1024) return c.json({ error: 'file_too_large' }, 413)
    const media: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
    const type = media[path.split('.').pop()?.toLowerCase() ?? '']
    c.header('Content-Type', type ?? 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Security-Policy', "sandbox; default-src 'none'")
    c.header('Cache-Control', 'no-store')
    c.header('Content-Disposition', `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.split('/').pop()!)}`)
    return c.body(await readFile(file))
  })
  return app
}
