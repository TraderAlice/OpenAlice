---
name: fetch-binance-ohlcv
description: Fetch paginated closed Binance Spot public 1h K-lines on a verified continuous UTC bar-close grid via `aq-python`, ready for `aq data ingest`.
---

# Fetch Binance OHLCV

Fetch continuous UTC `1h` closed Spot K-lines from Binance public endpoints when `alice market bars` / `aq data fetch` does not cover the requested pair or history.

## Fetch

1. Prepare an asset inventory JSON using [assets-format.md](references/assets-format.md).
2. Choose inclusive completed bar-close UTC bounds (`--start-close`, `--end-close`) and run:

```bash
aq-python scripts/fetch_binance_hourly.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start-close 2025-01-01T01:00:00Z \
  --end-close 2026-01-01T00:00:00Z \
  --feature-intervals 4h,1d \
  --terms "caller-authorized research retrieval; Binance terms apply"
```

The script paginates across the requested window, converts Binance open times to completed UTC bar-close timestamps, deduplicates, and fails closed if any expected hour is missing.

## Inspect & Ingest

1. Review `provider-audit.json` for bar count, first/last close, and zero-volume hours, and note that Spot OHLCV does not include perpetual funding rates or order-book depth.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source binance-spot \
     --json
   ```
