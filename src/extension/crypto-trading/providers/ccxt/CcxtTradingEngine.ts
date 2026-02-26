/**
 * CCXT Trading Engine
 *
 * CCXT implementation of ICryptoTradingEngine, connecting to 100+ exchanges via ccxt unified API
 * No polling/waiting; placeOrder returns the exchange's immediate response directly
 */

import ccxt from 'ccxt';
import type { Exchange, Order as CcxtOrder } from 'ccxt';
import type {
  ICryptoTradingEngine,
  CryptoPlaceOrderRequest,
  CryptoOrderResult,
  CryptoPosition,
  CryptoOrder,
  CryptoAccountInfo,
  CryptoTicker,
  CryptoFundingRate,
} from '../../interfaces.js';
import { SymbolMapper } from './symbol-map.js';

export interface CcxtEngineConfig {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  password?: string;
  sandbox: boolean;
  demoTrading?: boolean;
  defaultMarketType: 'spot' | 'swap';
  allowedSymbols: string[];
  options?: Record<string, unknown>;
}

export class CcxtTradingEngine implements ICryptoTradingEngine {
  private exchange: Exchange;
  private symbolMapper: SymbolMapper;
  private initialized = false;

  // Maintain orderId -> ccxtSymbol mapping for cancelOrder
  private orderSymbolCache = new Map<string, string>();

