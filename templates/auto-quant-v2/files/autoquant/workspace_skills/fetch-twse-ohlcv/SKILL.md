---
name: fetch-twse-ohlcv
description: Fetch official TWSE monthly raw daily OHLCV for TWSE-listed Taiwan equities via `aq-python`, converting ROC calendar dates and share volumes cleanly for `aq data ingest`.
---

# Fetch TWSE OHLCV

Fetch raw completed daily OHLCV for `TWSE`-listed equities (not `TPEx`) from the official TWSE monthly historical report.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose completed daily sessions and run (keep `--request-delay 3` to avoid TWSE CDN rate-limit blocks):

```bash
aq-python scripts/fetch_twse_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --request-delay 3 \
  --terms "caller-authorized research retrieval; TWSE terms apply"
```

The script retrieves one monthly report per symbol/month, converts ROC calendar dates to Gregorian `YYYY-MM-DD`, preserves share volume, and fails closed if TWSE returns an HTML security redirect. For multi-year panels where monthly throttling is prohibitive, consider `$fetch-finmind-ohlcv` (raw) or `$fetch-yahoo-ohlcv` (`.TW`, split/dividend-adjusted).

## Inspect & Ingest

1. Review `provider-audit.json` for monthly coverage, ROC date conversion, and OHLCV invariants.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source twse-official-raw \
     --json
   ```
