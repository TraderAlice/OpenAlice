/**
 * Unified Trading Tool Factory — multi-account source routing
 *
 * Creates ONE set of AI tools that route to accounts via `source` parameter.
 * Query tools default to all accounts (aggregated with source tags).
 * Staging mutations (placeOrder, closePosition, cancelOrder) require explicit `source`.
 * Git-flow mutations (tradingCommit, tradingPush, tradingSync) default to all accounts.
 *
 * Replaces the old per-account `createTradingTools(account, git)` pattern
 * and the separate `git/adapter.ts`.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { AccountManager } from './account-manager.js'
import type { ITradingAccount } from './interfaces.js'
import type { ITradingGit } from './git/interfaces.js'
import type { GitState, OrderStatusUpdate } from './git/types.js'

// ==================== Resolver interface ====================

export interface AccountResolver {
  accountManager: AccountManager
  getGit: (accountId: string) => ITradingGit | undefined
  getGitState: (accountId: string) => Promise<GitState> | undefined
}

// ==================== Internal helpers ====================

interface ResolvedAccount {
  account: ITradingAccount
  id: string
}

function resolveAccounts(
  mgr: AccountManager,
  source?: string,
): ResolvedAccount[] {
  const summaries = mgr.listAccounts()
  if (!source) {
    return summaries
      .map((s) => ({ account: mgr.getAccount(s.id)!, id: s.id }))
      .filter((r) => r.account)
  }
  // Try id match first, then provider match
  const byId = mgr.getAccount(source)
  if (byId) return [{ account: byId, id: source }]

  const byProvider = summaries
    .filter((s) => s.provider === source)
    .map((s) => ({ account: mgr.getAccount(s.id)!, id: s.id }))
    .filter((r) => r.account)
  return byProvider
}

function resolveOne(
  mgr: AccountManager,
  source: string,
): ResolvedAccount {
  const results = resolveAccounts(mgr, source)
  if (results.length === 0) {
    throw new Error(`No account found matching source "${source}". Use listAccounts to see available accounts.`)
  }
  if (results.length > 1) {
    throw new Error(
      `Multiple accounts match source "${source}": ${results.map((r) => r.id).join(', ')}. Use account id for exact match.`,
    )
  }
  return results[0]
}

function requireGit(resolver: AccountResolver, accountId: string): ITradingGit {
  const git = resolver.getGit(accountId)
  if (!git) throw new Error(`No git instance for account "${accountId}"`)
  return git
}

const sourceDesc = (required: boolean, extra?: string) => {
  const base = `Account source — matches account id (e.g. "alpaca-paper") or provider (e.g. "alpaca", "ccxt").`
  const req = required
    ? ' Required for this operation.'
    : ' Optional — omit to query all accounts.'
  return base + req + (extra ? ` ${extra}` : '')
}

// ==================== Tool factory ====================

export function createTradingTools(resolver: AccountResolver) {
  const { accountManager } = resolver

  return {
    // ==================== Discovery ====================

    listAccounts: tool({
      description:
        'List all registered trading accounts with their id, provider, label, and capabilities. ' +
        'Use this to discover available `source` values for other tools.',
      inputSchema: z.object({}),
      execute: () => {
        return accountManager.listAccounts()
      },
    }),

    // ==================== Account info (query, aggregatable) ====================

    getAccount: tool({
      description:
        'Query trading account info (cash, portfolioValue, equity, buyingPower, unrealizedPnL, realizedPnL, dayTradeCount).',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return { error: 'No accounts available.' }

        const results = await Promise.all(
          targets.map(async ({ account, id }) => {
            const info = await account.getAccount()
            return { source: id, ...info }
          }),
        )
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Portfolio (query, aggregatable) ====================

    getPortfolio: tool({
      description: `Query current portfolio holdings.

Each holding includes:
- symbol, side, qty, avgEntryPrice, currentPrice
- marketValue: Current market value
- unrealizedPnL / unrealizedPnLPercent: Unrealized profit/loss
- costBasis: Total cost basis
- percentageOfEquity: This holding's value as percentage of total equity
- percentageOfPortfolio: This holding's value as percentage of total portfolio

IMPORTANT: If result is an empty array [], you have no holdings.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        symbol: z
          .string()
          .optional()
          .describe('Filter by ticker (e.g. "AAPL"), or omit for all holdings'),
      }),
      execute: async ({ source, symbol }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return { positions: [], message: 'No accounts available.' }

        const allPositions: Array<Record<string, unknown>> = []

        for (const { account, id } of targets) {
          const positions = await account.getPositions()
          const accountInfo = await account.getAccount()

          const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0)

          for (const pos of positions) {
            if (symbol && symbol !== 'all' && pos.contract.symbol !== symbol) continue

            const percentOfEquity =
              accountInfo.equity > 0 ? (pos.marketValue / accountInfo.equity) * 100 : 0
            const percentOfPortfolio =
              totalMarketValue > 0 ? (pos.marketValue / totalMarketValue) * 100 : 0

            allPositions.push({
              source: id,
              symbol: pos.contract.symbol,
              side: pos.side,
              qty: pos.qty,
              avgEntryPrice: pos.avgEntryPrice,
              currentPrice: pos.currentPrice,
              marketValue: pos.marketValue,
              unrealizedPnL: pos.unrealizedPnL,
              unrealizedPnLPercent: pos.unrealizedPnLPercent,
              costBasis: pos.costBasis,
              leverage: pos.leverage,
              margin: pos.margin,
              liquidationPrice: pos.liquidationPrice,
              percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
              percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
            })
          }
        }

        if (allPositions.length === 0) {
          return { positions: [], message: 'No open positions.' }
        }
        return allPositions
      },
    }),

    // ==================== Orders (query, aggregatable) ====================

    getOrders: tool({
      description: 'Query order history (filled, pending, cancelled)',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return []

        const results = await Promise.all(
          targets.map(async ({ account, id }) => {
            const orders = await account.getOrders()
            return orders.map((o) => ({ source: id, ...o }))
          }),
        )
        return results.flat()
      },
    }),

    // ==================== Quote (query, optional source) ====================

    getQuote: tool({
      description: `Query the latest quote/price for a stock symbol.

Returns real-time market data from the broker:
- last: last traded price
- bid/ask: current best bid and ask
- volume: today's trading volume

Use this to check current prices before placing orders.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "SPY"'),
        source: z
          .string()
          .optional()
          .describe(sourceDesc(false, 'If omitted, uses the first available account.')),
      }),
      execute: async ({ symbol, source }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return { error: 'No accounts available.' }

        // Use first available account
        const { account, id } = targets[0]
        const quote = await account.getQuote({ symbol })
        return { source: id, ...quote }
      },
    }),

    // ==================== Market Clock (query, optional source) ====================

    getMarketClock: tool({
      description:
        'Get current market clock status (isOpen, nextOpen, nextClose). Use this to check if the market is currently open for trading.',
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: async ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        for (const { account, id } of targets) {
          if (account.getMarketClock) {
            const clock = await account.getMarketClock()
            return { source: id, ...clock }
          }
        }
        return { error: 'No account supports market clock.' }
      },
    }),

    // ==================== Trading Log (query, aggregatable) ====================

    tradingLog: tool({
      description: `View your trading decision history (like "git log --stat").

IMPORTANT: Check this BEFORE making new trading decisions to:
- Review what you planned in recent commits
- Avoid contradicting your own strategy
- Maintain consistency across rounds

Returns recent trading commits in reverse chronological order (newest first).
Each commit includes:
- hash: Unique commit identifier
- message: Your explanation for the trades
- operations: Summary of each operation (symbol, action, change, status)
- timestamp: When the commit was made

Use symbol parameter to filter commits for a specific ticker.
Use tradingShow(hash) for full details of a specific commit.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of recent commits to return (default: 10)'),
        symbol: z
          .string()
          .optional()
          .describe(
            'Filter commits by symbol (e.g., "AAPL"). Only shows commits that affected this symbol.',
          ),
      }),
      execute: ({ source, limit, symbol }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return []

        const allEntries: Array<Record<string, unknown>> = []
        for (const { id } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          const entries = git.log({ limit, symbol })
          for (const entry of entries) {
            allEntries.push({ source: id, ...entry })
          }
        }

        // Sort by timestamp descending
        allEntries.sort((a, b) => {
          const ta = new Date(a.timestamp as string).getTime()
          const tb = new Date(b.timestamp as string).getTime()
          return tb - ta
        })

        return limit ? allEntries.slice(0, limit) : allEntries
      },
    }),

    // ==================== Trading Show (query, auto-match by hash) ====================

    tradingShow: tool({
      description: `View details of a specific trading commit (like "git show <hash>").

Returns full commit information including:
- All operations that were executed
- Results of each operation (filled price, qty, errors)
- Account state after the commit (holdings, cash)

Use this to inspect what happened in a specific trading commit.`,
      inputSchema: z.object({
        hash: z.string().describe('Commit hash to inspect (8 characters)'),
      }),
      execute: ({ hash }) => {
        // Search all gits for the hash
        const summaries = accountManager.listAccounts()
        for (const s of summaries) {
          const git = resolver.getGit(s.id)
          if (!git) continue
          const commit = git.show(hash)
          if (commit) return { source: s.id, ...commit }
        }
        return { error: `Commit ${hash} not found in any account` }
      },
    }),

    // ==================== Trading Status (query, aggregatable) ====================

    tradingStatus: tool({
      description: `View current trading staging area status (like "git status").

Returns:
- staged: List of operations waiting to be committed/pushed
- pendingMessage: Commit message if already committed but not pushed
- head: Hash of the latest commit
- commitCount: Total number of commits in history

Use this to check if you have pending operations before making more trades.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
      }),
      execute: ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return []

        const results: Array<Record<string, unknown>> = []
        for (const { id } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          results.push({ source: id, ...git.status() })
        }
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Simulate Price Change (query, aggregatable) ====================

    simulatePriceChange: tool({
      description: `Simulate price changes to see portfolio impact BEFORE making decisions (dry run).

Use this tool to:
- See how much you would lose if a stock drops
- Understand the impact of market movements on your portfolio
- Make informed decisions about position sizing

Price change syntax:
- Absolute: "@150" means price becomes $150
- Relative: "+10%" means price increases by 10%, "-5%" means price decreases by 5%

You can simulate changes for:
- A specific symbol: { symbol: "AAPL", change: "@150" }
- All holdings: { symbol: "all", change: "-10%" }

IMPORTANT: This is READ-ONLY - it does NOT modify your actual holdings.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false)),
        priceChanges: z
          .array(
            z.object({
              symbol: z
                .string()
                .describe('Ticker (e.g., "AAPL") or "all" for all holdings'),
              change: z
                .string()
                .describe(
                  'Price change: "@150" for absolute, "+10%" or "-5%" for relative',
                ),
            }),
          )
          .describe('Array of price changes to simulate'),
      }),
      execute: async ({ source, priceChanges }) => {
        const targets = resolveAccounts(accountManager, source)
        if (targets.length === 0) return { error: 'No accounts available.' }

        const results: Array<Record<string, unknown>> = []
        for (const { id } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          const result = await git.simulatePriceChange(priceChanges)
          results.push({ source: id, ...result })
        }
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Place Order (mutation, source required) ====================

    placeOrder: tool({
      description: `Stage an order (will execute on tradingPush).

BEFORE placing orders, you SHOULD:
1. Check tradingLog({ source }) to review your history for THIS source
2. Check getPortfolio to see current holdings
3. Verify this trade aligns with your stated strategy

Supports two modes:
- qty-based: Specify number of shares (supports fractional, e.g. 0.5)
- notional-based: Specify USD amount (e.g. $1000 of AAPL)

For SELLING holdings, use closePosition tool instead.

NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "SPY"'),
        side: z.enum(['buy', 'sell']).describe('Buy or sell'),
        type: z
          .enum(['market', 'limit', 'stop', 'stop_limit'])
          .describe('Order type'),
        qty: z
          .number()
          .positive()
          .optional()
          .describe(
            'Number of shares (supports fractional). Mutually exclusive with notional.',
          ),
        notional: z
          .number()
          .positive()
          .optional()
          .describe(
            'Dollar amount to invest (e.g. 1000 = $1000 of the stock). Mutually exclusive with qty.',
          ),
        price: z
          .number()
          .positive()
          .optional()
          .describe('Limit price (required for limit and stop_limit orders)'),
        stopPrice: z
          .number()
          .positive()
          .optional()
          .describe(
            'Stop trigger price (required for stop and stop_limit orders)',
          ),
        leverage: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Leverage (1-20, default 1)'),
        reduceOnly: z
          .boolean()
          .optional()
          .describe('Only reduce position (close only)'),
        timeInForce: z
          .enum(['day', 'gtc', 'ioc', 'fok'])
          .default('day')
          .describe('Time in force (default: day)'),
        extendedHours: z
          .boolean()
          .optional()
          .describe('Allow pre-market and after-hours trading'),
      }),
      execute: ({
        source,
        symbol,
        side,
        type,
        qty,
        notional,
        price,
        stopPrice,
        leverage,
        reduceOnly,
        timeInForce,
        extendedHours,
      }) => {
        const { id } = resolveOne(accountManager, source)
        const git = requireGit(resolver, id)
        return git.add({
          action: 'placeOrder',
          params: {
            symbol,
            side,
            type,
            qty,
            notional,
            price,
            stopPrice,
            leverage,
            reduceOnly,
            timeInForce,
            extendedHours,
          },
        })
      },
    }),

    // ==================== Close Position (mutation, source required) ====================

    closePosition: tool({
      description: `Stage a position close (will execute on tradingPush).

This is the preferred way to sell holdings instead of using placeOrder with side="sell".

NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        qty: z
          .number()
          .positive()
          .optional()
          .describe('Number of shares to sell (default: sell all)'),
      }),
      execute: ({ source, symbol, qty }) => {
        const { id } = resolveOne(accountManager, source)
        const git = requireGit(resolver, id)
        return git.add({
          action: 'closePosition',
          params: { symbol, qty },
        })
      },
    }),

    // ==================== Cancel Order (mutation, source required) ====================

    cancelOrder: tool({
      description: `Stage an order cancellation (will execute on tradingPush).

NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        orderId: z.string().describe('Order ID to cancel'),
      }),
      execute: ({ source, orderId }) => {
        const { id } = resolveOne(accountManager, source)
        const git = requireGit(resolver, id)
        return git.add({
          action: 'cancelOrder',
          params: { orderId },
        })
      },
    }),

    // ==================== Trading Commit (source optional — commits all if omitted) ====================

    tradingCommit: tool({
      description: `Commit staged trading operations with a message (like "git commit -m").

After staging operations with placeOrder/closePosition/etc., use this to:
1. Add a commit message explaining WHY you're making these trades
2. Prepare the operations for execution

This does NOT execute the trades yet - call tradingPush after this.

If source is omitted, commits ALL accounts that have staged operations.

Example workflow:
1. placeOrder({ source: "alpaca", symbol: "AAPL", side: "buy", ... }) -> staged
2. tradingCommit({ message: "Buying AAPL on strong earnings beat" })
3. tradingPush() -> executes and records`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, commits all accounts with staged operations.')),
        message: z
          .string()
          .describe('Commit message explaining your trading decision'),
      }),
      execute: ({ source, message }) => {
        const targets = resolveAccounts(accountManager, source)
        const results: Array<Record<string, unknown>> = []

        for (const { id } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          const status = git.status()
          if (status.staged.length === 0) continue
          results.push({ source: id, ...git.commit(message) })
        }

        if (results.length === 0) return { message: 'No staged operations to commit.' }
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Trading Push (source optional — pushes all if omitted) ====================

    tradingPush: tool({
      description: `Execute all committed trading operations (like "git push").

After staging operations and committing them, use this to:
1. Execute all staged operations against the broker
2. Record the commit with results to trading history

Returns execution results for each operation (filled/pending/rejected).

If source is omitted, pushes ALL accounts that have committed operations.

IMPORTANT: You must call tradingCommit first before pushing.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, pushes all accounts with committed operations.')),
      }),
      execute: async ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        const results: Array<Record<string, unknown>> = []

        for (const { id } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          const status = git.status()
          if (!status.pendingMessage) continue
          const result = await git.push()
          results.push({ source: id, ...result })
        }

        if (results.length === 0) return { message: 'No committed operations to push.' }
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Trading Sync (source optional — syncs all if omitted) ====================

    tradingSync: tool({
      description: `Sync pending order statuses from broker (like "git pull").

Checks all pending orders from previous commits and fetches their latest
status from the broker. Creates a sync commit recording any changes.

If source is omitted, syncs ALL accounts that have pending orders.

Use this after placing limit/stop orders to check if they've been filled.`,
      inputSchema: z.object({
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, syncs all accounts with pending orders.')),
      }),
      execute: async ({ source }) => {
        const targets = resolveAccounts(accountManager, source)
        const results: Array<Record<string, unknown>> = []

        for (const { id, account } of targets) {
          const git = resolver.getGit(id)
          if (!git) continue
          const gitState = resolver.getGitState(id)
          if (!gitState) continue

          const pendingOrders = git.getPendingOrderIds()
          if (pendingOrders.length === 0) continue

          const brokerOrders = await account.getOrders()
          const updates: OrderStatusUpdate[] = []

          for (const { orderId, symbol } of pendingOrders) {
            const brokerOrder = brokerOrders.find((o) => o.id === orderId)
            if (!brokerOrder) continue

            const newStatus = brokerOrder.status
            if (newStatus !== 'pending') {
              updates.push({
                orderId,
                symbol,
                previousStatus: 'pending',
                currentStatus: newStatus,
                filledPrice: brokerOrder.filledPrice,
                filledQty: brokerOrder.filledQty,
              })
            }
          }

          if (updates.length === 0) continue

          const state = await gitState
          const result = await git.sync(updates, state)
          results.push({ source: id, ...result })
        }

        if (results.length === 0) return { message: 'No pending orders to sync.', updatedCount: 0 }
        return results.length === 1 ? results[0] : results
      },
    }),

    // ==================== Adjust Leverage (mutation, source required) ====================

    adjustLeverage: tool({
      description: `Stage a leverage adjustment (will execute on tradingPush).

Adjust leverage for an existing position without changing position size.
This will adjust margin requirements.

NOTE: This stages the operation. Call tradingCommit + tradingPush to execute.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().describe('Trading pair symbol'),
        newLeverage: z
          .number()
          .int()
          .min(1)
          .max(20)
          .describe('New leverage (1-20)'),
      }),
      execute: ({ source, symbol, newLeverage }) => {
        const { id, account } = resolveOne(accountManager, source)
        if (!account.getCapabilities().supportsLeverage) {
          return { error: `Account "${id}" does not support leverage adjustment.` }
        }
        const git = requireGit(resolver, id)
        return git.add({
          action: 'adjustLeverage',
          params: { symbol, newLeverage },
        })
      },
    }),

    // ==================== Funding Rate (query, source required) ====================

    getFundingRate: tool({
      description: `Query the current funding rate for a perpetual contract.

Returns:
- fundingRate: current/latest funding rate (e.g. 0.0001 = 0.01%)
- nextFundingTime: when the next funding payment occurs
- previousFundingRate: the previous period's rate

Positive rate = longs pay shorts. Negative rate = shorts pay longs.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().describe('Trading pair symbol'),
      }),
      execute: async ({ source, symbol }) => {
        const { id, account } = resolveOne(accountManager, source)
        if (!account.getFundingRate) {
          return { error: `Account "${id}" does not support funding rates.` }
        }
        return await account.getFundingRate({ symbol })
      },
    }),

    // ==================== Order Book (query, source required) ====================

    getOrderBook: tool({
      description: `Query the order book (market depth) for a symbol.

Returns bids and asks sorted by price. Each level is [price, amount].
Use this to evaluate liquidity and potential slippage before placing large orders.`,
      inputSchema: z.object({
        source: z.string().describe(sourceDesc(true)),
        symbol: z.string().describe('Trading pair symbol'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Number of price levels per side (default: 20)'),
      }),
      execute: async ({ source, symbol, limit }) => {
        const { id, account } = resolveOne(accountManager, source)
        if (!account.getOrderBook) {
          return { error: `Account "${id}" does not support order book queries.` }
        }
        return await account.getOrderBook({ symbol }, limit ?? 20)
      },
    }),
  }
}
