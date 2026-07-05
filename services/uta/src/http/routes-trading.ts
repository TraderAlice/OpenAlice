import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { UTAEngineContext } from '../types.js'
import { BrokerError } from '../domain/trading/brokers/types.js'
import type { UnifiedTradingAccount } from '../domain/trading/UnifiedTradingAccount.js'
import { searchTradeableContracts } from '../domain/trading/contract-search.js'
import type { AssetClassHint } from '@traderalice/uta-protocol'
import { executeOneShotOrder, type OrderEntryPhase } from '../domain/trading/order-entry.js'
import { projectOrderHistory, projectTradeHistory } from '../domain/trading/order-history.js'

// ==================== Order entry schemas ====================
//
// All numeric fields use string on the wire (matching the
// new Decimal(String(x)) pattern in UnifiedTradingAccount.ts) — keeps
// frontend/backend aligned on Decimal precision and avoids IEEE-754
// rounding artifacts in JSON serialization.

const numericString = z.string().min(1)
const message = z.string().min(1, { message: 'Commit message is required' })

const placeOrderSchema = z.object({
  aliceId: z.string().min(1),
  symbol: z.string().optional(),
  action: z.enum(['BUY', 'SELL']),
  orderType: z.string().min(1),
  totalQuantity: numericString.optional(),
  cashQty: numericString.optional(),
  lmtPrice: numericString.optional(),
  auxPrice: numericString.optional(),
  trailStopPrice: numericString.optional(),
  trailingPercent: numericString.optional(),
  tif: z.string().optional(),
  goodTillDate: z.string().optional(),
  outsideRth: z.boolean().optional(),
  parentId: z.string().optional(),
  ocaGroup: z.string().optional(),
  takeProfit: z.object({ price: numericString }).optional(),
  stopLoss: z.object({ price: numericString, limitPrice: numericString.optional() }).optional(),
  subAccountId: z.string().optional(),
  message,
}).refine(
  (d) => d.totalQuantity != null || d.cashQty != null,
  { message: 'Either totalQuantity or cashQty is required' },
)

const closePositionSchema = z.object({
  aliceId: z.string().min(1),
  symbol: z.string().optional(),
  qty: numericString.optional(),
  subAccountId: z.string().optional(),
  message,
})

const cancelOrderSchema = z.object({
  orderId: z.string().min(1),
  message,
})

/** HTTP status mapping for one-shot order pipeline failures. */
const PHASE_STATUS: Record<OrderEntryPhase, 400 | 500> = {
  stage: 400,
  commit: 400,
  push: 500,
}

/** Run the domain pipeline and translate to a Hono Response. */
async function runOneShot(
  c: Context,
  uta: UnifiedTradingAccount,
  message: string,
  stage: () => void,
): Promise<Response> {
  const r = await executeOneShotOrder(uta, message, stage)
  if (r.ok) return c.json(r.result)
  return c.json({ error: r.error, phase: r.phase }, PHASE_STATUS[r.phase])
}

const ALLOWED_ASSET_CLASSES: ReadonlySet<AssetClassHint> = new Set([
  'equity', 'crypto', 'currency', 'commodity', 'unknown',
])

/** Resolve account by :id param, return 404 if not found. */
function resolveAccount(ctx: UTAEngineContext, c: Context): UnifiedTradingAccount | null {
  const id = c.req.param('id')
  if (!id) return null
  return ctx.utaManager.get(id) ?? null
}

/**
 * Execute a data query against a UTA with health-aware error handling.
 * - Offline → 503 + nudge recovery
 * - Transient error → 503
 * - Permanent error → 500
 */
async function queryAccount<T>(
  c: Context,
  account: UnifiedTradingAccount,
  fn: () => Promise<T>,
): Promise<Response> {
  if (account.health === 'offline') {
    account.nudgeRecovery()
    return c.json({
      error: 'Account temporarily unavailable',
      health: account.getHealthInfo(),
    }, 503)
  }
  try {
    return c.json(await fn())
  } catch (err) {
    const be = err instanceof BrokerError ? err : BrokerError.from(err)
    return c.json({
      error: be.message,
      code: be.code,
      transient: !be.permanent,
    }, be.permanent ? 500 : 503)
  }
}

