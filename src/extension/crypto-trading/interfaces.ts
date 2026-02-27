/**
 * Crypto Trading Engine interface definitions
 *
 * Only defines interfaces and data types; implementation is provided by external trading services
 */

// ==================== Core interfaces ====================

export interface ICryptoTradingEngine {
  placeOrder(order: CryptoPlaceOrderRequest, currentTime?: Date): Promise<CryptoOrderResult>;
  getPositions(): Promise<CryptoPosition[]>;
  getOrders(): Promise<CryptoOrder[]>;
  getAccount(): Promise<CryptoAccountInfo>;
  cancelOrder(orderId: string): Promise<boolean>;
  adjustLeverage(symbol: string, newLeverage: number): Promise<{ success: boolean; error?: string }>;
  getTicker(symbol: string): Promise<CryptoTicker>;
  getFundingRate(symbol: string): Promise<CryptoFundingRate>;
  getOrderBook(symbol: string, limit?: number): Promise<CryptoOrderBook>;
}

// ==================== Orders ====================

export interface CryptoPlaceOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  size?: number;
  usd_size?: number;
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
}

export interface CryptoOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  message?: string;
  filledPrice?: number;
  filledSize?: number;
}

export interface CryptoOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  size: number;
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  filledPrice?: number;
  filledSize?: number;
  filledAt?: Date;
  createdAt: Date;
  rejectReason?: string;
}

// ==================== Positions ====================

export interface CryptoPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  liquidationPrice: number;
  markPrice: number;
  unrealizedPnL: number;
  positionValue: number;
}

// ==================== Account ====================

export interface CryptoAccountInfo {
  balance: number;
  totalMargin: number;
  unrealizedPnL: number;
  equity: number;
  realizedPnL: number;
  totalPnL: number;
}

// ==================== Market data ====================

export interface CryptoTicker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  volume: number;
  timestamp: Date;
}

export interface CryptoFundingRate {
  symbol: string;
  fundingRate: number;
  nextFundingTime?: Date;
  previousFundingRate?: number;
  timestamp: Date;
}

// ==================== Order Book ====================

/** A single price level in the order book: [price, amount] */
export type CryptoOrderBookLevel = [price: number, amount: number];

export interface CryptoOrderBook {
  symbol: string;
  bids: CryptoOrderBookLevel[];
  asks: CryptoOrderBookLevel[];
  timestamp: Date;
}

// ==================== Precision ====================

export interface SymbolPrecision {
  price: number;
  size: number;
}
