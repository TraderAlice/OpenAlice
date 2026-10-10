/**
 * Symbol catalog for one cTrader account.
 *
 * Symbol ids are per broker server, so the catalog is loaded from the
 * account itself: the light symbol list, assets (currency names), symbol
 * categories and asset classes. Full symbol specs (digits, volume limits,
 * schedule) are fetched on demand with SYMBOL_BY_ID and cached.
 */

import { PayloadType } from './ctrader-protocol.js'
import type { CtraderSession } from './ctrader-session.js'
import { classifyAssetClass, type ScheduleInterval, type VenueAssetClass } from './ctrader-mapping.js'

export interface CatalogSymbol {
  symbolId: number
  name: string
  description: string
  enabled: boolean
  baseAsset: string | undefined
  quoteAsset: string | undefined
  category: string | undefined
  assetClassName: string | undefined
  assetClass: VenueAssetClass
  sortingNumber: number
}

/** The subset of ProtoOASymbol the adapter uses. */
export interface SymbolSpec {
  symbolId: number
  digits: number
  pipPosition: number
  /** Volumes are in cents of base units. */
  lotSize: number | undefined
  minVolume: number | undefined
  maxVolume: number | undefined
  stepVolume: number | undefined
  enableShortSelling: boolean
  tradingMode: number
  schedule: ScheduleInterval[]
  scheduleTimeZone: string | undefined
  slDistance: number | undefined
  tpDistance: number | undefined
  /** 1 = points, 2 = percentage (ProtoOASymbolDistanceType). */
  distanceSetIn: number
  measurementUnits: string | undefined
}

type Row = Record<string, unknown>

const DETAILS_BATCH = 50

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : []
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** "EUR/USD", "eurusd" and "EURUSD" are the same lookup key. */
export function symbolKey(name: string): string {
  return name.replace(/[\s/]/g, '').toUpperCase()
}

export function parseSymbolSpec(row: Row): SymbolSpec | null {
  const symbolId = num(row['symbolId'])
  const digits = num(row['digits'])
  if (symbolId === undefined || digits === undefined) return null
  return {
    symbolId,
    digits,
    pipPosition: num(row['pipPosition']) ?? digits,
    lotSize: num(row['lotSize']),
    minVolume: num(row['minVolume']),
    maxVolume: num(row['maxVolume']),
    stepVolume: num(row['stepVolume']),
    enableShortSelling: row['enableShortSelling'] !== false,
    tradingMode: num(row['tradingMode']) ?? 0,
    schedule: rows(row['schedule'])
      .map((i) => ({ startSecond: num(i['startSecond']), endSecond: num(i['endSecond']) }))
      .filter((i): i is ScheduleInterval => i.startSecond !== undefined && i.endSecond !== undefined),
    scheduleTimeZone: str(row['scheduleTimeZone']),
    slDistance: num(row['slDistance']),
    tpDistance: num(row['tpDistance']),
    distanceSetIn: num(row['distanceSetIn']) ?? 1,
    measurementUnits: str(row['measurementUnits']),
  }
}

export class CtraderCatalog {
  private symbols: CatalogSymbol[] = []
  private readonly byIdMap = new Map<number, CatalogSymbol>()
  private readonly byKeyMap = new Map<string, CatalogSymbol>()
  private readonly assets = new Map<number, string>()
  private readonly specs = new Map<number, SymbolSpec>()
  private loadedAt: Date | null = null

  constructor(private readonly session: CtraderSession) {}

  get isLoaded(): boolean {
    return this.loadedAt !== null
  }

