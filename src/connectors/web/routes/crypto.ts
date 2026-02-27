import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

/** Crypto trading routes: reconnect + account/positions/orders/wallet data */
export function createCryptoRoutes(ctx: EngineContext) {
  const app = new Hono()

  // ==================== Reconnect ====================

  app.post('/reconnect', async (c) => {
    if (!ctx.reconnectCrypto) return c.json({ success: false, error: 'Not available' }, 501)
    const result = await ctx.reconnectCrypto()
    return c.json(result, result.success ? 200 : 500)
  })

  // ==================== Account & Positions ====================

  app.get('/account', async (c) => {
    const engine = ctx.getCryptoEngine?.()
    if (!engine) return c.json({ error: 'Crypto engine not connected' }, 503)
    try {
      const account = await engine.getAccount()
      return c.json(account)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/positions', async (c) => {
    const engine = ctx.getCryptoEngine?.()
    if (!engine) return c.json({ error: 'Crypto engine not connected' }, 503)
    try {
      const positions = await engine.getPositions()
      return c.json({ positions })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/orders', async (c) => {
    const engine = ctx.getCryptoEngine?.()
    if (!engine) return c.json({ error: 'Crypto engine not connected' }, 503)
    try {
      const orders = await engine.getOrders()
      return c.json({ orders })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Wallet (trade decision history) ====================

  app.get('/wallet/log', (c) => {
    const wallet = ctx.getCryptoWallet?.()
    if (!wallet) return c.json({ error: 'Crypto wallet not available' }, 503)
    const limit = Number(c.req.query('limit')) || 20
    const symbol = c.req.query('symbol') || undefined
    return c.json({ commits: wallet.log({ limit, symbol }) })
  })

  app.get('/wallet/show/:hash', (c) => {
    const wallet = ctx.getCryptoWallet?.()
    if (!wallet) return c.json({ error: 'Crypto wallet not available' }, 503)
    const hash = c.req.param('hash')
    const commit = wallet.show(hash)
    if (!commit) return c.json({ error: 'Commit not found' }, 404)
    return c.json(commit)
  })

  app.get('/wallet/status', (c) => {
    const wallet = ctx.getCryptoWallet?.()
    if (!wallet) return c.json({ error: 'Crypto wallet not available' }, 503)
    return c.json(wallet.status())
  })

  return app
}