  constructor(private config: CcxtEngineConfig) {
    const exchanges = ccxt as unknown as Record<string, new (opts: Record<string, unknown>) => Exchange>;
    const ExchangeClass = exchanges[config.exchange];
    if (!ExchangeClass) {
      throw new Error(`Unknown CCXT exchange: ${config.exchange}`);
    }

    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      password: config.password,
      ...config.options,
    });

    if (config.sandbox) {
      this.exchange.setSandboxMode(true);
    }

    if (config.demoTrading) {
      (this.exchange as unknown as { enableDemoTrading: (enable: boolean) => void }).enableDemoTrading(true);
    }

    this.symbolMapper = new SymbolMapper(
      config.allowedSymbols,
      config.defaultMarketType,
    );
  }

  async init(): Promise<void> {
    await this.exchange.loadMarkets();
    this.symbolMapper.init(this.exchange.markets as unknown as Record<string, {
      symbol: string;
      base: string;
      quote: string;
      type: string;
      settle?: string;
      active?: boolean;
      precision?: { price?: number; amount?: number };
    }>);
    this.initialized = true;
  }

  // ==================== ICryptoTradingEngine ====================

  async placeOrder(order: CryptoPlaceOrderRequest, _currentTime?: Date): Promise<CryptoOrderResult> {
    this.ensureInit();

    const ccxtSymbol = this.symbolMapper.toCcxt(order.symbol);
    let size = order.size;

    // usd_size -> coin size conversion
    if (!size && order.usd_size) {
      const ticker = await this.exchange.fetchTicker(ccxtSymbol);
      const price = order.price ?? ticker.last;
      if (!price) {
        return { success: false, error: 'Cannot determine price for USD size conversion' };
      }
      size = order.usd_size / price;
    }

    if (!size) {
      return { success: false, error: 'Either size or usd_size must be provided' };
    }

    try {
      // Futures: set leverage first
      if (order.leverage && order.leverage > 1) {
        try {
          await this.exchange.setLeverage(order.leverage, ccxtSymbol);
        } catch {
          // Some exchanges don't support setLeverage or leverage is already set; ignore
        }
      }

      const params: Record<string, unknown> = {};
      if (order.reduceOnly) params.reduceOnly = true;

      const ccxtOrder = await this.exchange.createOrder(
        ccxtSymbol,
        order.type,
        order.side,
        size,
        order.type === 'limit' ? order.price : undefined,
        params,
      );

      // Cache orderId -> symbol mapping
      if (ccxtOrder.id) {
        this.orderSymbolCache.set(ccxtOrder.id, ccxtSymbol);
      }

      const status = this.mapOrderStatus(ccxtOrder.status);

      return {
        success: true,
        orderId: ccxtOrder.id,
        message: `Order ${ccxtOrder.id} ${status}`,
        filledPrice: status === 'filled' ? (ccxtOrder.average ?? ccxtOrder.price ?? undefined) : undefined,
        filledSize: status === 'filled' ? (ccxtOrder.filled ?? undefined) : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getPositions(): Promise<CryptoPosition[]> {
    this.ensureInit();

    const raw = await this.exchange.fetchPositions();
    const result: CryptoPosition[] = [];

    for (const p of raw) {
      const internalSymbol = this.symbolMapper.tryToInternal(p.symbol);
      if (!internalSymbol) continue;

      const size = Math.abs(parseFloat(String(p.contracts ?? 0)) * parseFloat(String(p.contractSize ?? 1)));
      if (size === 0) continue;

      result.push({
        symbol: internalSymbol,
        side: p.side === 'long' ? 'long' : 'short',
        size,
        entryPrice: parseFloat(String(p.entryPrice ?? 0)),
        leverage: parseFloat(String(p.leverage ?? 1)),
        margin: parseFloat(String(p.initialMargin ?? p.collateral ?? 0)),
        liquidationPrice: parseFloat(String(p.liquidationPrice ?? 0)),
        markPrice: parseFloat(String(p.markPrice ?? 0)),
        unrealizedPnL: parseFloat(String(p.unrealizedPnl ?? 0)),
        positionValue: size * parseFloat(String(p.markPrice ?? 0)),
      });
    }

    return result;
  }

  async getOrders(): Promise<CryptoOrder[]> {
    this.ensureInit();

    const allOrders: CcxtOrder[] = [];

    try {
      const open = await this.exchange.fetchOpenOrders();
      allOrders.push(...open);
    } catch {
      // Some exchanges don't support fetchOpenOrders
    }

    try {
      const closed = await this.exchange.fetchClosedOrders(undefined, undefined, 50);
      allOrders.push(...closed);
    } catch {
      // Some exchanges don't support fetchClosedOrders
    }

    const result: CryptoOrder[] = [];

    for (const o of allOrders) {
      const internalSymbol = this.symbolMapper.tryToInternal(o.symbol);
      if (!internalSymbol) continue;

      // Cache orderId -> symbol
      if (o.id) {
        this.orderSymbolCache.set(o.id, o.symbol);
      }

      result.push({
        id: o.id,
        symbol: internalSymbol,
        side: o.side as CryptoOrder['side'],
        type: (o.type ?? 'market') as CryptoOrder['type'],
        size: o.amount ?? 0,
        price: o.price,
        leverage: undefined,
        reduceOnly: o.reduceOnly ?? false,
        status: this.mapOrderStatus(o.status),
        filledPrice: o.average,
        filledSize: o.filled,
        filledAt: o.lastTradeTimestamp ? new Date(o.lastTradeTimestamp) : undefined,
        createdAt: new Date(o.timestamp ?? Date.now()),
      });
    }

    return result;
  }

  async getAccount(): Promise<CryptoAccountInfo> {
    this.ensureInit();

    const [balance, rawPositions] = await Promise.all([
      this.exchange.fetchBalance(),
      this.exchange.fetchPositions(),
    ]);

    // CCXT Balance uses indexer to access currency
    const bal = balance as unknown as Record<string, Record<string, unknown>>;
    const total = parseFloat(String(bal['total']?.['USDT'] ?? bal['total']?.['USD'] ?? 0));
    const free = parseFloat(String(bal['free']?.['USDT'] ?? bal['free']?.['USD'] ?? 0));
    const used = parseFloat(String(bal['used']?.['USDT'] ?? bal['used']?.['USD'] ?? 0));

    // Aggregate PnL from raw positions
    let unrealizedPnL = 0;
    let realizedPnL = 0;
    for (const p of rawPositions) {
      if (!this.symbolMapper.tryToInternal(p.symbol)) continue;
      unrealizedPnL += parseFloat(String(p.unrealizedPnl ?? 0));
      realizedPnL += parseFloat(String((p as unknown as Record<string, unknown>).realizedPnl ?? 0));
    }

    return {
      balance: free,
      totalMargin: used,
      unrealizedPnL,
      equity: total,
      realizedPnL,
      totalPnL: realizedPnL + unrealizedPnL,
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    this.ensureInit();

    try {
      const ccxtSymbol = this.orderSymbolCache.get(orderId);
      await this.exchange.cancelOrder(orderId, ccxtSymbol);
      return true;
    } catch {
      return false;
    }
  }

  async adjustLeverage(
    symbol: string,
    newLeverage: number,
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInit();

    const ccxtSymbol = this.symbolMapper.toCcxt(symbol);
    try {
      await this.exchange.setLeverage(newLeverage, ccxtSymbol);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getTicker(symbol: string): Promise<CryptoTicker> {
    this.ensureInit();

    const ccxtSymbol = this.symbolMapper.toCcxt(symbol);
    const ticker = await this.exchange.fetchTicker(ccxtSymbol);

    return {
      symbol,
      last: ticker.last ?? 0,
      bid: ticker.bid ?? 0,
      ask: ticker.ask ?? 0,
      high: ticker.high ?? 0,
      low: ticker.low ?? 0,
      volume: ticker.baseVolume ?? 0,
      timestamp: new Date(ticker.timestamp ?? Date.now()),
    };
  }

  async getFundingRate(symbol: string): Promise<CryptoFundingRate> {
    this.ensureInit();

    const ccxtSymbol = this.symbolMapper.toCcxt(symbol);
    const funding = await this.exchange.fetchFundingRate(ccxtSymbol);

    return {
      symbol,
      fundingRate: funding.fundingRate ?? 0,
      nextFundingTime: funding.fundingDatetime
        ? new Date(funding.fundingDatetime)
        : undefined,
      previousFundingRate: funding.previousFundingRate ?? undefined,
      timestamp: new Date(funding.timestamp ?? Date.now()),
    };
  }

  // ==================== Helpers ====================

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('CcxtTradingEngine not initialized. Call init() first.');
    }
  }

  private mapOrderStatus(status: string | undefined): CryptoOrder['status'] {
    switch (status) {
      case 'closed': return 'filled';
      case 'open': return 'pending';
      case 'canceled':
      case 'cancelled': return 'cancelled';
      case 'expired':
      case 'rejected': return 'rejected';
      default: return 'pending';
    }
  }

  async close(): Promise<void> {
    // ccxt exchanges typically don't need explicit closing
  }
}
