import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { resolveMediaPath } from '../../core/media-store.js'

/**
 * Media routes: GET /:date/:name — serves persisted tool-result media
 * (e.g. browser screenshots) from data/media/. Mounted at /api/media.
 *
 * Relocated out of the now-deleted chat route module; the media surface
 * is independent of the legacy chat path and stays.
 */
export function createMediaRoutes() {
  const app = new Hono()

  const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  }

  app.get('/:date/:name', async (c) => {
    const { date, name } = c.req.param()
    const ext = extname(name).toLowerCase()
    if (!MIME[ext]) return c.notFound()

    let filePath: string
    try {
      filePath = resolveMediaPath(join(date, name))
    } catch {
      return c.notFound()
    }

    try {
      const buf = await readFile(filePath)
      const ext = extname(name).toLowerCase()
      const mime = MIME[ext] ?? 'application/octet-stream'
      return c.body(buf, { headers: { 'Content-Type': mime } })
    } catch {
      return c.notFound()
    }
  })

  return app
}
