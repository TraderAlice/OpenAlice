import { tool } from 'ai';
import { z } from 'zod';
import type { ISecuritiesTradingEngine } from './interfaces';
import type { ISecWallet } from './wallet/interfaces';
import type { OrderStatusUpdate, WalletState } from './wallet/types';
import { createSecWalletToolsImpl } from './wallet/adapter';

/**
 * Create securities trading AI tools (market interaction + wallet management)
 *
 * Wallet operations (git-like decision tracking):
 * - secWalletCommit, secWalletPush, secWalletLog, secWalletShow, secWalletStatus, secWalletSync, secSimulatePriceChange
 *
 * Trading operations (staged via wallet):
 * - secPlaceOrder, secClosePosition, secCancelOrder
 *
 * Query operations (direct):
 * - secGetPortfolio, secGetOrders, secGetAccount, secGetMarketClock
 */
export function createSecuritiesTradingTools(
  tradingEngine: ISecuritiesTradingEngine,
  wallet: ISecWallet,
  getWalletState?: () => Promise<WalletState>,
) {
  return {
    // ==================== Wallet operations ====================
    ...createSecWalletToolsImpl(wallet),

    // ==================== Sync ====================

    secWalletSync: tool({
      description: `
Sync pending order statuses from broker (like "git pull").

Checks all pending orders from previous commits and fetches their latest
status from the broker. Creates a sync commit recording any changes.

Use this after placing limit/stop orders to check if they've been filled.
      `.trim(),
      inputSchema: z.object({}),
      execute: async () => {
        if (!getWalletState) {
          return { message: 'Securities broker not connected. Cannot sync.', updatedCount: 0 };
        }

        const pendingOrders = wallet.getPendingOrderIds();
        if (pendingOrders.length === 0) {
          return { message: 'No pending orders to sync.', updatedCount: 0 };
        }

        const brokerOrders = await tradingEngine.getOrders();
        const updates: OrderStatusUpdate[] = [];

        for (const { orderId, symbol } of pendingOrders) {
          const brokerOrder = brokerOrders.find(o => o.id === orderId);
          if (!brokerOrder) continue;

          const newStatus = brokerOrder.status;
          if (newStatus !== 'pending') {
            updates.push({
              orderId,
              symbol,
              previousStatus: 'pending',
              currentStatus: newStatus,
              filledPrice: brokerOrder.filledPrice,
              filledQty: brokerOrder.filledQty,
            });
          }
        }

        if (updates.length === 0) {
          return {
            message: `All ${pendingOrders.length} order(s) still pending.`,
            updatedCount: 0,
          };
        }

        const state = await getWalletState();
        return await wallet.sync(updates, state);
      },
    }),

    // ==================== Trading operations (staged to Wallet) ====================

    secPlaceOrder: tool({
      description: `
Stage a securities order in wallet (will execute on secWalletPush).

BEFORE placing orders, you SHOULD:
1. Check secWalletLog({ symbol }) to review your history for THIS symbol
2. Check secGetPortfolio to see current holdings
3. Verify this trade aligns with your stated strategy

Supports two modes:
- qty-based: Specify number of shares (supports fractional, e.g. 0.5)
- notional-based: Specify USD amount (e.g. $1000 of AAPL)

For SELLING holdings, use secClosePosition tool instead.

NOTE: This stages the operation. Call secWalletCommit + secWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "SPY"'),
        side: z.enum(['buy', 'sell']).describe('Buy or sell'),
        type: z
          .enum(['market', 'limit', 'stop', 'stop_limit'])
          .describe('Order type'),
        qty: z
          .number()
          .positive()
          .optional()
          .describe('Number of shares (supports fractional). Mutually exclusive with notional.'),
        notional: z
          .number()
          .positive()
          .optional()
          .describe('Dollar amount to invest (e.g. 1000 = $1000 of the stock). Mutually exclusive with qty.'),
        price: z
          .number()
          .positive()
          .optional()
          .describe('Limit price (required for limit and stop_limit orders)'),
        stopPrice: z
          .number()
          .positive()
          .optional()
          .describe('Stop trigger price (required for stop and stop_limit orders)'),
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
        symbol,
        side,
        type,
        qty,
        notional,
        price,
        stopPrice,
        timeInForce,
        extendedHours,
      }) => {
        return wallet.add({
          action: 'placeOrder',
          params: { symbol, side, type, qty, notional, price, stopPrice, timeInForce, extendedHours },
        });
      },
    }),

    secClosePosition: tool({
      description: `
Stage a securities position close in wallet (will execute on secWalletPush).

This is the preferred way to sell holdings instead of using secPlaceOrder with side="sell".

NOTE: This stages the operation. Call secWalletCommit + secWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        qty: z
          .number()
          .positive()
          .optional()
          .describe('Number of shares to sell (default: sell all)'),
      }),
      execute: ({ symbol, qty }) => {
        return wallet.add({
          action: 'closePosition',
          params: { symbol, qty },
        });
      },
    }),

    secCancelOrder: tool({
      description: `
Stage an order cancellation in wallet (will execute on secWalletPush).

NOTE: This stages the operation. Call secWalletCommit + secWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        orderId: z.string().describe('Order ID to cancel'),
      }),
      execute: ({ orderId }) => {
        return wallet.add({
          action: 'cancelOrder',
          params: { orderId },
        });
      },
    }),

    // ==================== Query operations (no staging needed) ====================

    secGetPortfolio: tool({
      description: `Query current securities portfolio holdings.

Each holding includes:
- symbol, side, qty, avgEntryPrice, currentPrice
- marketValue: Current market value
- unrealizedPnL / unrealizedPnLPercent: Unrealized profit/loss
- costBasis: Total cost basis
- percentageOfEquity: This holding's value as percentage of total equity
- percentageOfPortfolio: This holding's value as percentage of total portfolio

IMPORTANT: If result is an empty array [], you have no holdings.`,
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe('Filter by ticker (e.g. "AAPL"), or omit for all holdings'),
      }),
      execute: async ({ symbol }) => {
        const allHoldings = await tradingEngine.getPortfolio();
        const account = await tradingEngine.getAccount();

        const totalMarketValue = allHoldings.reduce(
          (sum, h) => sum + h.marketValue,
          0,
        );

        const holdingsWithPercentage = allHoldings.map((holding) => {
          const percentOfEquity =
            account.equity > 0
              ? (holding.marketValue / account.equity) * 100
              : 0;
          const percentOfPortfolio =
            totalMarketValue > 0
              ? (holding.marketValue / totalMarketValue) * 100
              : 0;

          return {
            ...holding,
            percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
            percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
          };
        });

        const filtered = (!symbol || symbol === 'all')
          ? holdingsWithPercentage
          : holdingsWithPercentage.filter((h) => h.symbol === symbol);

        if (filtered.length === 0) {
          return {
            holdings: [],
            message: 'No holdings. Your securities portfolio is empty.',
          };
        }

        return filtered;
      },
    }),

    secGetOrders: tool({
      description: 'Query securities order history (filled, pending, cancelled)',
      inputSchema: z.object({}),
      execute: async () => {
        return await tradingEngine.getOrders();
      },
    }),

    secGetAccount: tool({
      description:
        'Query securities account info (cash, portfolioValue, equity, buyingPower, unrealizedPnL, realizedPnL, dayTradeCount).',
      inputSchema: z.object({}),
      execute: async () => {
        return await tradingEngine.getAccount();
      },
    }),

    secGetQuote: tool({
      description: `Query the latest quote/price for a stock symbol.

Returns real-time market data from the broker:
- last: last traded price
- bid/ask: current best bid and ask
- volume: today's trading volume

Use this to check current prices before placing orders.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "SPY"'),
      }),
      execute: async ({ symbol }) => {
        return await tradingEngine.getQuote(symbol);
      },
    }),

    secGetMarketClock: tool({
      description:
        'Get current market clock status (isOpen, nextOpen, nextClose). Use this to check if the market is currently open for trading.',
      inputSchema: z.object({}),
      execute: async () => {
        return await tradingEngine.getMarketClock();
      },
    }),
  };
}
