import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  fetchTradingViewHistoricalBars,
  mapTradingViewHistoricalBars,
  mapTradingViewSearchRows,
  searchTradingViewSymbols,
  type TradingViewAssetKind,
  type TradingViewHistoricalQuery,
  type TradingViewSearchType,
} from '../domain.js'
import type { TradingViewBar } from '../utils/websocket.js'

interface Parser<T> {
  parse(input: unknown): T
}

interface TradingViewSearchQuery {
  query?: string | null
}

export function createTradingViewSearchFetcher<TQuery extends TradingViewSearchQuery, TRow>(options: {
  querySchema: Parser<TQuery>
  dataSchema: Parser<TRow>
  searchType: TradingViewSearchType
  assetKind: TradingViewAssetKind
}) {
  return class TradingViewSearchFetcher extends Fetcher {
    static override requireCredentials = false

    static override transformQuery(params: Record<string, unknown>): TQuery {
      return options.querySchema.parse(params)
    }

    static override async extractData(
      query: TQuery,
      _credentials: Record<string, string> | null,
    ): Promise<Record<string, unknown>[]> {
      return searchTradingViewSymbols(query.query, options.searchType)
    }

    static override transformData(_query: TQuery, rows: Record<string, unknown>[]): TRow[] {
      return mapTradingViewSearchRows(rows, options.assetKind)
        .map((row) => options.dataSchema.parse(row))
    }
  }
}

export function createTradingViewHistoricalFetcher<TQuery extends TradingViewHistoricalQuery, TRow>(options: {
  querySchema: Parser<TQuery>
  dataSchema: Parser<TRow>
  assetKind: TradingViewAssetKind
  emptyDataMessage: string
  sessionFor?: (query: TQuery) => 'regular' | 'extended' | undefined
}) {
  return class TradingViewHistoricalFetcher extends Fetcher {
    static override requireCredentials = false

    static override transformQuery(params: Record<string, unknown>): TQuery {
      return options.querySchema.parse(params)
    }

    static override async extractData(
      query: TQuery,
      _credentials: Record<string, string> | null,
    ): Promise<TradingViewBar[]> {
      return fetchTradingViewHistoricalBars(query, { session: options.sessionFor?.(query) })
    }

    static override transformData(query: TQuery, bars: TradingViewBar[]): TRow[] {
      return mapTradingViewHistoricalBars(query, bars, {
        assetKind: options.assetKind,
        emptyDataMessage: options.emptyDataMessage,
        mapBar: ({ bar, date, semantics }) => ({
          date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          vwap: null,
          symbol: query.symbol,
          provider: semantics.provider,
          ...(options.assetKind === 'equity'
            ? { coverage: semantics.coverage, volume_quality: semantics.volumeQuality }
            : {}),
        }),
        parse: (row) => options.dataSchema.parse(row),
      })
    }
  }
}
