/**
 * Symbol bidirectional mapping
 *
 * Internal symbol ("BTC/USD") <-> CCXT symbol ("BTC/USDT:USDT")
 *
 * Automatically discovers all available symbols from exchange.loadMarkets() results
 */

interface MarketInfo {
  symbol: string;
  base: string;
  quote: string;
  type: string; // 'spot' | 'swap' | 'future' | 'option'
  settle?: string;
  active?: boolean;
  precision?: {
    price?: number;
    amount?: number;
  };
}

export class SymbolMapper {
  private internalToCcxt = new Map<string, string>();
  private ccxtToInternal = new Map<string, string>();
  private precisionMap = new Map<string, { price: number; amount: number }>();

  constructor(
    private defaultMarketType: 'spot' | 'swap',
  ) {}

  /**
   * Initialize mapping from ccxt exchange.markets
   *
   * Scans all exchange markets and builds a bidirectional mapping for every
   * base asset that has a USD/USDT-quoted spot or swap market.
   * For each base, picks the single best market using a priority scheme
   * determined by defaultMarketType.
   */
  init(markets: Record<string, MarketInfo>): void {
    // Group by base asset, keep only the best candidate per base
    const bestByBase = new Map<string, { ccxtSymbol: string; priority: number }>();

    for (const [ccxtSymbol, market] of Object.entries(markets)) {
      if (market.active === false) continue;

      const isSwap = market.type === 'swap' || market.type === 'future';
      const isSpot = market.type === 'spot';
      const isUsdt = market.quote === 'USDT' || market.settle === 'USDT';
      const isUsd = market.quote === 'USD' || market.settle === 'USD';

      if (!isSwap && !isSpot) continue;
      if (!isUsdt && !isUsd) continue;

      let priority: number;
      if (this.defaultMarketType === 'swap') {
        if (isSwap && isUsdt) priority = 0;
        else if (isSwap && isUsd) priority = 1;
        else if (isSpot && isUsdt) priority = 2;
        else priority = 3;
      } else {
        if (isSpot && isUsdt) priority = 0;
        else if (isSpot && isUsd) priority = 1;
        else if (isSwap && isUsdt) priority = 2;
        else priority = 3;
      }

      const existing = bestByBase.get(market.base);
      if (!existing || priority < existing.priority) {
        bestByBase.set(market.base, { ccxtSymbol, priority });
      }
    }

    // Build bidirectional mappings
    for (const [base, best] of bestByBase) {
      const internalSymbol = `${base}/USD`;
      this.internalToCcxt.set(internalSymbol, best.ccxtSymbol);
      this.ccxtToInternal.set(best.ccxtSymbol, internalSymbol);

      const market = markets[best.ccxtSymbol];
      if (market?.precision) {
        this.precisionMap.set(internalSymbol, {
          price: market.precision.price ?? 2,
          amount: market.precision.amount ?? 8,
        });
      }
    }
  }

  /** Internal "BTC/USD" → CCXT "BTC/USDT:USDT" */
  toCcxt(internalSymbol: string): string {
    const ccxt = this.internalToCcxt.get(internalSymbol);
    if (!ccxt) {
      throw new Error(`No CCXT mapping for symbol: ${internalSymbol}`);
    }
    return ccxt;
  }

  /** CCXT "BTC/USDT:USDT" → Internal "BTC/USD" */
  toInternal(ccxtSymbol: string): string {
    const internal = this.ccxtToInternal.get(ccxtSymbol);
    if (!internal) {
      throw new Error(`No internal mapping for CCXT symbol: ${ccxtSymbol}`);
    }
    return internal;
  }

  /** Attempt conversion; returns null if no mapping exists */
  tryToInternal(ccxtSymbol: string): string | null {
    return this.ccxtToInternal.get(ccxtSymbol) ?? null;
  }

  /** Get symbol precision */
  getPrecision(internalSymbol: string): { price: number; amount: number } {
    return this.precisionMap.get(internalSymbol) ?? { price: 2, amount: 8 };
  }

  /** Get all mapped internal symbols */
  getMappedSymbols(): string[] {
    return [...this.internalToCcxt.keys()];
  }
}
