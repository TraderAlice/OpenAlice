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
import { Contract, coerceSecType } from '@traderalice/ibkr'
import { BrokerError, type OpenOrder } from '@traderalice/uta-protocol'
import type { UTAManagerSDK } from '@/services/uta-client/index.js'
import { normalizeBrokerSearchPattern } from '@traderalice/uta-protocol'
import {
  compactAccountInfo, compactCommit, compactContract, compactContractDetails,
  compactOperation, compactOrderFields, compactPushResult, compactStageResult, compactStatus,
  money, price,
} from './trading-compact.js'
// `Contract.aliceId` declaration merge is registered as a side-effect
// of `@traderalice/uta-protocol`'s barrel — already pulled in above.

/** aliceId is "{utaId}|{nativeKey}" — split locally so the tool can pick
 *  the owning account before any HTTP call. Pure utility, no broker
 *  knowledge required (broker-specific decoding happens server-side on
 *  the `aliceId`-aware routes). */
function parseAliceId(aliceId: string): { utaId: string; nativeKey: string } | null {
  const idx = aliceId.indexOf('|')
  if (idx <= 0) return null
  return { utaId: aliceId.slice(0, idx), nativeKey: aliceId.slice(idx + 1) }
}

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

/**
 * Summarize an OpenOrder for AI consumption. Uses the value-tolerant
 * compactors (NOT order.field.equals(...)) because over HTTP the Order's
 * Decimal fields arrive as strings — calling Decimal methods on them threw
 * "totalQuantity.equals is not a function" and broke getOrders entirely.
 * Order id comes from the top-level string field: the inner `order.orderId`
 * is the IBKR number form and float-truncates 19-digit CCXT ids (…344→…300).
 */
