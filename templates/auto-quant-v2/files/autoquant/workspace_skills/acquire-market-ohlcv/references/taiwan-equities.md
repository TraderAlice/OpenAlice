# Taiwan Listed Equities (`TWSE`)

- Distinguish `TWSE` from `TPEx` explicitly and use `Asia/Taipei` (`XTAI` calendar) completed sessions.
- Keep raw prices distinct from split- or dividend-adjusted prices, and confirm share vs lot volume units.

## Bundled Fetcher Routes

- `$fetch-twse-ohlcv`: Official TWSE monthly historical report (`fetch_twse_daily.py`, raw TWD prices, ROC-to-Gregorian date conversion, share volume, `--request-delay 3` to respect CDN rate limits).
- `$fetch-finmind-ohlcv`: Multi-year raw daily `TaiwanStockPrice` route (`fetch_finmind_daily.py`) with traded-money checks when faster multi-year retrieval is needed or TWSE throttles.
- `$fetch-yahoo-ohlcv`: `.TW` symbols when `split-adjusted` or `split-and-dividend-adjusted` prices are required.
