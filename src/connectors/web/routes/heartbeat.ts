import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

/** Heartbeat routes: GET /status, POST /trigger, PUT /enabled */
export function createHeartbeatRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/status', (c) => {
    return c.json({ enabled: ctx.heartbeat.isEnabled() })
  })

  app.post('/trigger', async (c) => {
    try {
      const jobs = ctx.cronEngine.list()
      const hbJob = jobs.find((j) => j.name === '__heartbeat__')
      if (!hbJob) {
        return c.json({ error: 'Heartbeat cron job not found. Is heartbeat enabled?' }, 404)
      }
      await ctx.cronEngine.runNow(hbJob.id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/enabled', async (c) => {
    try {
      const body = await c.req.json<{ enabled: boolean }>()
      await ctx.heartbeat.setEnabled(body.enabled)
      return c.json({ enabled: ctx.heartbeat.isEnabled() })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
