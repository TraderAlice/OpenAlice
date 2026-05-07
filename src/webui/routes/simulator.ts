/**
 * Simulator routes — HTTP control panel for MockBroker UTAs.
 *
 * Thin adapter over the simulator surface MockBroker exposes (setMarkPrice,
 * fillOrder, externalDeposit, etc.). The webui dev `/dev/simulator` tab
 * speaks this API; spec/curl use the same endpoints.
 *
 * Only operates on UTAs whose broker is a MockBroker — for any other broker
 * the routes return 400 "not a simulator". Real brokers shouldn't accept
 * god-view commands.
 *
 * Per the route-layer thinness convention: all撮合 / cost-basis / position
 * mutation logic stays in MockBroker; this file only translates HTTP →
 * broker method calls.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { EngineContext } from '../../core/types.js'
import { MockBroker } from '../../domain/trading/brokers/mock/MockBroker.js'
import { SEC_TYPES, type SecType } from '../../domain/trading/contract-discipline.js'

// ==================== Schemas ====================

const numericString = z.union([z.string().min(1), z.number()]).transform((v) => String(v))

const setMarkPriceSchema = z.object({
  nativeKey: z.string().min(1),
  price: numericString,
})

const tickPriceSchema = z.object({
  nativeKey: z.string().min(1),
  deltaPercent: z.number(),
})

const fillOrderSchema = z.object({
  price: numericString.optional(),
  qty: numericString.optional(),
})

// IBKR contract surface: includes derivative-distinguishing fields so the
// simulator can model OPT/FOP/FUT/CASH/BOND alongside CRYPTO. `secType` is
// validated against `SEC_TYPES` at the network boundary so unknown values
// are rejected with a 400 — the in-memory `Contract` type stays strict.
const contractSchema = z.object({
  symbol: z.string().optional(),
  localSymbol: z.string().optional(),
  secType: z.enum([...SEC_TYPES] as [SecType, ...SecType[]]).optional(),
  exchange: z.string().optional(),
  currency: z.string().optional(),
  // Derivative metadata
  lastTradeDateOrContractMonth: z.string().optional(),  // e.g. "20260720" or "202606"
  strike: z.number().optional(),                         // option strike, e.g. 150
  right: z.enum(['C', 'P', 'CALL', 'PUT']).optional(),    // option right
  multiplier: z.string().optional(),                     // shares-per-contract, e.g. "100"
})

const externalDepositSchema = z.object({
  nativeKey: z.string().min(1),
  quantity: numericString,
  contract: contractSchema.optional(),
})

const externalWithdrawSchema = z.object({
  nativeKey: z.string().min(1),
  quantity: numericString,
})

const externalTradeSchema = z.object({
  nativeKey: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: numericString,
  price: numericString,
  contract: contractSchema.optional(),
})

// ==================== Helpers ====================

/** Resolve :id → UTA whose broker is a MockBroker. Returns error response on miss. */
function resolveMock(ctx: EngineContext, c: Context): { broker: MockBroker } | { error: Response } {
  const id = c.req.param('id')
  if (!id) return { error: c.json({ error: 'Missing UTA id' }, 400) }
  const uta = ctx.utaManager.get(id)
  if (!uta) return { error: c.json({ error: `UTA ${id} not found` }, 404) }
  if (!(uta.broker instanceof MockBroker)) {
    return { error: c.json({ error: `UTA ${id} is not a simulator (broker=${uta.broker.constructor.name})` }, 400) }
  }
  return { broker: uta.broker }
}

async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: Response }> {
  let raw: unknown
  try { raw = await c.req.json() } catch { return { ok: false, error: c.json({ error: 'Invalid JSON' }, 400) } }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400) }
  }
  return { ok: true, data: parsed.data }
}

// ==================== Routes ====================

export function createSimulatorRoutes(ctx: EngineContext) {
  const app = new Hono()

  /** List all simulator-capable UTAs. */
  app.get('/utas', (c) => {
    const utas = ctx.utaManager.resolve()
      .filter(u => u.broker instanceof MockBroker)
      .map(u => ({ id: u.id, label: u.label }))
    return c.json({ utas })
  })

  /** Full state snapshot for one simulator UTA. */
  app.get('/uta/:id/state', (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    return c.json(r.broker.getSimulatorState())
  })

  /** Set markPrice. Auto-matches触达 pending orders. */
  app.post('/uta/:id/mark-price', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const body = await parseBody(c, setMarkPriceSchema)
    if (!body.ok) return body.error
    try {
      const filled = r.broker.setMarkPrice(body.data.nativeKey, body.data.price)
      return c.json({ filled })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Move markPrice by relative percent. */
  app.post('/uta/:id/tick-price', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const body = await parseBody(c, tickPriceSchema)
    if (!body.ok) return body.error
    try {
      const filled = r.broker.tickPrice(body.data.nativeKey, body.data.deltaPercent)
      return c.json({ filled })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Manually fill a pending order (full or partial). */
  app.post('/uta/:id/orders/:orderId/fill', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const orderId = c.req.param('orderId')
    if (!orderId) return c.json({ error: 'Missing orderId' }, 400)
    const body = await parseBody(c, fillOrderSchema)
    if (!body.ok) return body.error
    try {
      r.broker.fillOrder(orderId, body.data)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Force-cancel a pending order. */
  app.post('/uta/:id/orders/:orderId/cancel', (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const orderId = c.req.param('orderId')
    if (!orderId) return c.json({ error: 'Missing orderId' }, 400)
    try {
      r.broker.cancelPendingOrder(orderId)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Simulate external balance change (空投, transfer-in, staking reward). */
  app.post('/uta/:id/external-deposit', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const body = await parseBody(c, externalDepositSchema)
    if (!body.ok) return body.error
    try {
      r.broker.externalDeposit(body.data)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Simulate external withdrawal. */
  app.post('/uta/:id/external-withdraw', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const body = await parseBody(c, externalWithdrawSchema)
    if (!body.ok) return body.error
    try {
      r.broker.externalWithdraw(body.data.nativeKey, body.data.quantity)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  /** Simulate user manually trading on the exchange app. */
  app.post('/uta/:id/external-trade', async (c) => {
    const r = resolveMock(ctx, c)
    if ('error' in r) return r.error
    const body = await parseBody(c, externalTradeSchema)
    if (!body.ok) return body.error
    try {
      r.broker.externalTrade(body.data)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  return app
}
