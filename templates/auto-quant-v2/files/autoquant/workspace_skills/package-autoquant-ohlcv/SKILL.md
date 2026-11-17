---
name: package-autoquant-ohlcv
description: Inspect OHLCV data quality, ingest CSV/Parquet/fetcher outputs directly into AutoQuant `<project>/data/`, or run optional multi-market daily close-time materialization and cross-source comparison helpers.
---

# Inspect & Ingest AutoQuant OHLCV

Validate OHLCV bar quality honestly and ingest clean datasets into `<project>/data/` (`manifest.json`), with optional helpers for cross-market UTC close-time mapping and provider comparison.

## Standard Path: Inspect & Ingest Directly

AutoQuant `v1.0.0` does **not** require `dataset-package.json` staging manifests or `research-request.json` intake ceremony. For ordinary single-symbol CSVs, directories of `<SYMBOL>.csv` files (including output folders from `$fetch-*-ohlcv`), Parquet files, or pandas DataFrames:

1. **Inspect quality honestly**:
   - Check symbol list, start/end dates, row counts, missing sessions or trading halts, `high >= low`, volume scale, and price-adjustment semantics (`raw`, `split-adjusted`, `split-and-dividend-adjusted`).
   - If the bars came from a `$fetch-*-ohlcv` script, review its `provider-audit.json` for dropped anomalies, lot conversions, or truncated history.
   - Never silently forward-fill missing bars or mix incompatible adjustment modes across assets.
2. **Ingest directly into `<project>/data/`**:

   ```bash
   uv run aq data ingest . /path/to/csv_or_folder \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source <provider-or-origin> \
     --json
   ```

   Or from Python:

   ```python
   import autoquant as aq

   aq.ingest_ohlcv(
       "projects/<project-id>",
       "/path/to/csv_or_folder",
       dataset_id="<dataset-id>",
       source="<provider-or-origin>",
   )
   ```

`ingest_ohlcv` normalizes columns (`timestamp, asset, open, high, low, close, volume`), enforces causal sorting and OHLCV invariants, writes `<project>/data/<dataset_id>.csv` (or `.parquet`), and records SHA-256 + coverage metadata in `<project>/data/manifest.json`.

## Optional Utilities in `scripts/`

Run these optional utilities with `aq-python` whenever cross-market timestamp alignment or explicit multi-provider diagnostics are needed:

### 1. Map Date-Only Cross-Market Daily Bars to Exact UTC Session Closes

When combining daily bars from exchanges in different timezones (for example `7203.T` on `XTKS` and `SPY` on `XNYS`), civil dates (`YYYY-MM-DD`) hide the fact that Tokyo closes hours before New York opens on the same calendar date. Map each session date to its scheduled `exchange_calendars` regular-session close in UTC:

```bash
aq-python scripts/materialize_daily_close_time.py \
  --source-package /path/to/date-daily/dataset-package.json \
  --authority /path/to/daily-close-time-authority.json \
  --output /path/to/close-time-output
```

See [package-contracts.md](references/package-contracts.md) for the `daily-close-time-authority.json` format, then ingest `/path/to/close-time-output/assets` into `<project>/data/` with `aq data ingest` or `aq.ingest_ohlcv(...)`.

### 2. Audit or Compare Two Fetcher Outputs (When Diagnosing Discrepancies)

When a `$fetch-*-ohlcv` output folder looks suspicious and you want a structural audit or side-by-side comparison against a second provider:

```bash
aq-python scripts/audit_ohlcv_package.py \
  --package /path/to/fetch-output/dataset-package.json \
  --write-audit /path/to/package-audit.json

aq-python scripts/compare_ohlcv_packages.py \
  --left /path/to/source-a/dataset-package.json \
  --right /path/to/source-b/dataset-package.json \
  --write-audit /path/to/comparison.json
```

Pass `--mode coverage-only` to `compare_ohlcv_packages.py` when comparing a `raw` source against a `split-adjusted` source so date coverage and freshness are compared without misleading price diffs.

### 3. Merge Disjoint Multi-Provider Observed Packages

When distinct symbols come from separate `$fetch-*-ohlcv` packages with compatible intervals and adjustment claims, you can either concatenate their normalized DataFrames in Python before calling `aq.ingest_ohlcv(...)` or use `scripts/compose_observed_packages.py` (documented in [package-contracts.md](references/package-contracts.md)).
