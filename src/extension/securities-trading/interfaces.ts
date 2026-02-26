/**
 * Securities Trading Engine interface definitions
 *
 * Traditional securities (US stocks, etc.) trading interfaces, fully independent from Crypto
 * Semantic differences: no leverage/margin/liquidation price, uses portfolio instead of position
 */

// ==================== Asset whitelist ====================

export let SEC_ALLOWED_SYMBOLS: readonly string[] = [];

export function initSecAllowedSymbols(symbols: string[]): void {
  SEC_ALLOWED_SYMBOLS = Object.freeze([...symbols]);
}

// ==================== Core interfaces ====================

export interface ISecuritiesTradingEngine {
  placeOrder(order: SecOrderRequest): Promise<SecOrderResult>;
  getPortfolio(): Promise<SecHolding[]>;
  getOrders(): Promise<SecOrder[]>;
  getAccount(): Promise<SecAccountInfo>;
  cancelOrder(orderId: string): Promise<boolean>;
  getMarketClock(): Promise<MarketClock>;
  getQuote(symbol: string): Promise<SecQuote>;
  /** Native close position. If not implemented, dispatcher falls back to reverse market order. */
  closePosition?(symbol: string, qty?: number): Promise<SecOrderResult>;
}

// ==================== Orders ====================

export interface SecOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  qty?: number;
  notional?: number;
  price?: number;
  stopPrice?: number;
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  extendedHours?: boolean;
}

export interface SecOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  message?: string;
  filledPrice?: number;
  filledQty?: number;
}

export interface SecOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  qty: number;
  price?: number;
  stopPrice?: number;
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  extendedHours?: boolean;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected' | 'partially_filled';
  filledPrice?: number;
  filledQty?: number;
  filledAt?: Date;
  createdAt: Date;
  rejectReason?: string;
}

// ==================== Portfolio ====================

export interface SecHolding {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  costBasis: number;
}

// ==================== Account ====================

export interface SecAccountInfo {
  cash: number;
  portfolioValue: number;
  equity: number;
  buyingPower: number;
  unrealizedPnL: number;
  realizedPnL: number;
  dayTradeCount?: number;
  dayTradingBuyingPower?: number;
}

// ==================== Quote ====================

export interface SecQuote {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: Date;
}

// ==================== Market clock ====================

export interface MarketClock {
  isOpen: boolean;
  nextOpen: Date;
  nextClose: Date;
  timestamp: Date;
}
