import type { Hono } from 'hono'
import { parseMarketReference, MARKET_REFERENCE_COUNT } from '@traderalice/connector-protocol'
import type { ToolCenter } from '../core/tool-center.js'
import { wrapToolExecute } from '../core/mcp-export.js'

/** Read-only Project market data for external presentation consumers. */
export function registerMarketReferenceRoute(app: Hono, tools: ToolCenter): void {
  app.get('/cli/market-reference', async c => {
    c.header('Cache-Control', 'no-store')
    const reference = parseMarketReference(c.req.query('reference') ?? '')
    if (!reference) return c.json({ error: 'Invalid market reference' }, 400)
    const tool = tools.get('getMarketBars')
    if (!tool) return c.json({ error: 'Market bars unavailable' }, 503)
    const result = await wrapToolExecute(tool)({ ...reference, count: MARKET_REFERENCE_COUNT })
    return c.json(result, result.isError ? 502 : 200)
  })
}
