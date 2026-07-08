import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { endTimestamp, estimateRange, formatUTCTime, inDateWindow, INTERVALS, type TradingViewHistoricalQuery } from './historical.js'
import { fetchTradingViewBars, type FetchTradingViewBarsOptions, type TradingViewBar } from './websocket.js'

export interface TradingViewHistoricalFetchQuery extends TradingViewHistoricalQuery {
  symbol: string
}

export async function fetchTradingViewHistoricalBars(
  query: TradingViewHistoricalFetchQuery,
  options: {
    session?: 'regular' | 'extended'
    fetchBars?: (request: FetchTradingViewBarsOptions) => Promise<TradingViewBar[]>
  } = {},
): Promise<TradingViewBar[]> {
  const fetchBars = options.fetchBars ?? fetchTradingViewBars
  return fetchBars({
    symbol: query.symbol,
    interval: INTERVALS[query.interval],
    range: estimateRange(query),
    to: endTimestamp(query),
    session: options.session,
  })
}

export function transformTradingViewHistoricalData<TRow>(
  query: TradingViewHistoricalFetchQuery,
  bars: TradingViewBar[],
  options: {
    emptyDataMessage: string
    mapBar: (input: { bar: TradingViewBar; date: string }) => unknown
    parse: (row: unknown) => TRow
  },
): TRow[] {
  const out = [...bars]
    .sort((a, b) => a.time - b.time)
    .map((bar) => options.mapBar({ bar, date: formatUTCTime(bar.time) }))
    .filter((row) => {
      const date = typeof row === 'object' && row != null && 'date' in row
        ? String(row.date)
        : ''
      return inDateWindow(date, query)
    })

  if (out.length === 0) {
    throw new EmptyDataError(options.emptyDataMessage)
  }

  return out.map((row) => options.parse(row))
}
