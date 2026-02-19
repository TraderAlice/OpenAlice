/**
 * Alpaca Trading Engine
 *
 * Alpaca implementation of ISecuritiesTradingEngine
 * Uses @alpacahq/alpaca-trade-api SDK for US stock trading
 *
 * Alpaca REST API response format reference:
 * - Account: { cash, portfolio_value, equity, buying_power, ... }
 * - Position: { symbol, side, qty, avg_entry_price, current_price, market_value, unrealized_pl, ... }
 * - Order: { id, symbol, side, type, qty, limit_price, stop_price, time_in_force, status, filled_avg_price, filled_qty, ... }
 * - Clock: { is_open, next_open, next_close, timestamp }
 */

import Alpaca from '@alpacahq/alpaca-trade-api';
import type {
  ISecuritiesTradingEngine,
  SecOrderRequest,
  SecOrderResult,
  SecOrder,
  SecHolding,
  SecAccountInfo,
  MarketClock,
} from '../../interfaces.js';

export interface AlpacaTradingEngineConfig {
  apiKey: string;
  secretKey: string;
  paper: boolean;
  allowedSymbols: string[];
}

// Alpaca SDK response shapes (SDK types are all `any`)
interface AlpacaAccountRaw {
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  daytrading_buying_power: string;
}

interface AlpacaPositionRaw {
  symbol: string;
  side: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  cost_basis: string;
}

interface AlpacaOrderRaw {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string | null;
  notional: string | null;
  limit_price: string | null;
  stop_price: string | null;
  time_in_force: string;
  extended_hours: boolean;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string | null;
  filled_at: string | null;
  created_at: string;
  reject_reason: string | null;
}

interface AlpacaClockRaw {
  is_open: boolean;
  next_open: string;
  next_close: string;
  timestamp: string;
}

export class AlpacaTradingEngine implements ISecuritiesTradingEngine {
  private readonly config: AlpacaTradingEngineConfig;
  private client!: InstanceType<typeof Alpaca>;

  constructor(config: AlpacaTradingEngineConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    this.client = new Alpaca({
      keyId: this.config.apiKey,
      secretKey: this.config.secretKey,
      paper: this.config.paper,
    });

    // Verify connection by fetching account
    const account = await this.client.getAccount() as AlpacaAccountRaw;
    console.log(
      `Alpaca: connected (paper=${this.config.paper}, equity=$${parseFloat(account.equity).toFixed(2)}, symbols=${this.config.allowedSymbols.length})`,
    );
  }

  async close(): Promise<void> {
    // Alpaca SDK has no explicit close/disconnect
  }

  async placeOrder(order: SecOrderRequest): Promise<SecOrderResult> {
    try {
      const alpacaOrder: Record<string, unknown> = {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        time_in_force: order.timeInForce,
      };

      if (order.qty != null) {
        alpacaOrder.qty = order.qty;
      } else if (order.notional != null) {
        alpacaOrder.notional = order.notional;
      }

      if (order.price != null) {
        alpacaOrder.limit_price = order.price;
      }
      if (order.stopPrice != null) {
        alpacaOrder.stop_price = order.stopPrice;
      }
      if (order.extendedHours != null) {
        alpacaOrder.extended_hours = order.extendedHours;
      }

      const result = await this.client.createOrder(alpacaOrder) as AlpacaOrderRaw;

      const isFilled = result.status === 'filled';
      return {
        success: true,
        orderId: result.id,
        filledPrice: isFilled && result.filled_avg_price ? parseFloat(result.filled_avg_price) : undefined,
        filledQty: isFilled && result.filled_qty ? parseFloat(result.filled_qty) : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getPortfolio(): Promise<SecHolding[]> {
    const positions = await this.client.getPositions() as AlpacaPositionRaw[];

    return positions
      .filter(p => this.config.allowedSymbols.length === 0 || this.config.allowedSymbols.includes(p.symbol))
      .map(p => ({
        symbol: p.symbol,
        side: p.side === 'long' ? 'long' as const : 'short' as const,
        qty: parseFloat(p.qty),
        avgEntryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        marketValue: parseFloat(p.market_value),
        unrealizedPnL: parseFloat(p.unrealized_pl),
        unrealizedPnLPercent: parseFloat(p.unrealized_plpc) * 100,
        costBasis: parseFloat(p.cost_basis),
      }));
  }

  async getOrders(): Promise<SecOrder[]> {
    const orders = await this.client.getOrders({
      status: 'all',
      limit: 100,
      until: undefined,
      after: undefined,
      direction: undefined,
      nested: undefined,
      symbols: undefined,
    }) as AlpacaOrderRaw[];

    return orders
      .filter(o => this.config.allowedSymbols.length === 0 || this.config.allowedSymbols.includes(o.symbol))
      .map(o => this.mapOrder(o));
  }

  async getAccount(): Promise<SecAccountInfo> {
    const account = await this.client.getAccount() as AlpacaAccountRaw;

    // Calculate unrealized PnL from positions
    const positions = await this.client.getPositions() as AlpacaPositionRaw[];
    const unrealizedPnL = positions.reduce(
      (sum, p) => sum + parseFloat(p.unrealized_pl),
      0,
    );

    return {
      cash: parseFloat(account.cash),
      portfolioValue: parseFloat(account.portfolio_value),
      equity: parseFloat(account.equity),
      buyingPower: parseFloat(account.buying_power),
      unrealizedPnL,
      realizedPnL: 0, // Alpaca account API 不提供此字段，由 wallet commit history 追踪
      dayTradeCount: account.daytrade_count,
      dayTradingBuyingPower: parseFloat(account.daytrading_buying_power),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder(orderId);
      return true;
    } catch {
      return false;
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    const clock = await this.client.getClock() as AlpacaClockRaw;

    return {
      isOpen: clock.is_open,
      nextOpen: new Date(clock.next_open),
      nextClose: new Date(clock.next_close),
      timestamp: new Date(clock.timestamp),
    };
  }

  // ==================== Internal methods ====================

  private mapOrder(o: AlpacaOrderRaw): SecOrder {
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side as 'buy' | 'sell',
      type: o.type as SecOrder['type'],
      qty: parseFloat(o.qty ?? o.notional ?? '0'),
      price: o.limit_price ? parseFloat(o.limit_price) : undefined,
      stopPrice: o.stop_price ? parseFloat(o.stop_price) : undefined,
      timeInForce: o.time_in_force as SecOrder['timeInForce'],
      extendedHours: o.extended_hours,
      status: this.mapOrderStatus(o.status),
      filledPrice: o.filled_avg_price ? parseFloat(o.filled_avg_price) : undefined,
      filledQty: o.filled_qty ? parseFloat(o.filled_qty) : undefined,
      filledAt: o.filled_at ? new Date(o.filled_at) : undefined,
      createdAt: new Date(o.created_at),
      rejectReason: o.reject_reason ?? undefined,
    };
  }

  private mapOrderStatus(alpacaStatus: string): SecOrder['status'] {
    switch (alpacaStatus) {
      case 'filled':
        return 'filled';
      case 'new':
      case 'accepted':
      case 'pending_new':
      case 'accepted_for_bidding':
        return 'pending';
      case 'canceled':
      case 'expired':
      case 'replaced':
        return 'cancelled';
      case 'partially_filled':
        return 'partially_filled';
      case 'done_for_day':
      case 'suspended':
      case 'rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }
}
