/**
 * AI Trading Tool Factory — pure tool shell layer
 *
 * Defines Zod schemas and AI tool descriptions.
 * All business logic lives in UnifiedTradingAccount.
 * Each execute function is a thin delegation to UTA methods.
 */

import { tool, type Tool } from 'ai'
import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { UTAManager } from '@/domain/trading/uta-manager.js'
import { BrokerError, type OpenOrder } from '@/domain/trading/brokers/types.js'
import type { FxService } from '@/domain/trading/fx-service.js'
import { normalizeBrokerSearchPattern } from '@/domain/trading/contract-search-rules.js'
import '@/domain/trading/contract-ext.js'

/** Classify a broker error into a structured response for AI consumption. */
function handleBrokerError(err: unknown): { error: string; code: string; transient: boolean; hint: string } {
  const be = err instanceof BrokerError ? err : BrokerError.from(err)
  return {
    error: be.message,
    code: be.code,
    transient: !be.permanent,
    hint: be.permanent
      ? 'This is a permanent error (configuration or credentials). Do not retry.'
      : 'This may be a temporary issue. Wait a few seconds and try this tool again.',
  }
}

/** Summarize an OpenOrder into a compact object for AI consumption. */
function summarizeOrder(o: OpenOrder, source: string, stringOrderId?: string) {
  const order = o.order
  return {
    source,
    orderId: stringOrderId ?? String(order.orderId),
    aliceId: o.contract.aliceId ?? '',
    symbol: o.contract.symbol || o.contract.localSymbol || '',
    action: order.action,
    orderType: order.orderType,
    totalQuantity: order.totalQuantity.equals(UNSET_DECIMAL) ? '0' : order.totalQuantity.toFixed(),
    status: o.orderState.status,
    ...(!order.lmtPrice.equals(UNSET_DECIMAL) && { lmtPrice: order.lmtPrice.toFixed() }),
    ...(!order.auxPrice.equals(UNSET_DECIMAL) && { auxPrice: order.auxPrice.toFixed() }),
    ...(!order.trailStopPrice.equals(UNSET_DECIMAL) && { trailStopPrice: order.trailStopPrice.toFixed() }),
    ...(!order.trailingPercent.equals(UNSET_DECIMAL) && { trailingPercent: order.trailingPercent.toFixed() }),
    ...(order.tif && { tif: order.tif }),
    ...(!order.filledQuantity.equals(UNSET_DECIMAL) && { filledQuantity: order.filledQuantity.toString() }),
    ...(o.avgFillPrice != null && { avgFillPrice: o.avgFillPrice }),
    ...(order.parentId !== 0 && { parentId: order.parentId }),
    ...(order.ocaGroup && { ocaGroup: order.ocaGroup }),
    ...(o.tpsl && { tpsl: o.tpsl }),
  }
}

const sourceDesc = (required: boolean, extra?: string) => {
  const base = `Account source — matches account id (e.g. "alpaca-paper") or provider (e.g. "alpaca", "ccxt").`
  const req = required
    ? ' Required for this operation.'
    : ' Optional — omit to query all accounts.'
  return base + req + (extra ? ` ${extra}` : '')
}

/**
 * Numeric field that accepts either a JS number or a decimal string.
 * String form preserves precision beyond JS double (crypto satoshi-scale).
 * Internal pipeline wraps to Decimal regardless.
 */
/**
 * Positive numeric value as a decimal string. **String only** — no
 * number accepted. Forces LLM output through Decimal serialization
 * end-to-end so precision is preserved into the staging layer (the
 * persisted git records, ultimately). LLMs reliably emit strings
 * when the schema demands them; permissive `union([number, string])`
 * is unnecessary and re-opens the precision-loss path that this
 * whole sweep was meant to close.
 */
const positiveNumeric = z
  .string()
  .refine(
    (v) => {
      try {
        return new Decimal(v).gt(0) && new Decimal(v).isFinite()
      } catch {
        return false
      }
    },
    { message: 'must be a positive numeric string (e.g. "0.001", "150")' },
  )

