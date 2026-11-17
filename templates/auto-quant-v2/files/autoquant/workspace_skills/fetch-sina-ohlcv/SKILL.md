---
name: fetch-sina-ohlcv
description: Fetch recent raw completed daily OHLCV (up to 1,023 sessions) for Shanghai, Shenzhen, or Beijing (`XSHG`, `XSHE`, `XBSE`) equities and funds from Sina Finance via `aq-python`.
---

# Fetch Sina OHLCV

Fetch recent raw daily OHLCV (within the trailing 1,023 trading sessions, reported in shares) for `XSHG`, `XSHE`, or `XBSE` securities, including post-migration `bj920...` Beijing codes.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md) with explicit `equity` or `fund` classes.
2. Choose completed daily sessions within the most recent 1,023 bars and run:

```bash
aq-python scripts/fetch_sina_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Sina terms apply"
```

## Inspect & Ingest

1. Verify `provider-audit.json` to ensure the returned start date was not truncated by the 1,023-bar window and that OHLC/volume invariants hold.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source sina-raw \
     --json
   ```
