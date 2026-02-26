import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSecOperationDispatcher } from './operation-dispatcher.js';
import type { ISecuritiesTradingEngine, SecHolding } from './interfaces.js';
import type { Operation } from './wallet/types.js';

// ==================== Mock Factory ====================

function createMockEngine(overrides: Partial<ISecuritiesTradingEngine> = {}): ISecuritiesTradingEngine {
  return {
    placeOrder: vi.fn().mockResolvedValue({
      success: true,
      orderId: 'sec-001',
      filledPrice: 150.25,
      filledQty: 10,
    }),
    getPortfolio: vi.fn().mockResolvedValue([]),
    getOrders: vi.fn().mockResolvedValue([]),
    getAccount: vi.fn().mockResolvedValue({
      cash: 50000, portfolioValue: 0, equity: 50000,
      buyingPower: 100000, unrealizedPnL: 0, realizedPnL: 0,
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getMarketClock: vi.fn().mockResolvedValue({
      isOpen: true, nextOpen: new Date(), nextClose: new Date(), timestamp: new Date(),
    }),
    getQuote: vi.fn().mockResolvedValue({
      symbol: 'AAPL', last: 150, bid: 149.99, ask: 150.01,
      volume: 5000000, timestamp: new Date(),
    }),
    // closePosition intentionally omitted (optional)
    ...overrides,
  };
}

function makeLongHolding(overrides: Partial<SecHolding> = {}): SecHolding {
  return {
    symbol: 'AAPL', side: 'long', qty: 100,
    avgEntryPrice: 140, currentPrice: 150, marketValue: 15000,
    unrealizedPnL: 1000, unrealizedPnLPercent: 7.14, costBasis: 14000,
    ...overrides,
  };
}

function makeShortHolding(overrides: Partial<SecHolding> = {}): SecHolding {
  return {
    symbol: 'TSLA', side: 'short', qty: 20,
    avgEntryPrice: 250, currentPrice: 240, marketValue: 4800,
    unrealizedPnL: 200, unrealizedPnLPercent: 4, costBasis: 5000,
    ...overrides,
  };
}

// ==================== Tests ====================

describe('createSecOperationDispatcher', () => {
  let engine: ISecuritiesTradingEngine;
  let dispatch: (op: Operation) => Promise<unknown>;

  beforeEach(() => {
    engine = createMockEngine();
    dispatch = createSecOperationDispatcher(engine);
  });

  // ==================== placeOrder ====================

  describe('placeOrder', () => {
    it('maps Operation params to SecOrderRequest', async () => {
      const op: Operation = {
        action: 'placeOrder',
        params: {
          symbol: 'AAPL', side: 'buy', type: 'limit',
          qty: 10, price: 145, timeInForce: 'gtc', extendedHours: true,
        },
      };

      await dispatch(op);

      expect(engine.placeOrder).toHaveBeenCalledWith({
        symbol: 'AAPL', side: 'buy', type: 'limit',
        qty: 10, notional: undefined, price: 145,
        stopPrice: undefined, timeInForce: 'gtc', extendedHours: true,
      });
    });

    it('defaults timeInForce to "day" when not specified', async () => {
      await dispatch({
        action: 'placeOrder',
        params: { symbol: 'AAPL', side: 'buy', type: 'market', qty: 5 },
      });

      expect(engine.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ timeInForce: 'day' }),
      );
    });

    it('passes notional for dollar-amount orders', async () => {
      await dispatch({
        action: 'placeOrder',
        params: { symbol: 'SPY', side: 'buy', type: 'market', notional: 1000 },
      });

      expect(engine.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ qty: undefined, notional: 1000 }),
      );
    });

    it('wraps successful filled result', async () => {
      const result = await dispatch({
        action: 'placeOrder',
        params: { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 },
      });

      expect(result).toEqual({
        success: true,
        error: undefined,
        order: {
          id: 'sec-001',
          status: 'filled',
          filledPrice: 150.25,
          filledQty: 10,
        },
      });
    });

    it('wraps successful pending result', async () => {
      engine = createMockEngine({
        placeOrder: vi.fn().mockResolvedValue({
          success: true, orderId: 'sec-002',
          filledPrice: undefined, filledQty: undefined,
        }),
      });
      dispatch = createSecOperationDispatcher(engine);

      const result = await dispatch({
        action: 'placeOrder',
        params: { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 10, price: 140 },
      });

      expect(result).toEqual({
        success: true,
        error: undefined,
        order: { id: 'sec-002', status: 'pending', filledPrice: undefined, filledQty: undefined },
      });
    });

    it('wraps failed result', async () => {
      engine = createMockEngine({
        placeOrder: vi.fn().mockResolvedValue({
          success: false, error: 'Insufficient buying power',
        }),
      });
      dispatch = createSecOperationDispatcher(engine);

      const result = await dispatch({
        action: 'placeOrder',
        params: { symbol: 'AAPL', side: 'buy', type: 'market', qty: 99999 },
      });

      expect(result).toEqual({
        success: false,
        error: 'Insufficient buying power',
        order: undefined,
      });
    });
  });

  // ==================== closePosition - native path ====================

  describe('closePosition - native path', () => {
    it('calls engine.closePosition when it exists', async () => {
      const closePosition = vi.fn().mockResolvedValue({
        success: true, orderId: 'close-001', filledPrice: 151, filledQty: 100,
      });
      engine = createMockEngine({ closePosition });
      dispatch = createSecOperationDispatcher(engine);

      await dispatch({ action: 'closePosition', params: { symbol: 'AAPL' } });

      expect(closePosition).toHaveBeenCalledWith('AAPL', undefined);
      expect(engine.getPortfolio).not.toHaveBeenCalled();
    });

    it('passes qty to native closePosition', async () => {
      const closePosition = vi.fn().mockResolvedValue({
        success: true, orderId: 'close-002', filledPrice: 151, filledQty: 30,
      });
      engine = createMockEngine({ closePosition });
      dispatch = createSecOperationDispatcher(engine);

      await dispatch({ action: 'closePosition', params: { symbol: 'AAPL', qty: 30 } });

      expect(closePosition).toHaveBeenCalledWith('AAPL', 30);
    });

    it('wraps native result in standard format', async () => {
      const closePosition = vi.fn().mockResolvedValue({
        success: true, orderId: 'close-001', filledPrice: 151, filledQty: 100,
      });
      engine = createMockEngine({ closePosition });
      dispatch = createSecOperationDispatcher(engine);

      const result = await dispatch({ action: 'closePosition', params: { symbol: 'AAPL' } });

      expect(result).toEqual({
        success: true,
        error: undefined,
        order: { id: 'close-001', status: 'filled', filledPrice: 151, filledQty: 100 },
      });
    });
  });

  // ==================== closePosition - fallback path ====================

  describe('closePosition - fallback path', () => {
    it('places sell order for long holding', async () => {
      engine = createMockEngine({
        getPortfolio: vi.fn().mockResolvedValue([makeLongHolding()]),
      });
      dispatch = createSecOperationDispatcher(engine);

      await dispatch({ action: 'closePosition', params: { symbol: 'AAPL' } });

      expect(engine.placeOrder).toHaveBeenCalledWith({
        symbol: 'AAPL', side: 'sell', type: 'market', qty: 100, timeInForce: 'day',
      });
    });

    it('places buy order for short holding', async () => {
      engine = createMockEngine({
        getPortfolio: vi.fn().mockResolvedValue([makeShortHolding()]),
      });
      dispatch = createSecOperationDispatcher(engine);

      await dispatch({ action: 'closePosition', params: { symbol: 'TSLA' } });

      expect(engine.placeOrder).toHaveBeenCalledWith({
        symbol: 'TSLA', side: 'buy', type: 'market', qty: 20, timeInForce: 'day',
      });
    });

    it('uses specified partial qty', async () => {
      engine = createMockEngine({
        getPortfolio: vi.fn().mockResolvedValue([makeLongHolding()]),
      });
      dispatch = createSecOperationDispatcher(engine);

      await dispatch({ action: 'closePosition', params: { symbol: 'AAPL', qty: 25 } });

      expect(engine.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 25 }),
      );
    });

    it('returns error when no holding exists', async () => {
      const result = await dispatch({
        action: 'closePosition', params: { symbol: 'AAPL' },
      });

      expect(result).toEqual({ success: false, error: 'No holding for AAPL' });
      expect(engine.placeOrder).not.toHaveBeenCalled();
    });
  });

  // ==================== cancelOrder ====================

  describe('cancelOrder', () => {
    it('returns success when cancellation succeeds', async () => {
      const result = await dispatch({
        action: 'cancelOrder', params: { orderId: 'sec-001' },
      });

      expect(engine.cancelOrder).toHaveBeenCalledWith('sec-001');
      expect(result).toEqual({ success: true, error: undefined });
    });

    it('returns error when cancellation fails', async () => {
      engine = createMockEngine({
        cancelOrder: vi.fn().mockResolvedValue(false),
      });
      dispatch = createSecOperationDispatcher(engine);

      const result = await dispatch({
        action: 'cancelOrder', params: { orderId: 'sec-999' },
      });

      expect(result).toEqual({ success: false, error: 'Failed to cancel order' });
    });
  });

  // ==================== unknown action ====================

  describe('unknown action', () => {
    it('throws for unknown action', async () => {
      await expect(
        dispatch({ action: 'adjustLeverage' as never, params: {} }),
      ).rejects.toThrow('Unknown operation action: adjustLeverage');
    });
  });
});
