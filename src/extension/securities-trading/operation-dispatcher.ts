/**
 * Securities Operation Dispatcher
 *
 * Provider-agnostic bridge: Wallet Operation -> ISecuritiesTradingEngine method dispatch
 */

import type { ISecuritiesTradingEngine, SecOrderRequest } from './interfaces.js';
import type { Operation } from './wallet/types.js';

export function createSecOperationDispatcher(engine: ISecuritiesTradingEngine) {
  return async (op: Operation): Promise<unknown> => {
    switch (op.action) {
      case 'placeOrder': {
        const req: SecOrderRequest = {
          symbol: op.params.symbol as string,
          side: op.params.side as 'buy' | 'sell',
          type: op.params.type as SecOrderRequest['type'],
          qty: op.params.qty as number | undefined,
          notional: op.params.notional as number | undefined,
          price: op.params.price as number | undefined,
          stopPrice: op.params.stopPrice as number | undefined,
          timeInForce: (op.params.timeInForce as SecOrderRequest['timeInForce']) ?? 'day',
          extendedHours: op.params.extendedHours as boolean | undefined,
        };

        const result = await engine.placeOrder(req);

        return {
          success: result.success,
          error: result.error,
          order: result.success
            ? {
                id: result.orderId,
                status: result.filledPrice ? 'filled' : 'pending',
                filledPrice: result.filledPrice,
                filledQty: result.filledQty,
              }
            : undefined,
        };
      }

      case 'closePosition': {
        const symbol = op.params.symbol as string;
        const qty = op.params.qty as number | undefined;

        let result;

        if (engine.closePosition) {
          // Native close (e.g. Alpaca closePosition API)
          result = await engine.closePosition(symbol, qty);
        } else {
          // Fallback: reverse market order
          const portfolio = await engine.getPortfolio();
          const holding = portfolio.find(h => h.symbol === symbol);

          if (!holding) {
            return { success: false, error: `No holding for ${symbol}` };
          }

          result = await engine.placeOrder({
            symbol,
            side: holding.side === 'long' ? 'sell' : 'buy',
            type: 'market',
            qty: qty ?? holding.qty,
            timeInForce: 'day',
          });
        }

        return {
          success: result.success,
          error: result.error,
          order: result.success
            ? {
                id: result.orderId,
                status: result.filledPrice ? 'filled' : 'pending',
                filledPrice: result.filledPrice,
                filledQty: result.filledQty,
              }
            : undefined,
        };
      }

      case 'cancelOrder': {
        const orderId = op.params.orderId as string;
        const success = await engine.cancelOrder(orderId);
        return { success, error: success ? undefined : 'Failed to cancel order' };
      }

      default:
        throw new Error(`Unknown operation action: ${op.action}`);
    }
  };
}
