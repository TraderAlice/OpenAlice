# Common OHLCV Acquisition Checklist

## Before Fetching

- Clarify the research question, listing venue, quote currency, interval, and required date span before downloading bars.
- Check OpenAlice native market data (`alice market search-bars` + `alice market bars` / `uv run aq data fetch`) or caller-provided CSV/Parquet files first when they cover the needed symbols, interval, and history.
- Use a bounded date range of **completed bars only** (exclude the forming current session or partial intraday bar).
- Decide whether the study requires **raw**, **split-adjusted**, or **split-and-dividend-adjusted** prices:
  - Total-return and multi-year momentum/portfolio backtests generally require split-and-dividend or split-adjusted prices so stock splits do not appear as `-50%` crashes.
  - Event or microstructure studies around nominal price levels may require raw prices.

## Quality Checks Before Ingestion

- **OHLCV invariants**: Unique monotonic `(timestamp, asset)` keys, positive prices, `high >= max(open, close)`, `low <= min(open, close)`, and non-negative volume.
- **Volume units**: Confirm whether the provider reports shares or 100-share lots (bundled A-share scripts convert lots to shares automatically and audit against turnover value where available).
- **Suspensions & holidays**: Keep market closures and trading halts absent rather than forward-filling synthetic flat bars.
- **Cross-market clocks**: When combining daily bars from different timezones (for example `XTKS` Tokyo and `XNYS` New York), map session dates to real scheduled UTC close timestamps via `exchange_calendars` (see `$package-autoquant-ohlcv`) so same-date New York closes never leak into earlier Tokyo closes.
- **Survivorship disclosure**: Treat current index or ETF constituent lists as a point-in-time snapshot, not a survivorship-free historical universe, and note that limitation in `research.md`.

## Optional Cross-Check & Direct Ingestion

- Pick one appropriate source by default. Fetch a second independent provider only when diagnosing suspicious jumps, unadjusted splits, or missing history—and compare prices numerically only when adjustment semantics match.
- Ingest verified CSV/Parquet/DataFrame data directly into `<project>/data/` via `uv run aq data ingest` or `aq.ingest_ohlcv(...)`.
