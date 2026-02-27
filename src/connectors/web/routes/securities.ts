import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

/** Securities trading routes: reconnect + account/portfolio/orders/wallet/market data */
export function createSecuritiesRoutes(ctx: EngineContext) {
  const app = new Hono()

  // ==================== Reconnect ====================

  app.post('/reconnect', async (c) => {
    if (!ctx.reconnectSecurities) return c.json({ success: false, error: 'Not available' }, 501)
    const result = await ctx.reconnectSecurities()
    return c.json(result, result.success ? 200 : 500)
  })

  // ==================== Account & Portfolio ====================

  app.get('/account', async (c) => {
    const engine = ctx.getSecuritiesEngine?.()
    if (!engine) return c.json({ error: 'Securities engine not connected' }, 503)
    try {
      const account = await engine.getAccount()
      return c.json(account)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/portfolio', async (c) => {
    const engine = ctx.getSecuritiesEngine?.()
    if (!engine) return c.json({ error: 'Securities engine not connected' }, 503)
    try {
      const holdings = await engine.getPortfolio()
      return c.json({ holdings })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/orders', async (c) => {
    const engine = ctx.getSecuritiesEngine?.()
    if (!engine) return c.json({ error: 'Securities engine not connected' }, 503)
    try {
      const orders = await engine.getOrders()
      return c.json({ orders })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Market Data ====================

  app.get('/market-clock', async (c) => {
    const engine = ctx.getSecuritiesEngine?.()
    if (!engine) return c.json({ error: 'Securities engine not connected' }, 503)
    try {
      const clock = await engine.getMarketClock()
      return c.json(clock)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/quote/:symbol', async (c) => {
    const engine = ctx.getSecuritiesEngine?.()
    if (!engine) return c.json({ error: 'Securities engine not connected' }, 503)
    try {
      const symbol = c.req.param('symbol')
      const quote = await engine.getQuote(symbol)
      return c.json(quote)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Wallet (trade decision history) ====================

  app.get('/wallet/log', (c) => {
    const wallet = ctx.getSecWallet?.()
    if (!wallet) return c.json({ error: 'Securities wallet not available' }, 503)
    const limit = Number(c.req.query('limit')) || 20
    const symbol = c.req.query('symbol') || undefined
    return c.json({ commits: wallet.log({ limit, symbol }) })
  })

  app.get('/wallet/show/:hash', (c) => {
    const wallet = ctx.getSecWallet?.()
    if (!wallet) return c.json({ error: 'Securities wallet not available' }, 503)
    const hash = c.req.param('hash')
    const commit = wallet.show(hash)
    if (!commit) return c.json({ error: 'Commit not found' }, 404)
    return c.json(commit)
  })

  app.get('/wallet/status', (c) => {
    const wallet = ctx.getSecWallet?.()
    if (!wallet) return c.json({ error: 'Securities wallet not available' }, 503)
    return c.json(wallet.status())
  })

  return app
}
