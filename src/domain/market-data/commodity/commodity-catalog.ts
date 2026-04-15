/**
 * Commodity Catalog — canonical naming + enumeration
 *
 * Commodity is a closed set (~30 root symbols, stable for decades).
 * Unlike equities (open set, daily IPO/delist), commodities only need
 * enumeration, not server-side search.
 *
 * Each entry uses a canonical id (e.g. "gold", "crude_oil") that is
 * provider-agnostic. Provider-specific ticker translation (gold → GC=F
 * for yfinance, gold → GCUSD for FMP) lives in each provider's fetcher.
 *
 * Aliases include provider tickers so that searching "GC=F" or "GCUSD"
 * still resolves to the canonical "gold" entry — easing migration from
 * provider-specific naming to canonical naming.
 */

export interface CommodityCatalogEntry {
  id: string
  name: string
  category: string
  aliases: string[]
}

export class CommodityCatalog {
  private entries: CommodityCatalogEntry[] = []

  get size(): number { return this.entries.length }

  load(): void {
    this.entries = CATALOG
  }

  /**
   * Regex/substring search across id, name, and aliases.
   * Same logic as SymbolIndex.search() — regex with fallback to substring.
   */
  search(pattern: string, limit = 20): CommodityCatalogEntry[] {
    let test: (s: string) => boolean

    try {
      const re = new RegExp(pattern, 'i')
      test = (s) => re.test(s)
    } catch {
      const lower = pattern.toLowerCase()
      test = (s) => s.toLowerCase().includes(lower)
    }

    const results: CommodityCatalogEntry[] = []
    for (const entry of this.entries) {
      if (
        test(entry.id) ||
        test(entry.name) ||
        entry.aliases.some(test)
      ) {
        results.push(entry)
        if (results.length >= limit) break
      }
    }
    return results
  }

  resolve(id: string): CommodityCatalogEntry | undefined {
    const lower = id.toLowerCase()
    return this.entries.find((e) => e.id === lower)
  }

  list(): CommodityCatalogEntry[] {
    return [...this.entries]
  }
}

// ==================== Canonical Commodity Catalog ====================

const CATALOG: CommodityCatalogEntry[] = [
  // Precious metals
  { id: 'gold',        name: 'Gold',              category: 'metals', aliases: ['黄金', 'xau', 'GC=F', 'GCUSD'] },
  { id: 'silver',      name: 'Silver',            category: 'metals', aliases: ['白银', 'xag', 'SI=F', 'SIUSD'] },
  { id: 'platinum',    name: 'Platinum',          category: 'metals', aliases: ['铂金', 'PL=F', 'PLUSD'] },
  { id: 'palladium',   name: 'Palladium',         category: 'metals', aliases: ['钯金', 'PA=F', 'PAUSD'] },

  // Industrial metals
  { id: 'copper',      name: 'Copper',            category: 'metals', aliases: ['铜', 'HG=F', 'HGUSD'] },

  // Energy
  { id: 'crude_oil',   name: 'Crude Oil (WTI)',   category: 'energy', aliases: ['原油', 'wti', 'CL=F', 'CLUSD'] },
  { id: 'brent',       name: 'Brent Crude',       category: 'energy', aliases: ['布伦特原油', 'BZ=F', 'BZUSD'] },
  { id: 'natural_gas', name: 'Natural Gas',       category: 'energy', aliases: ['天然气', 'NG=F', 'NGUSD'] },
  { id: 'heating_oil', name: 'Heating Oil',       category: 'energy', aliases: ['取暖油', 'HO=F', 'HOUSD'] },
  { id: 'gasoline',    name: 'Gasoline (RBOB)',   category: 'energy', aliases: ['汽油', 'RB=F', 'RBUSD'] },

  // Agriculture (CBOT grains)
  { id: 'corn',        name: 'Corn',              category: 'agriculture', aliases: ['玉米', 'ZC=F', 'ZCUSX'] },
  { id: 'wheat',       name: 'Wheat',             category: 'agriculture', aliases: ['小麦', 'ZW=F', 'KEUSX'] },
  { id: 'soybeans',    name: 'Soybeans',          category: 'agriculture', aliases: ['大豆', 'ZS=F', 'ZSUSX'] },
  { id: 'oats',        name: 'Oats',              category: 'agriculture', aliases: ['燕麦', 'ZO=F'] },
  { id: 'rice',        name: 'Rough Rice',        category: 'agriculture', aliases: ['稻米', 'ZR=F'] },

  // Softs (ICE)
  { id: 'sugar',       name: 'Sugar #11',         category: 'softs', aliases: ['糖', 'SB=F', 'SBUSX'] },
  { id: 'coffee',      name: 'Coffee',            category: 'softs', aliases: ['咖啡', 'KC=F', 'KCUSX'] },
  { id: 'cocoa',       name: 'Cocoa',             category: 'softs', aliases: ['可可', 'CC=F', 'CCUSX'] },
  { id: 'cotton',      name: 'Cotton',            category: 'softs', aliases: ['棉花', 'CT=F', 'CTUSX'] },
  { id: 'lumber',      name: 'Lumber',            category: 'softs', aliases: ['木材', 'LBS=F'] },
  { id: 'orange_juice', name: 'Orange Juice',     category: 'softs', aliases: ['橙汁', 'OJ=F'] },

  // Livestock
  { id: 'live_cattle', name: 'Live Cattle',       category: 'livestock', aliases: ['活牛', 'LE=F'] },
  { id: 'lean_hogs',   name: 'Lean Hogs',         category: 'livestock', aliases: ['瘦肉猪', 'HE=F'] },
  { id: 'feeder_cattle', name: 'Feeder Cattle',   category: 'livestock', aliases: ['架子牛', 'GF=F'] },
]
