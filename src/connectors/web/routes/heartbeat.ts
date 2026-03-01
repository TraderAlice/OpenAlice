import { Hono } from 'hono'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EngineContext } from '../../../core/types.js'

const PROMPT_FILE = 'data/brain/heartbeat.md'

/** Heartbeat routes: GET /status, POST /trigger, PUT /enabled, GET/PUT /prompt-file */
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

  app.get('/prompt-file', async (c) => {
    try {
      const content = await readFile(PROMPT_FILE, 'utf-8')
      return c.json({ content, path: PROMPT_FILE })
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ content: '', path: PROMPT_FILE })
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/prompt-file', async (c) => {
    try {
      const { content } = await c.req.json<{ content: string }>()
      await mkdir(dirname(PROMPT_FILE), { recursive: true })
      await writeFile(PROMPT_FILE, content, 'utf-8')
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
