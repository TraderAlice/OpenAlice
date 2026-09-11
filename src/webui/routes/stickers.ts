import { bodyLimit } from 'hono/body-limit'
import { Hono } from 'hono'
import { z } from 'zod'
import { StickerPacks } from '../../workspaces/sticker-packs.js'
import type { WorkspaceService } from '../../workspaces/service.js'

const selectionSchema = z.object({ enabled: z.boolean(), packId: z.string() })
export function createStickerRoutes(svc: WorkspaceService, packs = new StickerPacks()) {
  const app = new Hono()
  app.onError((error, c) => c.json({ error: error.message }, 400))
  app.get('/', async c => {
    const catalog = await packs.catalog()
    const workspaces = await Promise.all(svc.registry.list().filter(ws => ws.template === 'chat').map(async ws => {
      try {
        return { id: ws.id, name: ws.tag || ws.id, ...await packs.inspect(ws.dir) }
      } catch (error) { return { id: ws.id, name: ws.tag || ws.id, error: (error as Error).message, state: null, changed: [], skillPresent: false } }
    }))
    return c.json({ packs: catalog, defaultPackId: await packs.defaultPack(), workspaces })
  })
  app.get('/packs/:id/:file', async c => {
    const name = c.req.param('file')
    const bytes = await packs.image(c.req.param('id'), name)
    c.header('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/webp')
    c.header('Cache-Control', 'private, no-cache')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(new Uint8Array(bytes))
  })
  app.put('/default', async c => {
    const { packId } = z.object({ packId: z.string() }).parse(await c.req.json())
    await packs.setDefault(packId)
    return c.json({ ok: true })
  })
  app.use('/import', bodyLimit({ maxSize: 34 * 1024 * 1024 }))
  app.post('/import', async c => {
    const form = await c.req.formData()
    const files = form.getAll('files')
    if (!files.length || files.length > 100 || files.some(file => typeof file === 'string' || file.size > 512 * 1024)) return c.json({ error: 'Select 1–100 PNG/WebP images, up to 512 KiB each' }, 400)
    const metadata = z.object({ id: z.string(), name: z.string(), version: z.string() }).parse({ id: form.get('id'), name: form.get('name'), version: form.get('version') })
    const images = await Promise.all(files.map(async file => {
      const image = file as File
      const description = form.get(`description:${image.name}`)
      return { file: image.name, bytes: new Uint8Array(await image.arrayBuffer()), description: typeof description === 'string' ? description : undefined }
    }))
    return c.json(await packs.importImages(images, metadata))
  })
  for (const action of ['preview', 'apply'] as const) app.post(`/workspaces/:id/${action}`, async c => {
    const id = c.req.param('id')
    const ws = svc.registry.get(id)
    if (!ws || ws.template !== 'chat') return c.json({ error: 'Chat Workspace not found' }, 404)
    const input = selectionSchema.extend({ digest: z.string().optional(), restore: z.boolean().optional() }).parse(await c.req.json())
    const lease = svc.operationGuard.acquire(id, 'sticker-projection')
    if (!lease) return c.json({ error: 'Workspace has another checkout operation' }, 409)
    try {
      await packs.recover(ws.dir)
      if (action === 'apply') {
        if (!input.digest) return c.json({ error: 'Preview is required' }, 400)
        return c.json(await packs.apply(ws.dir, input, input.digest, input.restore))
      }
      const plan = await packs.preview(ws.dir, input)
      return c.json({ digest: plan.digest, conflicts: plan.conflicts, revision: plan.pack.revision,
        files: Object.keys(plan.desired).filter(path => !plan.before[path]?.equals(plan.desired[path] ?? Buffer.alloc(0))) })
    } finally { lease.release() }
  })
  return app
}
