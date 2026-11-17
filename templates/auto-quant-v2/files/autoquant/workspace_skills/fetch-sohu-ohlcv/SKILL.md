---
name: fetch-sohu-ohlcv
description: Fetch raw completed daily OHLCV for `XSHG`, `XSHE`, or `XBSE` equities and funds from Sohu Finance via `aq-python`, converting lots to shares and checking traded value against OHLC.
---

# Fetch Sohu OHLCV

Fetch raw Mainland China daily OHLCV (including post-migration Beijing `920` symbols) from Sohu Finance, converting reported lots to shares (`×100`) and validating against traded value.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md) with explicit `equity` or `fund` classes.
2. Choose completed daily sessions and run:

```bash
aq-python scripts/fetch_sohu_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Sohu terms apply"
```

## Inspect & Ingest

1. Check `provider-audit.json` for date coverage, lot-to-share conversion, and traded-value consistency checks.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source sohu-raw \
     --json
   ```