/** Unified trading routes — works with all account types via AccountManager */
export function createTradingRoutes(ctx: UTAEngineContext) {
  const app = new Hono()

  // ==================== UTA listing ====================

  app.get('/uta', (c) => {
    return c.json({ utas: ctx.utaManager.listUTAs() })
  })

  // ==================== Aggregated equity ====================

  app.get('/equity', async (c) => {
    const equity = await ctx.utaManager.getAggregatedEquity()
    return c.json(equity)
  })

  // ==================== Tradeable contract search ====================
  // Heuristic broker-side search across every configured account. Powers
  // the Market workbench's "tradeable contracts" hint card and any other
  // surface that wants to bridge a data-vendor symbol to actionable
  // alias_ids without making the bridge structural.
  app.get('/contracts/search', async (c) => {
    const pattern = (c.req.query('pattern') ?? c.req.query('query') ?? '').trim()
    if (!pattern) return c.json({ results: [], count: 0 })
    const utas = ctx.utaManager.listUTAs()
    if (utas.length === 0) {
      return c.json({ results: [], count: 0, utasConfigured: 0 })
    }
    // Caller may hint the data-vendor asset class so the rule set in
    // contract-search-rules.ts can pick the right normalization
    // (e.g. crypto/currency strip the quote suffix). Defaults to
    // 'unknown' — identity passthrough — when omitted or invalid.
    const rawAc = c.req.query('assetClass') as AssetClassHint | undefined
    const assetClass: AssetClassHint = rawAc && ALLOWED_ASSET_CLASSES.has(rawAc) ? rawAc : 'unknown'
    const hits = await searchTradeableContracts(ctx.utaManager, pattern, assetClass)
    return c.json({ results: hits, count: hits.length, utasConfigured: utas.length })
  })

  // ==================== FX rates ====================

  app.get('/fx-rates', async (c) => {
    // Collect all unique currencies from positions across all accounts
    const currencies = new Set<string>()
    for (const uta of ctx.utaManager.resolve()) {
      if (uta.health === 'offline') continue
      try {
        const positions = await uta.getPositions()
        for (const p of positions) {
          if (p.currency && p.currency !== 'USD') currencies.add(p.currency)
        }
        const account = await uta.getAccount()
        if (account.baseCurrency && account.baseCurrency !== 'USD') currencies.add(account.baseCurrency)
      } catch { /* skip unhealthy */ }
    }

    const rates: Array<{ currency: string; rate: number; source: string; updatedAt: string }> = []
    for (const cur of currencies) {
      const fx = await ctx.fxService.getRate(cur)
      rates.push({ currency: cur, rate: fx.rate, source: fx.source, updatedAt: fx.updatedAt })
    }
    return c.json({ rates })
  })

  // ==================== Broker test-connection ====================
  // Setup-wizard probe: instantiate a broker from the supplied preset
  // config, connect, query account + positions to prove credentials are
  // valid, then disconnect. Ephemeral — does NOT register the broker
  // with UTAManager. Alice's `/api/trading/config/test-connection`
  // endpoint forwards here.
  app.post('/test-connection', async (c) => {
    let broker: { init: () => Promise<void>; getAccount: () => Promise<unknown>; getPositions: () => Promise<unknown>; close: () => Promise<void> } | null = null
    try {
      const { createBroker } = await import('../domain/trading/brokers/factory.js')
      const { utaConfigSchema } = await import('@/core/config.js')
      const body = await c.req.json()
      const utaConfig = utaConfigSchema.parse({ ...body, id: body.id ?? '__test__' })
      broker = createBroker(utaConfig)
      await broker.init()
      const [account, positions] = await Promise.all([broker.getAccount(), broker.getPositions()])
      return c.json({ success: true, account, positions })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ success: false, error: msg }, 400)
    } finally {
      try { await broker?.close() } catch { /* best-effort */ }
    }
  })

  // ==================== Per-account routes ====================

  // Reconnect
  app.post('/uta/:id/reconnect', async (c) => {
    const id = c.req.param('id')
    const result = await ctx.utaManager.reconnectUTA(id)
    return c.json(result, result.success ? 200 : 500)
  })

  // Force broker state sync. The AI tool calls this when it suspects
  // the in-memory order state is stale (filled but not surfaced yet).
  app.post('/uta/:id/sync', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const delayMs = typeof body.delayMs === 'number' ? body.delayMs : undefined
      const result = await uta.sync({ delayMs })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Price simulation — the AI tool drives PnL exploration via this
  // endpoint. Every broker implements it (real brokers compute against
  // their current position book + the supplied hypothetical prices),
  // so this isn't Mock-specific.
  app.post('/uta/:id/simulate-price', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const changes = Array.isArray(body.changes) ? body.changes : []
      const result = await uta.simulatePriceChange(changes)
      return c.json(result)
    } catch (err) {
      // simulatePriceChange throws on non-mock brokers — map to 400 so
      // the AI tool can surface a clean error to the user.
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, /simulate/i.test(msg) || /mock/i.test(msg) ? 400 : 500)
    }
  })

  // Sub-accounts (wallets) — one element for ordinary brokers, >1 for
  // separate-wallet venues (CCXT Binance: spot / derivatives).
  app.get('/uta/:id/subaccounts', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, async () => ({ subAccounts: await account.listSubAccounts() }))
  })

  // Account info. `?subAccountId=` scopes to one wallet (omitted ⇒ aggregate).
  app.get('/uta/:id/account', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, () => account.getAccount(c.req.query('subAccountId')))
  })

  // Positions. `?subAccountId=` scopes to one wallet (omitted ⇒ all).
  app.get('/uta/:id/positions', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, async () => ({ positions: await account.getPositions(c.req.query('subAccountId')) }))
  })

  // Orders
  app.get('/uta/:id/orders', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, async () => {
      const idsParam = c.req.query('ids')
      const orderIds = idsParam ? idsParam.split(',') : account.getPendingOrderIds().map(p => p.orderId)
      const orders = await account.getOrders(orderIds)
      return { orders }
    })
  })

  // Market clock
  app.get('/uta/:id/market-clock', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, () => account.getMarketClock())
  })

  // Quote — `GET /quote/:symbol` keeps the path-param form for legacy
  // UI callers; the AI tool layer uses the POST form below because it
  // typically only has an `aliceId` (which the broker's native-key
  // decoder expands server-side).
  app.get('/uta/:id/quote/:symbol', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    return queryAccount(c, account, async () => {
      const { Contract } = await import('@traderalice/ibkr')
      const contract = new Contract()
      contract.symbol = c.req.param('symbol')
      return account.getQuote(contract)
    })
  })

  app.post('/uta/:id/quote', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const { Contract } = await import('@traderalice/ibkr')
      const contract = Object.assign(new Contract(), body)
      return c.json(await account.getQuote(contract))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Hub → leaves expansion (bond issuers, option chains, futures months).
  // Body: { aliceId, filters?: ExpandContractFilters }.
  app.post('/uta/:id/contract/expand', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      return c.json(await account.expandContract(String(body.aliceId ?? ''), body.filters ?? {}))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Historical OHLCV bars. Body: { contract: <Contract|{aliceId}>, params: BarParams }.
  // start/end arrive as ISO strings over the wire — revive to Date (the only
  // Date fields in BarParams) before the broker call.
  app.post('/uta/:id/historical', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const { Contract } = await import('@traderalice/ibkr')
      const contract = Object.assign(new Contract(), body.contract ?? body)
      const params = { ...(body.params ?? {}) }
      if (params.start) params.start = new Date(params.start)
      if (params.end) params.end = new Date(params.end)
      const bars = await account.getHistorical(contract, params)
      return c.json({ bars })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Contract details — drilldown after a search hit. Body shape is a
  // `Contract` subset; when `aliceId` is present, `getContractDetails`
  // expands it internally via the broker's native-key decoder.
  app.post('/uta/:id/contracts/details', async (c) => {
    const account = resolveAccount(ctx, c)
    if (!account) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const { Contract } = await import('@traderalice/ibkr')
      const query = Object.assign(new Contract(), body)
      const details = await account.getContractDetails(query)
      return c.json(details ?? null)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // ==================== Per-account wallet/git routes ====================

  app.get('/uta/:id/wallet/log', (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    const limit = Number(c.req.query('limit')) || 20
    const symbol = c.req.query('symbol') || undefined
    return c.json({ commits: uta.log({ limit, symbol }) })
  })

  // Exchange-frontend projections of the git log — Order History (one row
  // per order, lifecycle collapsed) and Trade History (fills only).
  // Projection logic lives in domain/trading/order-history.ts so MCP/CLI
  // surfaces can reuse it.
  app.get('/uta/:id/order-history', (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    const limit = Number(c.req.query('limit')) || 50
    return c.json({ orders: projectOrderHistory(uta.exportGitState().commits, { limit }) })
  })

  app.get('/uta/:id/trade-history', (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    const limit = Number(c.req.query('limit')) || 50
    return c.json({ trades: projectTradeHistory(uta.exportGitState().commits, { limit }) })
  })

  app.get('/uta/:id/wallet/show/:hash', (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    const commit = uta.show(c.req.param('hash'))
    if (!commit) return c.json({ error: 'Commit not found' }, 404)
    return c.json(commit)
  })

  app.get('/uta/:id/wallet/status', (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    return c.json(uta.status())
  })

  // Commit — finalize the current staging area without pushing. Used by
  // the AI's `tradingCommit` tool when it wants the user to approve a
  // staged batch separately from the push step. Returns the prepared
  // commit (hash + pending message); a subsequent push or reject closes
  // the cycle.
  app.post('/uta/:id/wallet/commit', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const message = typeof body.message === 'string' ? body.message : ''
      if (!message.trim()) {
        return c.json({ error: 'Commit message is required' }, 400)
      }
      const result = uta.commit(message)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Reject (records a user-rejected commit, clears staging)
  app.post('/uta/:id/wallet/reject', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    if (!uta.status().pendingMessage) return c.json({ error: 'Nothing to reject' }, 400)
    try {
      const body = await c.req.json().catch(() => ({}))
      const reason = typeof body.reason === 'string' ? body.reason : undefined
      const result = await uta.reject(reason)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // Push (manual approval — the AI tool is hollowed out, only humans can push)
  app.post('/uta/:id/wallet/push', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    if (!uta.status().pendingMessage) return c.json({ error: 'Nothing to push' }, 400)
    try {
      const result = await uta.push()
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ==================== Stage-only order entry ====================
  //
  // The AI tool layer talks to these — stage now, commit later, push
  // when the user approves. Same body shape as the one-shot routes
  // below but without the `message` field (commit message arrives at
  // POST /wallet/commit time). All return the AddResult shape from
  // TradingGit.add.

  app.post('/uta/:id/wallet/stage-place-order', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const result = uta.stagePlaceOrder(body)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/uta/:id/wallet/stage-modify-order', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const result = uta.stageModifyOrder(body)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/uta/:id/wallet/stage-close-position', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      const result = uta.stageClosePosition(body)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/uta/:id/wallet/stage-cancel-order', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'Account not found' }, 404)
    try {
      const body = await c.req.json().catch(() => ({}))
      if (!body.orderId || typeof body.orderId !== 'string') {
        return c.json({ error: 'orderId is required' }, 400)
      }
      const result = uta.stageCancelOrder({ orderId: body.orderId })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  // ==================== One-shot order entry ====================
  //
  // Combine stage → commit → push for the frontend's manual order
  // surface. The TradingGit primitives stay separate underneath; this
  // is a route-layer convenience.

  app.post('/uta/:id/wallet/place-order', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'UTA not found' }, 404)
    let body: z.infer<typeof placeOrderSchema>
    try {
      body = placeOrderSchema.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: err instanceof z.ZodError ? err.message : String(err), phase: 'validate' }, 400)
    }
    return runOneShot(c, uta, body.message, () => {
      const { message: _msg, ...stageParams } = body
      uta.stagePlaceOrder(stageParams)
    })
  })

  app.post('/uta/:id/wallet/close-position', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'UTA not found' }, 404)
    let body: z.infer<typeof closePositionSchema>
    try {
      body = closePositionSchema.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: err instanceof z.ZodError ? err.message : String(err), phase: 'validate' }, 400)
    }
    return runOneShot(c, uta, body.message, () => {
      const { message: _msg, ...stageParams } = body
      // qty stays a string all the way to Decimal — no float roundtrip.
      uta.stageClosePosition(stageParams)
    })
  })

  app.post('/uta/:id/wallet/cancel-order', async (c) => {
    const uta = ctx.utaManager.get(c.req.param('id'))
    if (!uta) return c.json({ error: 'UTA not found' }, 404)
    let body: z.infer<typeof cancelOrderSchema>
    try {
      body = cancelOrderSchema.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: err instanceof z.ZodError ? err.message : String(err), phase: 'validate' }, 400)
    }
    return runOneShot(c, uta, body.message, () => {
      uta.stageCancelOrder({ orderId: body.orderId })
    })
  })

  // ==================== Snapshot routes ====================

  // Per-account snapshots
  app.get('/uta/:id/snapshots', async (c) => {
    if (!ctx.snapshotService) return c.json({ snapshots: [] })
    const id = c.req.param('id')
    const limit = Number(c.req.query('limit')) || 100
    try {
      const snapshots = await ctx.snapshotService.getRecent(id, limit)
      return c.json({ snapshots })
    } catch {
      return c.json({ snapshots: [] })
    }
  })

  app.delete('/uta/:id/snapshots/:timestamp', async (c) => {
    if (!ctx.snapshotService) return c.json({ error: 'Snapshot service not available' }, 503)
    const id = c.req.param('id')
    const timestamp = decodeURIComponent(c.req.param('timestamp'))
    const deleted = await ctx.snapshotService.deleteSnapshot(id, timestamp)
    if (!deleted) return c.json({ error: 'Snapshot not found' }, 404)
    return c.json({ success: true })
  })

  // Aggregated equity curve across all accounts
  app.get('/snapshots/equity-curve', async (c) => {
    if (!ctx.snapshotService) return c.json({ points: [] })
    const limit = Number(c.req.query('limit')) || 200

    try {
      const accounts = ctx.utaManager.resolve()
      // Gather snapshots per account
      const perAccount = await Promise.all(
        accounts.map(async (uta) => {
          const snaps = await ctx.snapshotService!.getRecent(uta.id, limit)
          return { id: uta.id, label: uta.label, snaps }
        }),
      )

      // Build time-indexed map: group snapshots by minute-rounded timestamp
      const timeMap = new Map<string, { equity: number; accounts: Record<string, string> }>()

      for (const { id: accId, snaps } of perAccount) {
        for (const snap of snaps) {
          // Round to nearest minute for grouping
          const d = new Date(snap.timestamp)
          d.setSeconds(0, 0)
          const key = d.toISOString()

          let entry = timeMap.get(key)
          if (!entry) {
            entry = { equity: 0, accounts: {} }
            timeMap.set(key, entry)
          }
          entry.accounts[accId] = snap.account.netLiquidation
          // Recalculate total equity from all accounts at this time
          entry.equity = Object.values(entry.accounts).reduce((s, v) => s + (Number(v) || 0), 0)
        }
      }

      // Sort chronologically
      const sorted = Array.from(timeMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))

      // Carry forward: fill missing accounts with their last known value
      const allAccountIds = accounts.map(a => a.id)
      const lastKnown: Record<string, string> = {}

      const points = sorted.map(([timestamp, { accounts: accs }]) => {
        // Fill missing accounts from last known
        for (const id of allAccountIds) {
          if (!(id in accs) && id in lastKnown) {
            accs[id] = lastKnown[id]
          }
        }
        // Update last known
        Object.assign(lastKnown, accs)
        // Recalculate equity with filled values
        const equity = Object.values(accs).reduce((s, v) => s + (Number(v) || 0), 0)
        return { timestamp, equity: String(equity), accounts: accs }
      })

      return c.json({ points })
    } catch {
      return c.json({ points: [] })
    }
  })

  return app
}
