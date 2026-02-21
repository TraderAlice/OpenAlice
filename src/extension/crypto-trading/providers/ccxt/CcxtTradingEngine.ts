/**
 * CCXT Trading Engine
 *
 * CCXT implementation of ICryptoTradingEngine, connecting to 100+ exchanges via ccxt unified API
 * No polling/waiting; placeOrder returns the exchange's immediate response directly
 */

import ccxt from 'ccxt';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Exchange, Order as CcxtOrder } from 'ccxt';
import type {
  ICryptoTradingEngine,
  CryptoPlaceOrderRequest,
  CryptoOrderResult,
  CryptoPosition,
  CryptoOrder,
  CryptoAccountInfo,
} from '../../interfaces.js';
import { SymbolMapper } from './symbol-map.js';
import { DailyLossCircuitBreaker } from '../../circuit-breaker.js';

// ==================== Hard Risk Limits ====================
const MAX_LEVERAGE_HARD_LIMIT = 10;
const MAX_POSITION_PCT = 0.15; // 15% of equity per position

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
  /** Max leverage override (capped at MAX_LEVERAGE_HARD_LIMIT=10). */
  maxLeverage?: number;
}

export class CcxtTradingEngine implements ICryptoTradingEngine {
  private exchange: Exchange;
  private symbolMapper: SymbolMapper;
  private initialized = false;

  // Maintain orderId -> ccxtSymbol mapping for cancelOrder (persisted to disk)
  private orderSymbolCache = new Map<string, string>();
  private static readonly CACHE_PATH = join(process.cwd(), 'data', 'order-symbol-cache.json');
  private static readonly MAX_CACHE_ENTRIES = 10_000;

  /** Circuit breaker — wired into placeOrder. */
  readonly circuitBreaker = new DailyLossCircuitBreaker();

  /** Track pending reduceOnly orders for deferred realized PnL recording. */
  private pendingReduceOnlyUnrealized = new Map<string, number>();

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

  /** Persist order-symbol cache to disk (pruned to MAX_CACHE_ENTRIES). */
  private async saveCache(): Promise<void> {
    try {
      // Prune oldest entries if over limit
      if (this.orderSymbolCache.size > CcxtTradingEngine.MAX_CACHE_ENTRIES) {
        const excess = this.orderSymbolCache.size - CcxtTradingEngine.MAX_CACHE_ENTRIES;
        const iter = this.orderSymbolCache.keys();
        for (let i = 0; i < excess; i++) {
          const key = iter.next().value;
          if (key) this.orderSymbolCache.delete(key);
        }
      }
      await mkdir(dirname(CcxtTradingEngine.CACHE_PATH), { recursive: true });
      const obj = Object.fromEntries(this.orderSymbolCache);
      await writeFile(CcxtTradingEngine.CACHE_PATH, JSON.stringify(obj, null, 2));
    } catch { /* best-effort */ }
  }

  /** Restore order-symbol cache from disk (with validation + size cap). */
  private async restoreCache(): Promise<void> {
    try {
      const raw = await readFile(CcxtTradingEngine.CACHE_PATH, 'utf-8');
      if (raw.length > 5 * 1024 * 1024) return; // reject files > 5MB
      const obj = JSON.parse(raw);
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
      const entries = Object.entries(obj);
      // Only load last MAX_CACHE_ENTRIES entries
      const start = Math.max(0, entries.length - CcxtTradingEngine.MAX_CACHE_ENTRIES);
      for (let i = start; i < entries.length; i++) {
        const [k, v] = entries[i];
        if (typeof k === 'string' && typeof v === 'string' && k.length < 200 && v.length < 200) {
          this.orderSymbolCache.set(k, v);
        }
      }
    } catch { /* no cache yet */ }
  }