function summarizeOrder(o: OpenOrder, source: string, stringOrderId?: string) {
  const order = o.order as unknown as Record<string, unknown>
  const innerId = order['orderId']
  return {
    source,
    orderId: stringOrderId ?? o.orderId ?? (innerId != null ? String(innerId) : ''),
    aliceId: o.contract.aliceId ?? '',
    symbol: o.contract.symbol || o.contract.localSymbol || '',
    status: o.orderState.status,
    ...compactOrderFields(order),
    ...(o.avgFillPrice != null && { avgFillPrice: price(o.avgFillPrice) }),
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
 *
 * Empty string `""` is normalized to `undefined` before validation.
 * Why: when this validator is used with `.optional()`, LLMs often
 * emit `""` for fields they don't intend to set (instead of omitting
 * the key), and a bare `z.string().refine(...).optional()` would
 * then reject the empty string against the positive-number rule.
 * Treating `""` as "not provided" matches the AI-ergonomics the
 * `.optional()` site actually wants.
 */
const positiveNumeric = z
  .string()
  .refine(
    (v) => {
      if (v === '') return true
      try {
        return new Decimal(v).gt(0) && new Decimal(v).isFinite()
      } catch {
        return false
      }
    },
    { message: 'must be a positive numeric string (e.g. "0.001", "150")' },
  )
  .transform((v) => (v === '' ? undefined : v))


/** Distinguish "no accounts configured" from "your source matched nothing"
 *  — and list what WOULD match, so the agent self-corrects in one step
 *  instead of concluding no accounts exist. */
async function noAccountsError(manager: UTAManagerSDK, source?: string): Promise<{ error: string }> {
  try {
    const ids = (await manager.listUTAs()).map((u: { id: string }) => u.id)
    if (source && ids.length > 0) {
      return { error: `Unknown source "${source}". Available accounts: ${ids.join(', ')}.` }
    }
    return { error: ids.length === 0 ? 'No trading accounts configured.' : 'No accounts available.' }
  } catch {
    return { error: 'No accounts available.' }
  }
}


/** Stage + (optionally) commit in one call. The stage→commit split is pure
 *  ceremony when one decision = one operation — which is the dominant agent
 *  flow. The approval wall (push) is untouched. */
async function stageAndMaybeCommit(
  uta: { stage: () => Promise<unknown> | unknown; commit: (msg: string) => Promise<unknown> | unknown },
  commitMessage?: string,
): Promise<Record<string, unknown>> {
  const staged = compactStageResult(await uta.stage())
  if (!commitMessage) return staged
  const committed = await uta.commit(commitMessage) as Record<string, unknown>
  return {
    ...staged,
    committed: { hash: committed['hash'], message: committed['message'] },
    nextStep: 'Awaiting user approval — they approve in the Web UI (push executes there).',
  }
}

export function createTradingTools(manager: UTAManagerSDK): Record<string, Tool> {
  return {
    listUTAs: tool({
      description: 'List all registered trading accounts with their id, provider, label, and capabilities.',
      inputSchema: z.object({}),
      execute: async () => await manager.listUTAs(),
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
      }).meta({ examples: [{ pattern: 'AAPL' }] }),
      execute: async ({ pattern, assetClass, source }) => {
        // Symbol → broker pattern: see src/domain/trading/contract-search-rules.md
        // for what the normalization does and why.
        const brokerPattern = normalizeBrokerSearchPattern(pattern, assetClass ?? 'unknown')
        if (!brokerPattern) return { results: [], message: 'Empty pattern.' }
        // Source-scoped: when the caller pinned an account, only that one is
        // hit; otherwise fan out to all configured accounts.
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
        const all: Array<Record<string, unknown>> = []
        const settled = await Promise.allSettled(
          targets.map(async (uta) => ({ id: uta.id, results: await uta.searchContracts(brokerPattern) })),
        )
        for (const r of settled) {
          if (r.status !== 'fulfilled') continue
          for (const desc of r.value.results) all.push({ source: r.value.id, ...desc, contract: compactContract((desc as { contract?: unknown }).contract) })
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
      }).meta({ examples: [{ source: 'alpaca-paper', symbol: 'AAPL' }] }),
      execute: async ({ source, symbol, aliceId, secType, currency }) => {
        const uta = await manager.resolveOne(source)
        // Tool only assembles a Contract shell here — aliceId expansion
        // is now done inside `UnifiedTradingAccount.getContractDetails`
        // (and identically by the UTA HTTP route), so this code path is
        // the same whether `manager` is the real in-process UTAManager
        // or the SDK.
        const query = new Contract()
        if (aliceId) query.aliceId = aliceId
        if (symbol) query.symbol = symbol
        if (secType) query.secType = coerceSecType(secType)
        if (currency) query.currency = currency
        try {
          const details = await uta.getContractDetails(query)
          if (!details) return { error: 'No contract details found.' }
          return { source: uta.id, ...compactContractDetails(details) }
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    getAccount: tool({
      description: `Query trading account info (netLiquidation, totalCashValue, buyingPower, unrealizedPnL, realizedPnL).
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
        try {
          const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...compactAccountInfo(await uta.getAccount()) })))
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
      }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source, symbol }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return { positions: [], ...(await noAccountsError(manager, source)) }
        // FX rates table — UTA's /fx-rates collects every currency in
        // use server-side and returns a flat lookup. Locally we treat
        // missing rates as 1.0 (the broker probably reported a USD-side
        // value already) and accumulate any warnings the rate carries.
        const fxLookup = new Map<string, number>()
        const fxWarningsFromRates: string[] = []
        try {
          const rates = await manager.getFxRates()
          for (const r of rates) {
            fxLookup.set(r.currency, r.rate)
            if (r.source === 'default' || r.source === 'fallback') {
              fxWarningsFromRates.push(`${r.currency} rate using ${r.source} table`)
            }
          }
        } catch { /* if /fx-rates is unreachable, fall through with empty map */ }
        const fxToUsd = (amount: string, currency: string): string => {
          if (currency === 'USD') return amount
          const rate = fxLookup.get(currency) ?? 1
          return new Decimal(amount).mul(rate).toString()
        }
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
              posUsdValues.push(new Decimal(fxToUsd(pos.marketValue, pos.currency)))
              totalMarketValueUsd = totalMarketValueUsd.plus(posUsdValues[posUsdValues.length - 1])
            }

            // Account netLiq in USD for equity percentage
            const netLiqUsd = new Decimal(fxToUsd(accountInfo.netLiquidation, accountInfo.baseCurrency))

            let idx = 0
            for (const pos of positions) {
              if (symbol && symbol !== 'all' && pos.contract.symbol !== symbol) { idx++; continue }
              const mvUsd = posUsdValues[idx]
              const percentOfEquity = netLiqUsd.gt(0) ? mvUsd.div(netLiqUsd).mul(100) : new Decimal(0)
              const percentOfPortfolio = totalMarketValueUsd.gt(0) ? mvUsd.div(totalMarketValueUsd).mul(100) : new Decimal(0)
              allPositions.push({
                source: uta.id, symbol: pos.contract.symbol,
                // secType + aliceId disambiguate same-symbol positions (ETH
                // spot vs ETH perp render identically without them) and give
                // the agent the exact id closePosition needs.
                secType: pos.contract.secType,
                aliceId: pos.contract.aliceId,
                currency: pos.currency, side: pos.side,
                quantity: pos.quantity.toString(), avgCost: price(pos.avgCost), marketPrice: price(pos.marketPrice),
                marketValue: money(pos.marketValue), unrealizedPnL: money(pos.unrealizedPnL), realizedPnL: money(pos.realizedPnL),
                percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
                percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
              })
              idx++
            }
          }
          if (allPositions.length === 0) return { positions: [], message: 'No open positions.' }
          const allWarnings = [...new Set([...fxWarnings, ...fxWarningsFromRates])]
          if (allWarnings.length > 0) return { positions: allPositions, fxWarnings: allWarnings }
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
      }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source, orderIds, groupBy }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return []
        try {
          const summaries = (await Promise.all(targets.map(async (uta) => {
            // SDK's getPendingOrderIds is a no-op returning []; the real
            // UnifiedTradingAccount returns the actual pending list. Both
            // satisfy the same call site so this works for Phase A's
            // dual-impl world.
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
      }).meta({ examples: [{ aliceId: 'alpaca-paper|AAPL' }] }),
      execute: async ({ aliceId, source }) => {
        // aliceId is UTA-scoped (`{utaId}|{nativeKey}`); route directly to
        // the owning UTA. Fall back to caller-supplied `source` if given
        // (allows overrides / sanity-check). Server-side decoding via the
        // POST /quote route does the broker-specific contract reconstruction.
        const parsed = parseAliceId(aliceId)
        if (!parsed) {
          return { error: `Invalid aliceId "${aliceId}". Expected format: "accountId|nativeKey".` }
        }
        try {
          const uta = await manager.resolveOne(source ?? parsed.utaId)
          // Same as getContractDetails — aliceId expansion lives inside
          // UnifiedTradingAccount.getQuote (and the route), so the tool
          // just hands over the aliceId stub.
          const contract = Object.assign(new Contract(), { aliceId })
          const quote = await uta.getQuote(contract)
          return { source: uta.id, ...quote, contract: compactContract(quote.contract) }
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    getMarketClock: tool({
      description: `Get current market clock status (isOpen, nextOpen, nextClose).
If this tool returns an error with transient=true, wait a few seconds and retry once before reporting to the user.`,
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
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
      }).meta({ examples: [{ source: 'alpaca-paper', limit: 10 }] }),
      execute: async ({ source, limit, symbol }) => {
        const targets = await manager.resolve(source)
        const allEntries: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          for (const entry of await uta.log({ limit, symbol })) allEntries.push({ source: uta.id, ...entry })
        }
        allEntries.sort((a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime())
        return limit ? allEntries.slice(0, limit) : allEntries
      },
    }),

    tradingShow: tool({
      description: 'View details of a specific trading commit (like "git show <hash>").',
      inputSchema: z.object({ hash: z.string().describe('Commit hash (8 characters)') }).meta({ examples: [{ hash: '00000000' }] }),
      execute: async ({ hash }) => {
        for (const uta of await manager.resolve()) {
          const commit = await uta.show(hash)
          if (commit) return { source: uta.id, ...compactCommit(commit) }
        }
        return { error: `Commit ${hash} not found in any account` }
      },
    }),

    tradingStatus: tool({
      description: 'View current trading staging area status (like "git status").',
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source }) => {
        const targets = await manager.resolve(source)
        const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...compactStatus(await uta.status()) })))
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
      }).meta({ examples: [{ source: 'alpaca-paper', priceChanges: [{ symbol: 'AAPL', change: '+10%' }] }] }),
      execute: async ({ source, priceChanges }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
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
        source: z.string().optional().describe(sourceDesc(false, 'Defaults to the account inside aliceId.')),
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
        commitMessage: z.string().optional().describe('Stage AND commit in one step with this message (your trading thesis). Push/approval still required.'),
      }).meta({ examples: [{ aliceId: 'alpaca-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '1', commitMessage: 'Entry: momentum breakout' }] }),
      execute: async ({ source, commitMessage, ...params }) => {
        const uta = await manager.resolveOne(source ?? parseAliceId(params.aliceId)?.utaId ?? '')
        return stageAndMaybeCommit({ stage: () => uta.stagePlaceOrder(params), commit: (m) => uta.commit(m) }, commitMessage)
      },
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
        commitMessage: z.string().optional().describe('Stage AND commit in one step with this message. Push/approval still required.'),
      }).meta({ examples: [{ source: 'alpaca-paper', orderId: '1', lmtPrice: '150' }] }),
      execute: async ({ source, commitMessage, ...params }) => {
        const uta = await manager.resolveOne(source)
        return stageAndMaybeCommit({ stage: () => uta.stageModifyOrder(params), commit: (m) => uta.commit(m) }, commitMessage)
      },
    }),

    closePosition: tool({
      description: 'Stage a position close.\nNOTE: This stages the operation. Call tradingCommit + tradingPush to execute.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'Defaults to the account inside aliceId.')),
        aliceId: z.string().describe('Contract ID (format: accountId|nativeKey, from searchContracts)'),
        symbol: z.string().optional().describe('Human-readable symbol. Optional.'),
        qty: positiveNumeric.optional().describe('Number of shares to sell. Decimal string. Default: sell all.'),
        commitMessage: z.string().optional().describe('Stage AND commit in one step with this message. Push/approval still required.'),
      }).meta({ examples: [{ aliceId: 'alpaca-paper|AAPL', commitMessage: 'Exit: thesis invalidated' }] }),
      execute: async ({ source, commitMessage, ...params }) => {
        const uta = await manager.resolveOne(source ?? parseAliceId(params.aliceId)?.utaId ?? '')
        return stageAndMaybeCommit({ stage: () => uta.stageClosePosition(params), commit: (m) => uta.commit(m) }, commitMessage)
      },
    }),

    cancelOrder: tool({
      description: 'Stage an order cancellation.\nNOTE: This stages the operation. Call tradingCommit + tradingPush to execute.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        orderId: z.string().describe('Order ID to cancel'),
        commitMessage: z.string().optional().describe('Stage AND commit in one step with this message. Push/approval still required.'),
      }).meta({ examples: [{ source: 'alpaca-paper', orderId: '1', commitMessage: 'Cancel: stale level' }] }),
      execute: async ({ source, orderId, commitMessage }) => {
        const uta = await manager.resolveOne(source)
        return stageAndMaybeCommit({ stage: () => uta.stageCancelOrder({ orderId }), commit: (m) => uta.commit(m) }, commitMessage)
      },
    }),

    tradingCommit: tool({
      description: 'Commit staged trading operations with a message (like "git commit -m"). Does NOT execute yet.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, commits all accounts with staged operations.')),
        message: z.string().describe('Commit message explaining your trading decision'),
      }).meta({ examples: [{ message: 'Entry: long AAPL on momentum' }] }),
      execute: async ({ source, message }) => {
        const targets = await manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          const status = await uta.status()
          if (status.staged.length === 0) continue
          results.push({ source: uta.id, ...await uta.commit(message) })
        }
        if (results.length === 0) return { message: 'No staged operations to commit.' }
        return results.length === 1 ? results[0] : results
      },
    }),

    tradingPush: tool({
      description: 'Trading push requires manual approval — call tradingStatus to show the user what is pending, then ask them to approve it on the Web UI (Trading as Git page, or the account detail page).',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, checks all accounts.')),
      }).meta({ examples: [{ source: 'alpaca-paper' }] }),
      execute: async ({ source }) => {
        const targets = await manager.resolve(source)
        const statuses = await Promise.all(targets.map(async (uta) => ({ uta, status: await uta.status() })))
        const pending = statuses.filter(({ status }) => status.pendingMessage)
        if (pending.length === 0) {
          const uncommitted = statuses.filter(({ status }) => status.staged.length > 0)
          if (uncommitted.length > 0) {
            return {
              error: 'You have staged operations that are NOT committed yet. Call tradingCommit first, then tradingPush.',
              uncommitted: uncommitted.map(({ uta, status }) => ({ source: uta.id, staged: status.staged.map(compactOperation) })),
            }
          }
          return { message: 'No committed operations to push.' }
        }
        return {
          message: 'Push requires manual approval. Tell the user to review and approve the pending operations in the Web UI (Trading as Git page, or the account detail page).',
          pending: pending.map(({ uta, status }) => ({
            source: uta.id,
            ...compactStatus(status),
          })),
        }
      },
    }),

    tradingReject: tool({
      description: 'Discard staged (and committed-but-unpushed) operations — the undo for a wrong stage (like "git reset"). Nothing is sent to the broker; the rejection is recorded in the trading log.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        reason: z.string().optional().describe('Why the staged operations are being discarded'),
      }).meta({ examples: [{ source: 'alpaca-paper', reason: 'wrong limit price' }] }),
      execute: async ({ source, reason }) => {
        try {
          const uta = await manager.resolveOne(source)
          const status = await uta.status()
          if (status.staged.length === 0) return { message: 'Nothing staged to reject.' }
          // reject() requires a prepared commit — prepare one transparently
          // so the AI's mental model stays "stage → reject = undo".
          if (!status.pendingHash) await uta.commit(reason ?? 'discarding staged operations')
          return { source: uta.id, ...await uta.reject(reason) }
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    orderHistory: tool({
      description: 'Order history — one row per order with its lifecycle collapsed (submitted → filled/cancelled/rejected, fill price+qty, source "external" for orders placed outside Alice). Prefer this over tradingLog when analyzing what happened to orders.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        limit: z.number().int().min(1).max(200).optional().describe('Max rows per account (default 50)'),
      }).meta({ examples: [{ source: 'alpaca-paper', limit: 20 }] }),
      execute: async ({ source, limit }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
        try {
          const all = (await Promise.all(targets.map(async (uta) =>
            (await uta.orderHistory(limit ?? 50)).map((o) => ({ account: uta.id, ...o })),
          ))).flat()
          return all.length === 0 ? { orders: [], message: 'No order history yet.' } : all
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    tradeHistory: tool({
      description: 'Trade history — fills only, with execution price/qty/value. Entries with source "reconcile" are balance drift folded in at observed price (external transfers, fees), not real fills.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        limit: z.number().int().min(1).max(200).optional().describe('Max rows per account (default 50)'),
      }).meta({ examples: [{ source: 'alpaca-paper', limit: 20 }] }),
      execute: async ({ source, limit }) => {
        const targets = await manager.resolve(source)
        if (targets.length === 0) return await noAccountsError(manager, source)
        try {
          const all = (await Promise.all(targets.map(async (uta) =>
            (await uta.tradeHistory(limit ?? 50)).map((t) => ({ account: uta.id, ...t })),
          ))).flat()
          return all.length === 0 ? { trades: [], message: 'No trades yet.' } : all
        } catch (err) {
          return handleBrokerError(err)
        }
      },
    }),

    tradingSync: tool({
      description: 'Sync pending order statuses from broker (like "git pull"). Use delayMs to wait before querying — exchanges may need a few seconds to settle after order placement.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, syncs all accounts with pending orders.')),
        delayMs: z.number().int().min(0).max(30_000).optional().describe('Wait this many ms before querying exchange. Default: 0. Recommended: 2000-5000 after market orders.'),
      }).meta({ examples: [{ source: 'alpaca-paper', delayMs: 2000 }] }),
      execute: async ({ source, delayMs }) => {
        const targets = await manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          // The UTA-side sync route returns updatedCount=0 when nothing's
          // pending — no client-side pre-check needed.
          const result = await uta.sync({ delayMs })
          if (result.updatedCount > 0) results.push({ source: uta.id, ...result })
        }
        if (results.length === 0) return { message: 'No pending orders to sync.', updatedCount: 0 }
        return results.length === 1 ? results[0] : results
      },
    }),
  }
}
