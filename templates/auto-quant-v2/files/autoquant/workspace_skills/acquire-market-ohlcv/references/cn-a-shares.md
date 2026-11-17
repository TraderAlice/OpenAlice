# Mainland China A-Shares (`XSHG`, `XSHE`, `XBSE`)

- Preserve `XSHG`, `XSHE`, or `XBSE` explicitly and keep the canonical research symbol separate from provider prefixes/suffixes; explicitly specify `equity` vs `fund` (for example ETF `510300`).
- Use `Asia/Shanghai`; preserve trading halts, suspensions, and price-limit days without forward-filling missing bars.
- State whether prices are `raw` or `split-adjusted`/`split-and-dividend-adjusted`—corporate-action adjustments materially change multi-year return and momentum series.
- Verify volume units (shares vs 100-share lots).

## Bundled Fetcher Routes

- `$fetch-eastmoney-ohlcv`: Raw daily OHLCV (`fqt=0`, CNY) for `XSHG`/`XSHE`/`XBSE`; converts `f56` lots to shares (`×100`) and verifies `amount / shares` lies within `[low, high]`.
- `$fetch-sina-ohlcv`: Raw recent daily OHLCV (up to 1,023 sessions) in shares, including post-migration `bj920...` Beijing symbols.
- `$fetch-sohu-ohlcv`: Raw daily OHLCV for `XSHG`/`XSHE`/`XBSE`; converts lots to shares (`×100`) and checks traded value against OHLC.
- `$fetch-tencent-ohlcv`: Raw daily OHLCV for `XSHG`/`XSHE`; converts lots to shares (`×100`).
- `$fetch-yahoo-ohlcv`: Broad `.SS` / `.SZ` route when `split-adjusted` or `split-and-dividend-adjusted` history is needed.
