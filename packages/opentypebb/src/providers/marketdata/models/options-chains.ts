import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  EmptyDataError,
  NetworkUnreachableError,
  OpenBBError,
  RateLimitedError,
  UnauthorizedError,
} from '../../../core/provider/utils/errors.js'
import { OptionsChainsDataSchema, OptionsChainsQueryParamsSchema } from '../../../standard-models/options-chains.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const MarketDataOptionsChainsQueryParamsSchema = OptionsChainsQueryParamsSchema.extend({
  date: isoDate.optional(),
  expiration: isoDate.optional(),
  strike_min: z.coerce.number().finite().optional(),
  strike_max: z.coerce.number().finite().optional(),
  side: z.enum(['call', 'put']).optional(),
}).superRefine((query, ctx) => {
  if (query.strike_min != null && query.strike_max != null && query.strike_min > query.strike_max) {
    ctx.addIssue({ code: 'custom', message: 'strike_min must be less than or equal to strike_max' })
  }
})

export type MarketDataOptionsChainsQueryParams = z.infer<typeof MarketDataOptionsChainsQueryParamsSchema>

const ResponseSchema = z.object({
  s: z.string(),
  errmsg: z.string().optional(),
  nextTime: z.number().optional(),
  prevTime: z.number().optional(),
  optionSymbol: z.array(z.string()).optional(),
  underlying: z.array(z.string().nullable()).optional(),
  expiration: z.array(z.number().nullable()).optional(),
  side: z.array(z.string().nullable()).optional(),
  strike: z.array(z.number().nullable()).optional(),
  firstTraded: z.array(z.number().nullable()).optional(),
  dte: z.array(z.number().nullable()).optional(),
  ask: z.array(z.number().nullable()).optional(),
  askSize: z.array(z.number().nullable()).optional(),
  bid: z.array(z.number().nullable()).optional(),
  bidSize: z.array(z.number().nullable()).optional(),
  mid: z.array(z.number().nullable()).optional(),
  last: z.array(z.number().nullable()).optional(),
  volume: z.array(z.number().nullable()).optional(),
  openInterest: z.array(z.number().nullable()).optional(),
  underlyingPrice: z.array(z.number().nullable()).optional(),
  inTheMoney: z.array(z.boolean().nullable()).optional(),
  intrinsicValue: z.array(z.number().nullable()).optional(),
  extrinsicValue: z.array(z.number().nullable()).optional(),
  updated: z.array(z.number().nullable()).optional(),
  iv: z.array(z.number().nullable()).optional(),
  delta: z.array(z.number().nullable()).optional(),
  gamma: z.array(z.number().nullable()).optional(),
  theta: z.array(z.number().nullable()).optional(),
  vega: z.array(z.number().nullable()).optional(),
}).passthrough()

type MarketDataResponse = z.infer<typeof ResponseSchema>

function epochIso(value: number | null | undefined): string | null {
  return value == null ? null : new Date(value * 1000).toISOString()
}

function epochDate(value: number | null | undefined): string | null {
  return epochIso(value)?.slice(0, 10) ?? null
}

function nearbyDate(response: MarketDataResponse): string {
  const prev = epochDate(response.prevTime)
  const next = epochDate(response.nextTime)
  return [prev && `previous=${prev}`, next && `next=${next}`].filter(Boolean).join(', ')
}

export class MarketDataOptionsChainsFetcher extends Fetcher {
  static override requireCredentials = true

  static override transformQuery(params: Record<string, unknown>): MarketDataOptionsChainsQueryParams {
    return MarketDataOptionsChainsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: MarketDataOptionsChainsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<MarketDataResponse> {
    const token = credentials?.marketdata_api_key ?? ''
    if (!token) throw new UnauthorizedError('MarketData token required.')

    const url = new URL(`https://api.marketdata.app/v1/options/chain/${encodeURIComponent(query.symbol)}/`)
    if (query.date) url.searchParams.set('date', query.date)
    if (query.expiration) url.searchParams.set('expiration', query.expiration)
    if (query.strike_min != null && query.strike_max != null) {
      url.searchParams.set('strike', `${query.strike_min}-${query.strike_max}`)
    }
    if (query.side) url.searchParams.set('side', query.side)

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedError(`MarketData rejected the token (HTTP ${response.status}).`)
      }
      if (response.status === 429) {
        throw new RateLimitedError('MarketData', 'API credit or rate limit reached', { status: 429 })
      }
      if (!response.ok) throw new OpenBBError(`MarketData option chain returned HTTP ${response.status}.`)

      const data = ResponseSchema.parse(await response.json())
      if (data.s === 'no_data') {
        const nearby = nearbyDate(data)
        throw new EmptyDataError(`No MarketData option chain for the requested filters${nearby ? ` (${nearby})` : ''}.`)
      }
      if (data.s !== 'ok') throw new OpenBBError(data.errmsg || 'MarketData option chain returned an error.')
      if (!data.optionSymbol?.length) throw new EmptyDataError('MarketData returned an empty option chain.')
      return data
    } catch (error) {
      if (error instanceof OpenBBError || error instanceof z.ZodError) throw error
      const cause = error instanceof Error ? error.message : String(error)
      throw new NetworkUnreachableError('api.marketdata.app', cause, error)
    }
  }

  static override transformData(
    query: MarketDataOptionsChainsQueryParams,
    data: MarketDataResponse,
  ) {
    return data.optionSymbol!.map((contractSymbol, index) => OptionsChainsDataSchema.parse({
      underlying_symbol: data.underlying?.[index] ?? query.symbol,
      underlying_price: data.underlyingPrice?.[index] ?? null,
      contract_symbol: contractSymbol,
      eod_date: query.date ?? epochDate(data.updated?.[index]),
      expiration: epochDate(data.expiration?.[index]) ?? query.expiration ?? '',
      dte: data.dte?.[index] ?? null,
      strike: data.strike?.[index],
      option_type: data.side?.[index] ?? '',
      contract_size: 100,
      open_interest: data.openInterest?.[index] ?? null,
      volume: data.volume?.[index] ?? null,
      last_trade_price: data.last?.[index] ?? null,
      last_trade_time: epochIso(data.updated?.[index]),
      bid: data.bid?.[index] ?? null,
      bid_size: data.bidSize?.[index] ?? null,
      ask: data.ask?.[index] ?? null,
      ask_size: data.askSize?.[index] ?? null,
      mark: data.mid?.[index] ?? null,
      implied_volatility: data.iv?.[index] ?? null,
      delta: data.delta?.[index] ?? null,
      gamma: data.gamma?.[index] ?? null,
      theta: data.theta?.[index] ?? null,
      vega: data.vega?.[index] ?? null,
      first_traded: epochIso(data.firstTraded?.[index]),
      in_the_money: data.inTheMoney?.[index] ?? null,
      intrinsic_value: data.intrinsicValue?.[index] ?? null,
      extrinsic_value: data.extrinsicValue?.[index] ?? null,
      source: 'marketdata',
    }))
  }
}
