---
name: fetch-euronext-ohlcv
description: Fetch official Euronext Live historical daily OHLCV (up to 2 years, raw or provider-adjusted) for Euronext Paris (`XPAR`) EUR equities via `aq-python`.
---

# Fetch Euronext OHLCV

Fetch official completed daily EUR OHLCV for Euronext Paris (`XPAR`) equities within Euronext Live's displayed two-year download window (use `$fetch-yahoo-ohlcv` `.PA` when longer multi-year history is needed).

## Fetch

1. Prepare [assets-format.md](references/assets-format.md) with verified ISINs.
2. Keep the range within the trailing two-year limit and run:

```bash
aq-python scripts/fetch_euronext_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --adjustment raw \
  --panel observed-only \
  --request-delay 1 \
  --terms "caller-authorized research retrieval; Euronext terms apply"
```

Pass `--adjustment provider-adjusted` when Euronext Live's corporate-action-adjusted series is preferred over `raw`.

## Inspect & Ingest

1. Review `provider-audit.json` for ISIN verification, date coverage, and omitted rows.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source euronext-xpar \
     --json
   ```
