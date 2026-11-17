# European Union Equity Venues

Name the exact listing venue (for example `XPAR` Euronext Paris, `XETR` Xetra, `XMIL` Borsa Italiana) rather than treating "EU equities" as a single clock or currency.

- Preserve venue, local timezone, currency, and primary listing vs ADR/cross-listing identity explicitly.
- Do not generalize one venue's trading calendar or provider behavior to other EU exchanges.

## Bundled Fetcher Routes (`XPAR` Euronext Paris)

- `$fetch-euronext-ohlcv`: Official Euronext Live historical CSV download for `XPAR` EUR equities (within the displayed two-year window), supporting `raw` or `provider-adjusted` prices with ISIN verification.
- `$fetch-yahoo-ohlcv`: `.PA` symbols for longer `split-adjusted` or `split-and-dividend-adjusted` history beyond Euronext Live's two-year window.