  /** Load (or reload) the catalog. Keeps the previous one if any request fails. */
  async load(): Promise<void> {
    const [symbolsRes, assetsRes, classesRes, categoriesRes] = await Promise.all([
      this.session.accountRequest(PayloadType.SYMBOLS_LIST_REQ, { includeArchivedSymbols: false }, { expect: PayloadType.SYMBOLS_LIST_RES }),
      this.session.accountRequest(PayloadType.ASSET_LIST_REQ, {}, { expect: PayloadType.ASSET_LIST_RES }),
      this.session.accountRequest(PayloadType.ASSET_CLASS_LIST_REQ, {}, { expect: PayloadType.ASSET_CLASS_LIST_RES }),
      this.session.accountRequest(PayloadType.SYMBOL_CATEGORY_REQ, {}, { expect: PayloadType.SYMBOL_CATEGORY_RES }),
    ])

    const assets = new Map<number, string>()
    for (const a of rows(assetsRes.payload?.['asset'])) {
      const id = num(a['assetId'])
      const name = str(a['name'])
      if (id !== undefined && name) assets.set(id, name)
    }
    const classes = new Map<number, string>()
    for (const c of rows(classesRes.payload?.['assetClass'])) {
      const id = num(c['id'])
      const name = str(c['name'])
      if (id !== undefined && name) classes.set(id, name)
    }
    const categories = new Map<number, { name: string; assetClassId: number | undefined }>()
    for (const c of rows(categoriesRes.payload?.['symbolCategory'])) {
      const id = num(c['id'])
      const name = str(c['name'])
      if (id !== undefined && name) categories.set(id, { name, assetClassId: num(c['assetClassId']) })
    }

    const symbols: CatalogSymbol[] = []
    for (const s of rows(symbolsRes.payload?.['symbol'])) {
      const symbolId = num(s['symbolId'])
      const name = str(s['symbolName'])
      if (symbolId === undefined || !name) continue
      const categoryId = num(s['symbolCategoryId'])
      const category = categoryId !== undefined ? categories.get(categoryId) : undefined
      const assetClassName = category?.assetClassId !== undefined ? classes.get(category.assetClassId) : undefined
      const baseId = num(s['baseAssetId'])
      const quoteId = num(s['quoteAssetId'])
      symbols.push({
        symbolId,
        name,
        description: str(s['description']) ?? '',
        enabled: s['enabled'] !== false,
        baseAsset: baseId !== undefined ? assets.get(baseId) : undefined,
        quoteAsset: quoteId !== undefined ? assets.get(quoteId) : undefined,
        category: category?.name,
        assetClassName,
        assetClass: classifyAssetClass(assetClassName, category?.name),
        sortingNumber: num(s['sortingNumber']) ?? Number.MAX_SAFE_INTEGER,
      })
    }
    symbols.sort((a, b) => a.sortingNumber - b.sortingNumber)

    this.symbols = symbols
    this.byIdMap.clear()
    this.byKeyMap.clear()
    for (const s of symbols) {
      this.byIdMap.set(s.symbolId, s)
      if (!this.byKeyMap.has(symbolKey(s.name))) this.byKeyMap.set(symbolKey(s.name), s)
    }
    this.assets.clear()
    for (const [id, name] of assets) this.assets.set(id, name)
    this.specs.clear()
    this.loadedAt = new Date()
  }

  /** Enabled symbols in the broker's display order. */
  all(): CatalogSymbol[] {
    return this.symbols.filter((s) => s.enabled)
  }

  byId(symbolId: number): CatalogSymbol | undefined {
    return this.byIdMap.get(symbolId)
  }

  byName(name: string): CatalogSymbol | undefined {
    return this.byKeyMap.get(symbolKey(name))
  }

  assetName(assetId: number): string | undefined {
    return this.assets.get(assetId)
  }

  cachedSpec(symbolId: number): SymbolSpec | undefined {
    return this.specs.get(symbolId)
  }

  /** Full specs for the given symbols, fetching uncached ones in batches. */
  async specsFor(symbolIds: number[]): Promise<Map<number, SymbolSpec>> {
    const missing = [...new Set(symbolIds)].filter((id) => !this.specs.has(id))
    for (let i = 0; i < missing.length; i += DETAILS_BATCH) {
      const batch = missing.slice(i, i + DETAILS_BATCH)
      const res = await this.session.accountRequest(PayloadType.SYMBOL_BY_ID_REQ, { symbolId: batch }, { expect: PayloadType.SYMBOL_BY_ID_RES })
      for (const row of rows(res.payload?.['symbol'])) {
        const spec = parseSymbolSpec(row)
        if (spec) this.specs.set(spec.symbolId, spec)
      }
    }
    const out = new Map<number, SymbolSpec>()
    for (const id of symbolIds) {
      const spec = this.specs.get(id)
      if (spec) out.set(id, spec)
    }
    return out
  }

  async specFor(symbolId: number): Promise<SymbolSpec | undefined> {
    return (await this.specsFor([symbolId])).get(symbolId)
  }
}
