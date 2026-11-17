# U.S. Listed Equities & ETFs

- Prefer `alice market search-bars` + `alice market bars` / `uv run aq data fetch` first when OpenAlice native bars cover the needed symbols, interval, and history.
- Name the listing venue (`XNYS`, `XNAS`, `ARCX`, etc.) explicitly and use `America/New_York` (`XNYS` calendar) for consolidated regular-session research.
- Distinguish `raw`, `split-adjusted`, and `split-and-dividend-adjusted` history. Never adjust only close while leaving raw OHLC.
- Treat current index/ETF constituent lists as a current snapshot, not a survivorship-free historical universe.

## Bundled Fetcher Routes

- `$fetch-yahoo-ohlcv`: Broad `split-adjusted` or `split-and-dividend-adjusted` daily route (`fetch_yahoo_daily.py`) plus strict XNYS regular-session `1h` route (`fetch_yahoo_intraday.py`, trailing ~730 days, bucket-start mapped to completed bar-close).
- `$fetch-nasdaq-ohlcv`: Independent `split-adjusted` daily historical-quotes route (`fetch_nasdaq_daily.py`, up to 5,000 sessions per symbol) useful as an alternative or cross-check when Yahoo is rate-limited or exhibits corporate-action anomalies.
