---
name: fetch-nikkei-ohlcv
description: Fetch a recent (~1 month) raw daily OHLCV sample for Tokyo-listed equities (`XTKS`) from Nikkei via `aq-python` for short-window checks or freshness verification.
---

# Fetch Nikkei OHLCV

Fetch recent (~1 month) displayed raw JPY daily OHLCV for Tokyo-listed (`XTKS`) equities from Nikkei. For multi-year Japanese equity history, use `$fetch-yahoo-ohlcv` (`.T`) or caller-supplied JPX/J-Quants data.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Request a completed range within the trailing displayed month:

```bash
aq-python scripts/fetch_nikkei_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --request-delay 1 \
  --terms "caller-authorized research retrieval; Nikkei terms apply"
```

## Inspect & Ingest

1. Check `provider-audit.json` for the page as-of timestamp, resolved dates, and raw OHLCV coverage.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source nikkei-raw \
     --json
   ```