export function createTradingTools(manager: UTAManager, fxService?: FxService): Record<string, Tool> {
  return {
    listUTAs: tool({
      description: 'List all registered trading accounts with their id, provider, label, and capabilities.',
      inputSchema: z.object({}),
      execute: () => manager.listUTAs(),
    }),

    searchContracts: tool({
      description: `Search broker accounts for tradeable contracts matching a pattern.
This is a BROKER-LEVEL search — it queries your connected trading accounts.

Pass \`assetClass\` when known (especially "crypto" or "currency") so the
data-vendor symbol is normalized into a broker-friendly pattern — e.g. a
search for "BTCUSD" with assetClass="crypto" is rewritten to "BTC" before
hitting the broker, which otherwise expects the bare base ticker.`,
      inputSchema: z.object({
        pattern: z.string().describe('Symbol or keyword to search'),
        assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity', 'unknown']).optional()
          .describe('Asset class hint. Improves matching for crypto/currency where data symbols concatenate quote currency.'),
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ pattern, assetClass, source }) => {
        // Symbol → broker pattern: see src/domain/trading/contract-search-rules.md
        // for what the normalization does and why.
        const brokerPattern = normalizeBrokerSearchPattern(pattern, assetClass ?? 'unknown')
        if (!brokerPattern) return { results: [], message: 'Empty pattern.' }
        // Source-scoped: when the caller pinned an account, only that one is
        // hit; otherwise fan out to all configured accounts.
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const all: Array<Record<string, unknown>> = []
        const settled = await Promise.allSettled(
          targets.map(async (uta) => ({ id: uta.id, results: await uta.searchContracts(brokerPattern) })),
        )
        for (const r of settled) {
          if (r.status !== 'fulfilled') continue
          for (const desc of r.value.results) all.push({ source: r.value.id, ...desc })
        }
        if (all.length === 0) return { results: [], message: `No contracts found matching "${brokerPattern}" (input: "${pattern}").` }
        return all
      },
    }),

    getContractDetails: tool({
      description: 'Get full contract specification from a specific broker account.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().optional().describe('Symbol to look up'),
        aliceId: z.string().optional().describe('Contract ID (format: accountId|nativeKey, from searchContracts)'),
        secType: z.string().optional().describe('Security type filter'),
        currency: z.string().optional().describe('Currency filter'),
      }),
      execute: async ({ source, symbol, aliceId, secType, currency }) => {
        const uta = manager.resolveOne(source)
        const query = new Contract()
        if (symbol) query.symbol = symbol
        if (aliceId) query.aliceId = aliceId
        if (secType) query.secType = secType
        if (currency) query.currency = currency
        const details = await uta.getContractDetails(query)
        if (!details) return { error: 'No contract details found.' }
        return { source: uta.id, ...details }
      },
    }),

    getAccount: tool({
      description: `Query trading account info (netLiquidation, totalCashValue, buyingPower, unrealizedPnL, realizedPnL).
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        try {
          const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...await uta.getAccount() })))
          return results.length === 1 ? results[0] : results
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    getPortfolio: tool({
      description: `Query current portfolio holdings. IMPORTANT: If result is an empty array [], you have no holdings.
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        symbol: z.string().optional().describe('Filter by ticker, or omit for all'),
      }),
      execute: async ({ source, symbol }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { positions: [], message: 'No accounts available.' }
        try {
          const allPositions: Array<Record<string, unknown>> = []
          const fxWarnings: string[] = []
          for (const uta of targets) {
            const positions = await uta.getPositions()
            const accountInfo = await uta.getAccount()

            // Convert position market values to USD for cross-currency percentage calculations
            let totalMarketValueUsd = new Decimal(0)
            const posUsdValues: Decimal[] = []
            for (const pos of positions) {
              if (fxService && pos.currency !== 'USD') {
                const r = await fxService.convertToUsd(pos.marketValue, pos.currency)
                posUsdValues.push(new Decimal(r.usd))
                if (r.fxWarning && !fxWarnings.includes(r.fxWarning)) fxWarnings.push(r.fxWarning)
              } else {
                posUsdValues.push(new Decimal(pos.marketValue))
              }
              totalMarketValueUsd = totalMarketValueUsd.plus(posUsdValues[posUsdValues.length - 1])
            }

            // Account netLiq in USD for equity percentage
            let netLiqUsd = new Decimal(accountInfo.netLiquidation)
            if (fxService && accountInfo.baseCurrency !== 'USD') {
              const r = await fxService.convertToUsd(accountInfo.netLiquidation, accountInfo.baseCurrency)
              netLiqUsd = new Decimal(r.usd)
            }

            let idx = 0
            for (const pos of positions) {
              if (symbol && symbol !== 'all' && pos.contract.symbol !== symbol) { idx++; continue }
              const mvUsd = posUsdValues[idx]
              const percentOfEquity = netLiqUsd.gt(0) ? mvUsd.div(netLiqUsd).mul(100) : new Decimal(0)
              const percentOfPortfolio = totalMarketValueUsd.gt(0) ? mvUsd.div(totalMarketValueUsd).mul(100) : new Decimal(0)
              allPositions.push({
                source: uta.id, symbol: pos.contract.symbol, currency: pos.currency, side: pos.side,
                quantity: pos.quantity.toString(), avgCost: pos.avgCost, marketPrice: pos.marketPrice,
                marketValue: pos.marketValue, unrealizedPnL: pos.unrealizedPnL, realizedPnL: pos.realizedPnL,
                percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
                percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
              })
              idx++
            }
          }
          if (allPositions.length === 0) return { positions: [], message: 'No open positions.' }
          if (fxWarnings.length > 0) return { positions: allPositions, fxWarnings }
          return allPositions
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    getOrders: tool({
      description: `Query orders by ID. If no orderIds provided, queries all pending (submitted) orders.
Use groupBy: "contract" to group orders by contract/aliceId (useful with many positions + TPSL).
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        orderIds: z.array(z.string()).optional().describe('Order IDs to query. If omitted, queries all pending orders.'),
        groupBy: z.enum(['contract']).optional().describe('Group orders by contract (aliceId)'),
      }),
      execute: async ({ source, orderIds, groupBy }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return []
        try {
          const summaries = (await Promise.all(targets.map(async (uta) => {
            const ids = orderIds ?? uta.getPendingOrderIds().map(p => p.orderId)
            const orders = await uta.getOrders(ids)
            return orders.map((o, i) => summarizeOrder(o, uta.id, ids[i]))
          }))).flat()

          if (groupBy === 'contract') {
            const grouped: Record<string, { symbol: string; orders: ReturnType<typeof summarizeOrder>[] }> = {}
            for (const s of summaries) {
              const key = s.aliceId || s.symbol
              if (!grouped[key]) grouped[key] = { symbol: s.symbol, orders: [] }
              grouped[key].orders.push(s)
            }
            return grouped
          }
          return summaries
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    getQuote: tool({
      description: `Query the latest quote/price for a contract.
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({
        aliceId: z.string().describe('Contract ID (format: accountId|nativeKey, from searchContracts)'),
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ aliceId, source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const query = new Contract()
        query.aliceId = aliceId
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          try { results.push({ source: uta.id, ...await uta.getQuote(query) }) } catch { /* skip */ }
        }
        if (results.length === 0) return { error: `No account could quote aliceId "${aliceId}".` }
        return results.length === 1 ? results[0] : results
      },
    }),

    getMarketClock: tool({
      description: `Get current market clock status (isOpen, nextOpen, nextClose).
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        try {
          const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...await uta.getMarketClock() })))
          return results.length === 1 ? results[0] : results
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    tradingLog: tool({
      description: `View your trading decision history (like "git log --stat").
IMPORTANT: Check this BEFORE making new trading decisions.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        limit: z.number().int().positive().optional().describe('Number of recent commits (default: 10)'),
        symbol: z.string().optional().describe('Filter commits by symbol'),
      }),
      execute: ({ source, limit, symbol }) => {
        const targets = manager.resolve(source)
        const allEntries: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          for (const entry of uta.log({ limit, symbol })) allEntries.push({ source: uta.id, ...entry })
        }
        allEntries.sort((a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime())
        return limit ? allEntries.slice(0, limit) : allEntries
      },
    }),

    tradingShow: tool({
      description: 'View details of a specific trading commit (like "git show <hash>").',
      inputSchema: z.object({ hash: z.string().describe('Commit hash (8 characters)') }),
      execute: ({ hash }) => {
        for (const uta of manager.resolve()) {
          const commit = uta.show(hash)
          if (commit) return { source: uta.id, ...commit }
        }
        return { error: `Commit ${hash} not found in any account` }
      },
    }),

    tradingStatus: tool({
      description: 'View current trading staging area status (like "git status").',
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }),
      execute: ({ source }) => {
        const targets = manager.resolve(source)
        const results = targets.map((uta) => ({ source: uta.id, ...uta.status() }))
        return results.length === 1 ? results[0] : results
      },
    }),

    simulatePriceChange: tool({
      description: 'Simulate price changes to see portfolio impact (dry run, READ-ONLY).',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        priceChanges: z.array(z.object({
          symbol: z.string().describe('Ticker or "all"'),
          change: z.string().describe('"@150" for absolute, "+10%" or "-5%" for relative'),
        })),
      }),
      execute: async ({ source, priceChanges }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) results.push({ source: uta.id, ...await uta.simulatePriceChange(priceChanges) })
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Mutations ====================

    placeOrder: tool({
      description: `Stage an order (will execute on tradingPush).
BEFORE placing orders: check tradingLog, getPortfolio, verify strategy alignment.
NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.
Required params by orderType:
  MKT: totalQuantity (or cashQty)
  LMT: totalQuantity + lmtPrice
  STP: totalQuantity + auxPrice (stop trigger)
  STP LMT: totalQuantity + auxPrice (stop trigger) + lmtPrice
  TRAIL: totalQuantity + auxPrice (trailing offset) or trailingPercent
  TRAIL LIMIT: totalQuantity + auxPrice (trailing offset) + lmtPrice
  MOC: totalQuantity
Optional: attach takeProfit and/or stopLoss for automatic exit orders.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        aliceId: z.string().describe('Contract ID (format: accountId|nativeKey, from searchContracts)'),
        symbol: z.string().optional().describe('Human-readable symbol (optional, for display only)'),
        action: z.enum(['BUY', 'SELL']).describe('Order direction'),
        orderType: z.enum(['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL', 'TRAIL LIMIT', 'MOC']).describe('Order type'),
        totalQuantity: positiveNumeric.optional().describe('Number of shares/contracts as a decimal string (e.g. "0.001"). Mutually exclusive with cashQty.'),
        cashQty: positiveNumeric.optional().describe('Notional dollar amount (mutually exclusive with totalQuantity).'),
        lmtPrice: positiveNumeric.optional().describe('Limit price as a decimal string (required for LMT, STP LMT, TRAIL LIMIT). String preserves satoshi-scale precision.'),
        auxPrice: positiveNumeric.optional().describe('Stop trigger price for STP/STP LMT; trailing offset amount for TRAIL/TRAIL LIMIT.'),
        trailStopPrice: positiveNumeric.optional().describe('Initial trailing stop price (TRAIL/TRAIL LIMIT only).'),
        trailingPercent: positiveNumeric.optional().describe('Trailing stop percentage offset (alternative to auxPrice for TRAIL).'),
        tif: z.enum(['DAY', 'GTC', 'IOC', 'FOK', 'OPG', 'GTD']).default('DAY').describe('Time in force'),
        goodTillDate: z.string().optional().describe('Expiration datetime for GTD orders'),
        outsideRth: z.boolean().optional().describe('Allow execution outside regular trading hours'),
        parentId: z.string().optional().describe('Parent order ID (bracket orders)'),
        ocaGroup: z.string().optional().describe('One-Cancels-All group name'),
        takeProfit: z.object({
          price: z.string().describe('Take profit price'),
        }).optional().describe('Take profit order (single-level, full quantity)'),
        stopLoss: z.object({
          price: z.string().describe('Stop loss trigger price'),
          limitPrice: z.string().optional().describe('Limit price for stop-limit SL (omit for stop-market)'),
        }).optional().describe('Stop loss order (single-level, full quantity)'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stagePlaceOrder(params),
    }),

    modifyOrder: tool({
      description: 'Stage an order modification.\nNOTE: This stages the operation. Call tradingCommit + tradingPush to execute.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        orderId: z.string().describe('Order ID to modify'),
        totalQuantity: positiveNumeric.optional().describe('New quantity. Decimal string (e.g. "0.001").'),
        lmtPrice: positiveNumeric.optional().describe('New limit price. Decimal string.'),
        auxPrice: positiveNumeric.optional().describe('New stop trigger price or trailing offset (depends on order type). Decimal string.'),
        trailStopPrice: positiveNumeric.optional().describe('New initial trailing stop price. Decimal string.'),
        trailingPercent: positiveNumeric.optional().describe('New trailing stop percentage. Decimal string.'),
        orderType: z.enum(['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL', 'TRAIL LIMIT', 'MOC']).optional().describe('New order type'),
        tif: z.enum(['DAY', 'GTC', 'IOC', 'FOK', 'OPG', 'GTD']).optional().describe('New time in force'),
        goodTillDate: z.string().optional().describe('New expiration date'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stageModifyOrder(params),
    }),

    closePosition: tool({
      description: 'Stage a position close.\nNOTE: This stages the operation. Call tradingCommit + tradingPush to execute.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        aliceId: z.string().describe('Contract ID (format: accountId|nativeKey, from searchContracts)'),
        symbol: z.string().optional().describe('Human-readable symbol. Optional.'),
        qty: positiveNumeric.optional().describe('Number of shares to sell. Decimal string. Default: sell all.'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stageClosePosition(params),
    }),

    cancelOrder: tool({
      description: 'Stage an order cancellation.\nNOTE: This stages the operation. Call tradingCommit + tradingPush to execute.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        orderId: z.string().describe('Order ID to cancel'),
      }),
      execute: ({ source, orderId }) => manager.resolveOne(source).stageCancelOrder({ orderId }),
    }),

    tradingCommit: tool({
      description: 'Commit staged trading operations with a message (like "git commit -m"). Does NOT execute yet.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, commits all accounts with staged operations.')),
        message: z.string().describe('Commit message explaining your trading decision'),
      }),
      execute: ({ source, message }) => {
        const targets = manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          if (uta.status().staged.length === 0) continue
          results.push({ source: uta.id, ...uta.commit(message) })
        }
        if (results.length === 0) return { message: 'No staged operations to commit.' }
        return results.length === 1 ? results[0] : results
      },
    }),

    tradingPush: tool({
      description: 'Trading push requires manual approval — call tradingStatus to show the user what is pending, then tell them to approve (via Web UI, Telegram /trading, or other connected channels).',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, checks all accounts.')),
      }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        const pending = targets.filter(uta => uta.status().pendingMessage)
        if (pending.length === 0) {
          const uncommitted = targets.filter(uta => uta.status().staged.length > 0)
          if (uncommitted.length > 0) {
            return {
              error: 'You have staged operations that are NOT committed yet. Call tradingCommit first, then tradingPush.',
              uncommitted: uncommitted.map(uta => ({ source: uta.id, staged: uta.status().staged })),
            }
          }
          return { message: 'No committed operations to push.' }
        }
        return {
          message: 'Push requires manual approval. The user can approve pending operations from any connected channel (Web UI, Telegram /trading, etc).',
          pending: pending.map(uta => ({
            source: uta.id,
            ...uta.status(),
          })),
        }
      },
    }),

    tradingSync: tool({
      description: 'Sync pending order statuses from broker (like "git pull"). Use delayMs to wait before querying — exchanges may need a few seconds to settle after order placement.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, syncs all accounts with pending orders.')),
        delayMs: z.number().int().min(0).max(30_000).optional().describe('Wait this many ms before querying exchange. Default: 0. Recommended: 2000-5000 after market orders.'),
      }),
      execute: async ({ source, delayMs }) => {
        const targets = manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          if (uta.getPendingOrderIds().length === 0) continue
          const result = await uta.sync({ delayMs })
          if (result.updatedCount > 0) results.push({ source: uta.id, ...result })
        }
        if (results.length === 0) return { message: 'No pending orders to sync.', updatedCount: 0 }
        return results.length === 1 ? results[0] : results
      },
    }),
  }
}
