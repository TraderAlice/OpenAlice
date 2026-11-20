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

    try {
      // resolveMediaPath() throws when the decoded segments escape the media
      // directory (`%2e%2e%2f` reaches us as `../`). It has to run inside this
      // try so that rejection stays a 404 — thrown above it, the error would
      // bypass this catch and surface as a 500 from WebPlugin's onError.
      const filePath = resolveMediaPath(join(date, name))
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
