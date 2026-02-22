import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Plugin, EngineContext } from '../core/types.js'

export class HttpPlugin implements Plugin {
  name = 'http'
  private server: ReturnType<typeof serve> | null = null

  async start(ctx: EngineContext) {
    const app = new Hono()

    app.get('/health', (c) => c.json({ ok: true }))

    app.get('/status', async (c) => {
      const [account, positions, orders] = ctx.cryptoEngine
        ? await Promise.all([
            ctx.cryptoEngine.getAccount(),
            ctx.cryptoEngine.getPositions(),
            ctx.cryptoEngine.getOrders(),
          ])
        : [null, [], []]
      return c.json({
        playheadTime: ctx.klineStore.getPlayheadTime().toISOString(),
        account,
        positions,
        orders,
      })
    })

    this.server = serve({ fetch: app.fetch, port: ctx.config.engine.port }, (info) => {
      console.log(`http plugin listening on http://localhost:${info.port}`)
    })
  }

  async stop() {
    this.server?.close()
  }
}