  async init(): Promise<void> {
    await this.restoreCache();
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

    // Circuit breaker gate — check before any order
    try {
      const account = await this.getAccount();
      const cbResult = this.circuitBreaker.check(account.equity);
      if (!cbResult.allowed) {
        return { success: false, error: `Circuit breaker: ${cbResult.reason}` };
      }
    } catch {
      // If we can't get equity for circuit breaker, fail-closed
      return { success: false, error: 'Circuit breaker: cannot fetch account equity. Order blocked (fail-closed).' };
    }

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

    // Enforce position size limit (% of equity)
    try {
      const account = await this.exchange.fetchBalance();
      const bal = account as unknown as Record<string, Record<string, unknown>>;
      const equity = parseFloat(String(bal['total']?.['USDT'] ?? bal['total']?.['USD'] ?? 0));
      if (equity > 0) {
        const ticker = await this.exchange.fetchTicker(ccxtSymbol);
        const price = order.price ?? ticker.last ?? 0;
        const positionValue = size * price;
        const maxValue = equity * MAX_POSITION_PCT;
        if (positionValue > maxValue) {
          return {
            success: false,
            error: `Position value $${positionValue.toFixed(2)} exceeds ${(MAX_POSITION_PCT * 100).toFixed(0)}% of equity ($${maxValue.toFixed(2)}). Order rejected.`,
          };
        }
      }
    } catch {
      // If we can't check equity, log warning but allow order (exchange may not support fetchBalance)
      console.warn('CcxtTradingEngine: Could not verify position size limit (fetchBalance failed)');
    }

    try {
      // Enforce leverage hard limit (non-bypassable)
      const maxLev = Math.min(this.config.maxLeverage ?? MAX_LEVERAGE_HARD_LIMIT, MAX_LEVERAGE_HARD_LIMIT);
      if (order.leverage && order.leverage > maxLev) {
        return {
          success: false,
          error: `Leverage ${order.leverage}x exceeds hard limit of ${maxLev}x. Order rejected.`,
        };
      }

      // Futures: set leverage first
      if (order.leverage && order.leverage > 1) {
        try {
          await this.exchange.setLeverage(order.leverage, ccxtSymbol);
        } catch (leverageErr) {
          // BLOCKING: setLeverage failure must prevent order placement
          return {
            success: false,
            error: `Failed to set leverage to ${order.leverage}x: ${leverageErr instanceof Error ? leverageErr.message : String(leverageErr)}. Order rejected for safety.`,
          };
        }
      }

      const params: Record<string, unknown> = {};
      if (order.reduceOnly) params.reduceOnly = true;

      // Snapshot unrealized PnL before close for realized PnL calculation
      // Uses same getPositions() as post-close to ensure consistent universe
      let preCloseUnrealizedPnL: number | null = null;
      if (order.reduceOnly) {
        try {
          const prePositions = await this.getPositions();
          preCloseUnrealizedPnL = prePositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
        } catch { /* best-effort */ }
      }

      const ccxtOrder = await this.exchange.createOrder(
        ccxtSymbol,
        order.type,
        order.side,
        size,
        order.type === 'limit' ? order.price : undefined,
        params,
      );

      // Cache orderId -> symbol mapping (persisted)
      if (ccxtOrder.id) {
        this.orderSymbolCache.set(ccxtOrder.id, ccxtSymbol);
        this.saveCache().catch(() => {});
      }

      const status = this.mapOrderStatus(ccxtOrder.status);

      // Record realized PnL for circuit breaker when a reduceOnly order fills
      if (order.reduceOnly) {
        if (status === 'filled') {
          // Immediate fill: compute realized PnL now
          try {
            const freshPositions = await this.getPositions(); // side-effect: updates updateUnrealizedPnL
            if (preCloseUnrealizedPnL !== null) {
              const postUnrealized = freshPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
              const realizedPnL = preCloseUnrealizedPnL - postUnrealized;
              this.circuitBreaker.recordPnL(realizedPnL);
            }
            const fee = ccxtOrder.fee?.cost ?? 0;
            if (fee > 0) this.circuitBreaker.recordPnL(-fee);
          } catch { /* best-effort */ }
        } else if (ccxtOrder.id && preCloseUnrealizedPnL !== null) {
          // Deferred fill (limit order pending): store pre-close snapshot for later
          this.pendingReduceOnlyUnrealized.set(ccxtOrder.id, preCloseUnrealizedPnL);
        }
      }

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

    // Update unrealized PnL snapshot (replaces previous, does NOT accumulate)
    const totalUnrealizedPnL = result.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    this.circuitBreaker.updateUnrealizedPnL(totalUnrealizedPnL);

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

        // Check for deferred reduceOnly fills — record realized PnL
        if (this.mapOrderStatus(o.status) === 'filled' && this.pendingReduceOnlyUnrealized.has(o.id)) {
          const preUnrealized = this.pendingReduceOnlyUnrealized.get(o.id)!;
          this.pendingReduceOnlyUnrealized.delete(o.id);
          try {
            // Get current unrealized to compute diff
            const currentPositions = await this.getPositions();
            const postUnrealized = currentPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
            this.circuitBreaker.recordPnL(preUnrealized - postUnrealized);
          } catch { /* best-effort */ }
        }
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

    const balance = await this.exchange.fetchBalance();

    // CCXT Balance uses indexer to access currency
    const bal = balance as unknown as Record<string, Record<string, unknown>>;
    const total = parseFloat(String(bal['total']?.['USDT'] ?? bal['total']?.['USD'] ?? 0));
    const free = parseFloat(String(bal['free']?.['USDT'] ?? bal['free']?.['USD'] ?? 0));
    const used = parseFloat(String(bal['used']?.['USDT'] ?? bal['used']?.['USD'] ?? 0));

    // Aggregate unrealizedPnL from positions
    const positions = await this.getPositions();
    const unrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);

    return {
      balance: free,
      totalMargin: used,
      unrealizedPnL,
      equity: total,
      realizedPnL: 0,
      totalPnL: unrealizedPnL,
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

    // Enforce leverage hard limit (same as placeOrder — non-bypassable)
    const maxLev = Math.min(this.config.maxLeverage ?? MAX_LEVERAGE_HARD_LIMIT, MAX_LEVERAGE_HARD_LIMIT);
    if (newLeverage > maxLev) {
      return {
        success: false,
        error: `Leverage ${newLeverage}x exceeds hard limit of ${maxLev}x. Adjustment rejected.`,
      };
    }

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
