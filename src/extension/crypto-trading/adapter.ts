import { tool } from 'ai';
import { z } from 'zod';
import type { ICryptoTradingEngine } from './interfaces';
import type { IWallet } from './wallet/interfaces';
import type { OrderStatusUpdate, WalletState } from './wallet/types';
import { createCryptoWalletToolsImpl } from './wallet/adapter';

/**
 * Create crypto trading AI tools (market interaction + wallet management)
 *
 * Wallet operations (git-like decision tracking):
 * - cryptoWalletCommit, cryptoWalletPush, cryptoWalletLog, cryptoWalletShow, cryptoWalletStatus, cryptoWalletSync, cryptoSimulatePriceChange
 *
 * Trading operations (staged via wallet):
 * - cryptoPlaceOrder, cryptoClosePosition, cryptoCancelOrder, cryptoAdjustLeverage
 *
 * Query operations (direct):
 * - cryptoGetPositions, cryptoGetOrders, cryptoGetAccount
 */
export function createCryptoTradingTools(
  tradingEngine: ICryptoTradingEngine,
  wallet: IWallet,
  getWalletState?: () => Promise<WalletState>,
) {
  return {
    // ==================== Wallet operations ====================
    ...createCryptoWalletToolsImpl(wallet),

    // ==================== Sync ====================

    cryptoWalletSync: tool({
      description: `
Sync pending order statuses from exchange (like "git pull").

Checks all pending orders from previous commits and fetches their latest
status from the exchange. Creates a sync commit recording any changes.

Use this after placing limit orders to check if they've been filled.
Returns the number of orders that changed status.
      `.trim(),
      inputSchema: z.object({}),
      execute: async () => {
        if (!getWalletState) {
          return { message: 'Trading engine not connected. Cannot sync.', updatedCount: 0 };
        }

        const pendingOrders = wallet.getPendingOrderIds();
        if (pendingOrders.length === 0) {
          return { message: 'No pending orders to sync.', updatedCount: 0 };
        }

        const exchangeOrders = await tradingEngine.getOrders();
        const updates: OrderStatusUpdate[] = [];

        for (const { orderId, symbol } of pendingOrders) {
          const exchangeOrder = exchangeOrders.find(o => o.id === orderId);
          if (!exchangeOrder) continue;

          const newStatus = exchangeOrder.status;
          if (newStatus !== 'pending') {
            updates.push({
              orderId,
              symbol,
              previousStatus: 'pending',
              currentStatus: newStatus,
              filledPrice: exchangeOrder.filledPrice,
              filledSize: exchangeOrder.filledSize,
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

    cryptoPlaceOrder: tool({
      description: `
Stage a crypto trading order in wallet (will execute on cryptoWalletPush).

BEFORE placing orders, you SHOULD:
1. Check cryptoWalletLog({ symbol }) to review your history for THIS symbol
2. Check cryptoGetPositions to see current holdings
3. Verify this trade aligns with your stated strategy

Supports two modes:
- size-based: Specify coin amount (e.g. 0.5 BTC)
- usd_size-based: Specify USD value (e.g. 1000 USDT)

For CLOSING positions, use cryptoClosePosition tool instead.

NOTE: This stages the operation. Call cryptoWalletCommit + cryptoWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
        side: z
          .enum(['buy', 'sell'])
          .describe('Buy = open long, Sell = open short'),
        type: z
          .enum(['market', 'limit'])
          .describe(
            'Market order (immediate) or Limit order (at specific price)',
          ),
        size: z
          .number()
          .positive()
          .optional()
          .describe(
            'Order size in coins (e.g. 0.5 BTC). Mutually exclusive with usd_size.',
          ),
        usd_size: z
          .number()
          .positive()
          .optional()
          .describe(
            'Order size in USD (e.g. 1000 USDT). Will auto-calculate coin size. Mutually exclusive with size.',
          ),
        price: z
          .number()
          .positive()
          .optional()
          .describe('Price (required for limit orders)'),
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
      }),
      execute: ({
        symbol,
        side,
        type,
        size,
        usd_size,
        price,
        leverage,
        reduceOnly,
      }) => {
        return wallet.add({
          action: 'placeOrder',
          params: { symbol, side, type, size, usd_size, price, leverage, reduceOnly },
        });
      },
    }),

    cryptoClosePosition: tool({
      description: `
Stage a crypto position close in wallet (will execute on cryptoWalletPush).

This is the preferred way to close positions instead of using cryptoPlaceOrder with reduceOnly.

NOTE: This stages the operation. Call cryptoWalletCommit + cryptoWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
        size: z
          .number()
          .positive()
          .optional()
          .describe('Size to close (default: close entire position)'),
      }),
      execute: ({ symbol, size }) => {
        return wallet.add({
          action: 'closePosition',
          params: { symbol, size },
        });
      },
    }),

    cryptoCancelOrder: tool({
      description: `
Stage an order cancellation in wallet (will execute on cryptoWalletPush).

NOTE: This stages the operation. Call cryptoWalletCommit + cryptoWalletPush to execute.
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

    cryptoAdjustLeverage: tool({
      description: `
Stage a leverage adjustment in wallet (will execute on cryptoWalletPush).

Adjust leverage for an existing position without changing position size.
This will adjust margin requirements.

NOTE: This stages the operation. Call cryptoWalletCommit + cryptoWalletPush to execute.
      `.trim(),
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
        newLeverage: z
          .number()
          .int()
          .min(1)
          .max(20)
          .describe('New leverage (1-20)'),
      }),
      execute: ({ symbol, newLeverage }) => {
        return wallet.add({
          action: 'adjustLeverage',
          params: { symbol, newLeverage },
        });
      },
    }),

    // ==================== Query operations (no staging needed) ====================

    cryptoGetPositions: tool({
      description: `Query current open crypto positions. Can filter by symbol or get all positions.

Each position includes:
- All standard position fields (symbol, side, size, entryPrice, leverage, margin, markPrice, unrealizedPnL, positionValue, etc.)
- percentageOfEquity: This position's value as percentage of TOTAL CAPITAL (use this for risk control, e.g. "max 10% per trade")
- percentageOfTotal: This position's value as percentage of total positions (use this for diversification check)
- pnlRatioToMargin: Unrealized PnL as a percentage of margin

IMPORTANT: If result is an empty array [], it means you currently have NO open positions.
RISK CHECK: Before placing new orders, verify that percentageOfEquity doesn't exceed your per-trade limit.`,
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe(
            'Trading pair symbol to filter (e.g. "BTC/USD"), or "all" for all positions (default: all)',
          ),
      }),
      execute: async ({ symbol }) => {
        const allPositions = await tradingEngine.getPositions();
        const account = await tradingEngine.getAccount();

        const totalPositionValue = allPositions.reduce(
          (sum, p) => sum + p.positionValue,
          0,
        );

        const positionsWithPercentage = allPositions.map((position) => {
          const pnlRatio =
            position.margin > 0
              ? (position.unrealizedPnL / position.margin) * 100
              : 0;
          const percentOfEquity =
            account.equity > 0
              ? (position.positionValue / account.equity) * 100
              : 0;
          const percentOfPositions =
            totalPositionValue > 0
              ? (position.positionValue / totalPositionValue) * 100
              : 0;

          return {
            ...position,
            percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
            percentageOfTotal: `${percentOfPositions.toFixed(1)}%`,
            pnlRatioToMargin: `${pnlRatio >= 0 ? '+' : ''}${pnlRatio.toFixed(1)}%`,
          };
        });

        const filtered = (!symbol || symbol === 'all')
          ? positionsWithPercentage
          : positionsWithPercentage.filter((p) => p.symbol === symbol);

        if (filtered.length === 0) {
          return {
            positions: [],
            message:
              'No open positions. You currently have no active crypto trades.',
          };
        }

        return filtered;
      },
    }),

    cryptoGetOrders: tool({
      description: 'Query crypto order history (filled, pending, cancelled)',
      inputSchema: z.object({}),
      execute: async () => {
        return await tradingEngine.getOrders();
      },
    }),

    cryptoGetAccount: tool({
      description:
        'Query crypto account info (balance, margin, unrealizedPnL, equity, realizedPnL, totalPnL). totalPnL = realizedPnL + unrealizedPnL.',
      inputSchema: z.object({}),
      execute: async () => {
        return await tradingEngine.getAccount();
      },
    }),

    cryptoGetTicker: tool({
      description: `Query the current exchange ticker for a symbol.

Returns real-time price data directly from the exchange:
- last: last traded price
- bid/ask: current best bid and ask
- high/low: 24h high and low
- volume: 24h base volume

This reflects the exchange's own price, not an external data provider.`,
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
      }),
      execute: async ({ symbol }) => {
        return await tradingEngine.getTicker(symbol);
      },
    }),

    cryptoGetOrderBook: tool({
      description: `Query the order book (market depth) for a symbol.

Returns bids (buy orders) and asks (sell orders) sorted by price:
- bids: descending (best/highest bid first)
- asks: ascending (best/lowest ask first)
Each level is [price, amount].

Use this to evaluate liquidity and potential slippage before placing large orders.`,
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
        limit: z.number().int().min(1).max(100).optional()
          .describe('Number of price levels per side (default: 20)'),
      }),
      execute: async ({ symbol, limit }) => {
        return await tradingEngine.getOrderBook(symbol, limit ?? 20);
      },
    }),

    cryptoGetFundingRate: tool({
      description: `Query the current funding rate for a perpetual contract.

Returns:
- fundingRate: current/latest funding rate (e.g. 0.0001 = 0.01%)
- nextFundingTime: when the next funding payment occurs
- previousFundingRate: the previous period's rate

Positive rate = longs pay shorts. Negative rate = shorts pay longs.
Essential for evaluating carry cost on perpetual positions.`,
      inputSchema: z.object({
        symbol: z.string().describe('Trading pair symbol, e.g. BTC/USD'),
      }),
      execute: async ({ symbol }) => {
        return await tradingEngine.getFundingRate(symbol);
      },
    }),
  };
}
