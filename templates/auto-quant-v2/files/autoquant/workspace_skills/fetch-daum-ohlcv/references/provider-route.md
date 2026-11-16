# Daum daily-history route

Observed route:

```text
https://finance.daum.net/api/quote/<symbol>/days
  ?symbolCode=<symbol>
  &page=<page>
  &perPage=<rows>
```

The 2026-07 JSON exposed `code`, `message`, `currentPage`, `pageSize`,
`totalCount`, `totalPages`, and reverse-chronological `data`. OHLC came from
`openingPrice`, `highPrice`, `lowPrice`, and `tradePrice`; share volume came
from `accTradeVolume`. This is observed web behavior, not a stable public API
contract.

`accTradePrice / accTradeVolume` is retained as an exact diagnostic, but the
provider does not establish that both aggregates share the exact session scope
of the daily OHLC fields. A ratio outside low/high is therefore audited rather
than used to repair or reject otherwise valid OHLCV.
