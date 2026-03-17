/**
 * AI Trading Tool Factory — pure tool shell layer
 *
 * Defines Zod schemas and AI tool descriptions.
 * All business logic lives in UnifiedTradingAccount.
 * Each execute function is a thin delegation to UTA methods.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { Contract } from '@traderalice/ibkr'
import type { AccountManager } from '@/domain/trading/account-manager.js'
import '@/domain/trading/contract-ext.js'

const sourceDesc = (required: boolean, extra?: string) => {
  const base = `Account source — matches account id (e.g. "alpaca-paper") or provider (e.g. "alpaca", "ccxt").`
  const req = required
    ? ' Required for this operation.'
    : ' Optional — omit to query all accounts.'
  return base + req + (extra ? ` ${extra}` : '')
}

export function createTradingTools(manager: AccountManager) {
  return {
    listAccounts: tool({
      description: 'List all registered trading accounts with their id, provider, label, and capabilities.',
      inputSchema: z.object({}),
      execute: () => manager.listAccounts(),
    }),

    searchContracts: tool({
      description: `Search broker accounts for tradeable contracts matching a pattern.
This is a BROKER-LEVEL search — it queries your connected trading accounts.`,
      inputSchema: z.object({
        pattern: z.string().describe('Symbol or keyword to search'),
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ pattern, source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const allResults: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          try {
            const descriptions = await uta.searchContracts(pattern)
            for (const desc of descriptions) allResults.push({ source: uta.id, ...desc })
          } catch { /* skip */ }
        }
        if (allResults.length === 0) return { results: [], message: `No contracts found matching "${pattern}".` }
        return allResults
      },
    }),

    getContractDetails: tool({
      description: 'Get full contract specification from a specific broker account.',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().optional().describe('Symbol to look up'),
        aliceId: z.string().optional().describe('Alice contract ID for exact match'),
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
      description: 'Query trading account info (netLiquidation, totalCashValue, buyingPower, unrealizedPnL, realizedPnL).',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...await uta.getAccount() })))
        return results.length === 1 ? results[0] : results
      },
    }),

    getPortfolio: tool({
      description: `Query current portfolio holdings. IMPORTANT: If result is an empty array [], you have no holdings.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        symbol: z.string().optional().describe('Filter by ticker, or omit for all'),
      }),
      execute: async ({ source, symbol }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { positions: [], message: 'No accounts available.' }
        const allPositions: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          const positions = await uta.getPositions()
          const accountInfo = await uta.getAccount()
          const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0)
          for (const pos of positions) {
            if (symbol && symbol !== 'all' && pos.contract.symbol !== symbol) continue
            const percentOfEquity = accountInfo.netLiquidation > 0 ? (pos.marketValue / accountInfo.netLiquidation) * 100 : 0
            const percentOfPortfolio = totalMarketValue > 0 ? (pos.marketValue / totalMarketValue) * 100 : 0
            allPositions.push({
              source: uta.id, symbol: pos.contract.symbol, side: pos.side,
              quantity: pos.quantity.toNumber(), avgCost: pos.avgCost, marketPrice: pos.marketPrice,
              marketValue: pos.marketValue, unrealizedPnL: pos.unrealizedPnL, realizedPnL: pos.realizedPnL,
              leverage: pos.leverage, margin: pos.margin, liquidationPrice: pos.liquidationPrice,
              percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
              percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
            })
          }
        }
        if (allPositions.length === 0) return { positions: [], message: 'No open positions.' }
        return allPositions
      },
    }),

    getOrders: tool({
      description: 'Query order history (filled, pending, cancelled)',
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return []
        const results = await Promise.all(targets.map(async (uta) => {
          const orders = await uta.getOrders()
          return orders.map((o) => ({ source: uta.id, ...o }))
        }))
        return results.flat()
      },
    }),

    getQuote: tool({
      description: 'Query the latest quote/price for a contract.',
      inputSchema: z.object({
        aliceId: z.string().describe('Contract identifier from searchContracts'),
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
      description: 'Get current market clock status (isOpen, nextOpen, nextClose).',
      inputSchema: z.object({ source: z.string().optional().describe(sourceDesc(false)) }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }
        const results = await Promise.all(targets.map(async (uta) => ({ source: uta.id, ...await uta.getMarketClock() })))
        return results.length === 1 ? results[0] : results
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
NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        aliceId: z.string().describe('Contract identifier from searchContracts'),
        symbol: z.string().optional().describe('Human-readable symbol. Optional.'),
        side: z.enum(['buy', 'sell']).describe('Buy or sell'),
        type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'trailing_stop_limit', 'moc']).describe('Order type'),
        qty: z.number().positive().optional().describe('Number of shares'),
        notional: z.number().positive().optional().describe('Dollar amount'),
        price: z.number().positive().optional().describe('Limit price'),
        stopPrice: z.number().positive().optional().describe('Stop trigger price'),
        trailingAmount: z.number().positive().optional().describe('Trailing stop offset'),
        trailingPercent: z.number().positive().optional().describe('Trailing stop percentage'),
        timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok', 'opg', 'gtd']).default('day').describe('Time in force'),
        goodTillDate: z.string().optional().describe('Expiration date for GTD'),
        extendedHours: z.boolean().optional().describe('Allow pre/after-hours'),
        parentId: z.string().optional().describe('Parent order ID for bracket orders'),
        ocaGroup: z.string().optional().describe('One-Cancels-All group name'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stagePlaceOrder(params),
    }),

    modifyOrder: tool({
      description: 'Stage an order modification (will execute on tradingPush).',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        orderId: z.string().describe('Order ID to modify'),
        qty: z.number().positive().optional().describe('New quantity'),
        price: z.number().positive().optional().describe('New limit price'),
        stopPrice: z.number().positive().optional().describe('New stop trigger price'),
        trailingAmount: z.number().positive().optional().describe('New trailing stop offset'),
        trailingPercent: z.number().positive().optional().describe('New trailing stop percentage'),
        type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'trailing_stop_limit', 'moc']).optional().describe('New order type'),
        timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok', 'opg', 'gtd']).optional().describe('New time in force'),
        goodTillDate: z.string().optional().describe('New expiration date'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stageModifyOrder(params),
    }),

    closePosition: tool({
      description: 'Stage a position close (will execute on tradingPush).',
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        aliceId: z.string().describe('Contract identifier'),
        symbol: z.string().optional().describe('Human-readable symbol. Optional.'),
        qty: z.number().positive().optional().describe('Number of shares to sell (default: sell all)'),
      }),
      execute: ({ source, ...params }) => manager.resolveOne(source).stageClosePosition(params),
    }),

    cancelOrder: tool({
      description: 'Stage an order cancellation (will execute on tradingPush).',
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
      description: 'Execute all committed trading operations (like "git push"). Must call tradingCommit first.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, pushes all committed accounts.')),
      }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          if (!uta.status().pendingMessage) continue
          results.push({ source: uta.id, ...await uta.push() })
        }
        if (results.length === 0) return { message: 'No committed operations to push.' }
        return results.length === 1 ? results[0] : results
      },
    }),

    tradingSync: tool({
      description: 'Sync pending order statuses from broker (like "git pull").',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, syncs all accounts with pending orders.')),
      }),
      execute: async ({ source }) => {
        const targets = manager.resolve(source)
        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          if (uta.getPendingOrderIds().length === 0) continue
          const result = await uta.sync()
          if (result.updatedCount > 0) results.push({ source: uta.id, ...result })
        }
        if (results.length === 0) return { message: 'No pending orders to sync.', updatedCount: 0 }
        return results.length === 1 ? results[0] : results
      },
    }),
  }
}
