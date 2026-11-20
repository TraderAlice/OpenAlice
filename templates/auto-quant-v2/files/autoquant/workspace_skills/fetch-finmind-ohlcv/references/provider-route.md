# FinMind TaiwanStockPrice route

Observed route:

```text
https://api.finmindtrade.com/api/v4/data
  ?dataset=TaiwanStockPrice
  &data_id=<stock-id>
  &start_date=YYYY-MM-DD
  &end_date=YYYY-MM-DD
```

The July 2026 JSON exposed `status`, `msg`, and rows containing `date`,
`stock_id`, `open`, `max`, `min`, `close`, `Trading_Volume`,
`Trading_money`, `spread`, and `Trading_turnover`. This is an aggregator API
contract subject to FinMind access and terms, not an official TWSE response.
