import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'
import type { CronSchedule } from '../../../task/cron/engine.js'

/** Cron routes: GET /jobs, POST /jobs, PUT /jobs/:id, DELETE /jobs/:id, POST /jobs/:id/run */
export function createCronRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/jobs', (c) => {
    return c.json({ jobs: ctx.cronEngine.list() })
  })

  app.post('/jobs', async (c) => {
    try {
      const body = await c.req.json<{
        name: string
        payload: string
        schedule: { kind: string; at?: string; every?: string; cron?: string }
        enabled?: boolean
      }>()
      if (!body.name || !body.payload || !body.schedule?.kind) {
        return c.json({ error: 'name, payload, and schedule are required' }, 400)
      }
      const id = await ctx.cronEngine.add({
        name: body.name,
        payload: body.payload,
        schedule: body.schedule as CronSchedule,
        enabled: body.enabled,
      })
      return c.json({ id })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/jobs/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json()
      await ctx.cronEngine.update(id, body)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.delete('/jobs/:id', async (c) => {
    try {
      const id = c.req.param('id')
      await ctx.cronEngine.remove(id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/jobs/:id/run', async (c) => {
    try {
      const id = c.req.param('id')
      await ctx.cronEngine.runNow(id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
