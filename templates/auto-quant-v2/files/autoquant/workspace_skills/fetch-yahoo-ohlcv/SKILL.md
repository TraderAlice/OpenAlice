---
name: fetch-yahoo-ohlcv
description: Fetch completed daily or strict XNYS regular-session 1h OHLCV bars from Yahoo Finance Chart via `aq-python` with explicit adjustment and timestamp validation, ready for `aq data ingest`.
---

# Fetch Yahoo OHLCV

Fetch historical daily or XNYS `1h` OHLCV from Yahoo Finance Chart when OpenAlice native bars (`alice market bars` / `aq data fetch`) do not cover the required symbols, history, or adjustment mode.

## Prepare

1. Check `$acquire-market-ohlcv` first to confirm Yahoo fits the market and adjustment requirement.
2. Create an asset inventory JSON as described in [assets-format.md](references/assets-format.md).
3. Choose an `--end-exclusive` date that excludes any forming current-day bar.

## Fetch Completed Daily Bars

```bash
aq-python scripts/fetch_yahoo_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --calendar XNYS \
  --timezone America/New_York \
  --adjustment split-and-dividend-adjusted \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Yahoo terms apply"
```

Key flags and behavior:

- **Adjustment**: `--adjustment split-adjusted` preserves Yahoo's split-adjusted quote OHLC; `--adjustment split-and-dividend-adjusted` scales all OHLC fields by `adjusted_close / raw_close` while keeping volume unchanged.
- **Panel mode**: `--panel observed-only` keeps each symbol's observed sessions without dropping rows across ragged histories; `--panel aligned` intersects common dates across all requested symbols. For mixed-market daily fetches, pass `--calendar provider-observed --timezone UTC` (and optionally map session dates to exact UTC closes via `$package-autoquant-ohlcv`).
- **Anomaly policies**: Defaults `--invalid-ohlc-policy reject` and `--transient-scale-policy reject` fail closed on corrupt provider bars. Pass `drop-observation` only when dropping isolated provider rounding/scale defects (logged in `provider-audit.json`) is explicitly preferable.

## Fetch Strict XNYS `1h` Bars

For aligned U.S. equity/ETF `1h` regular-session bars (within Yahoo's trailing ~730-day intraday window):

```bash
aq-python scripts/fetch_yahoo_intraday.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --calendar XNYS \
  --timezone America/New_York \
  --interval 1h \
  --feature-interval 1d \
  --adjustment split-adjusted \
  --panel aligned \
  --terms "caller-authorized research retrieval; Yahoo terms apply"
```

Yahoo labels intraday buckets by **start** time; `fetch_yahoo_intraday.py` maps each bucket to its completed **bar-close** timestamp (`min(start + 1h, scheduled session close)`) using `exchange_calendars` (`XNYS`), handling half-hour closes and early closes accurately.

## Inspect & Ingest into AutoQuant

1. Check `provider-audit.json` and the generated `<symbol>.csv` files for date coverage, row counts, and any dropped or missing sessions.
2. Ingest directly into the Project:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source yahoo \
     --json
   ```
