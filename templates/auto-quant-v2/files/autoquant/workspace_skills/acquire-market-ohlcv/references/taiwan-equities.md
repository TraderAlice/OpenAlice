# Taiwan listed equities

- Preserve `TWSE` versus `TPEx`; they are not interchangeable venue labels.
- Use `Asia/Taipei` and keep session closures, suspensions, and missing
  observations explicit.
- Verify whether volume is reported in shares, trading units, or lots before
  packaging.
- Keep raw prices distinct from any provider adjustment. Corporate-action
  semantics require an explicit source claim.

## Routes

- TWSE official: first route through `$fetch-twse-ohlcv`. The current official
  OpenAPI advertises `/v1/exchangeReport/STOCK_DAY_ALL`; the official
  historical query says individual-security data is available from
  2010-01-04. Verify actual response span, monthly retrieval, price/volume
  units, freshness, access behavior, and terms before calling it accepted.
- FinMind `TaiwanStockPrice`: independently executable aggregator route
  through `$fetch-finmind-ohlcv`; preserve traded-money checks and compare raw
  overlap with official TWSE without calling the aggregator exchange truth.
- Yahoo: independent broad route through `$fetch-yahoo-ohlcv` and likely more
  delayed. Compare the same TWSE symbols and dates rather than treating it as
  automatic primary.
- TPEx needs its own official/provider evidence; a TWSE proof does not cover
  TPEx.

The accepted routing order is TWSE official first, then FinMind or Yahoo when
their broader history or availability fits the task. TWSE and FinMind emit
`raw` prices; Yahoo quote history emits `split-adjusted` prices. All can be
useful sources, but a bounded overlap with no observed corporate action does
not turn unlike contracts into the same semantic series.

Official discovery:

- https://openapi.twse.com.tw/
- https://www.twse.com.tw/en/trading/historical/stock-day.html
