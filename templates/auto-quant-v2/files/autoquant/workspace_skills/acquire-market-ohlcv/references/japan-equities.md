# Japan Listed Equities (`XTKS`)

- Keep one canonical symbol (for example `7203.T`) while passing numeric lookup codes (such as `7203` for Nikkei) in the fetcher's provider-code field.
- Use `Asia/Tokyo` (`XTKS` calendar) and verify completed session dates, holidays, and split adjustments.
- Treat current TOPIX or Nikkei constituent lists as a point-in-time snapshot rather than historical membership.

## Bundled Fetcher Routes

- `$fetch-yahoo-ohlcv`: Primary multi-year `split-adjusted` or `split-and-dividend-adjusted` daily route via `.T` symbols.
- `$fetch-nikkei-ohlcv`: Recent (~1 month) displayed raw daily OHLCV sample useful for short-window raw checks or recent freshness spot-checks.
- Credentialed JPX / J-Quants files provided by the caller can be ingested directly with `aq data ingest` or `aq.ingest_ohlcv(...)`.
