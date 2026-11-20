---
name: fetch-nasdaq-ohlcv
description: Fetch split-adjusted completed U.S. daily OHLCV (up to 5,000 sessions per symbol) for equities and ETFs from Nasdaq.com historical quotes via `aq-python`, ready for `aq data ingest`.
---

# Fetch Nasdaq OHLCV

Fetch split-adjusted U.S. daily OHLCV from Nasdaq.com's historical-quotes endpoint (distinct from credentialed Nasdaq Data Link Bars) when `alice market bars` / `aq data fetch` or Yahoo is unavailable or needs cross-checking.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose completed daily sessions (up to 5,000 sessions per symbol) and run:

```bash
aq-python scripts/fetch_nasdaq_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Nasdaq terms apply"
```

The script normalizes formatted price/share-volume strings, omits any `N/A` display rows in `provider-audit.json` (never coercing them to zero), and fails if the endpoint truncates the requested date span. Note that Nasdaq historical quotes are **split-adjusted** (not dividend-adjusted and not exchange-raw).

## Inspect & Ingest

1. Review `provider-audit.json` for record counts, omitted `N/A` rows, and date range completeness.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source nasdaq-split-adjusted \
     --json
   ```
