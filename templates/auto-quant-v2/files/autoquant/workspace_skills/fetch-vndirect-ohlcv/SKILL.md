---
name: fetch-vndirect-ohlcv
description: Fetch paginated completed daily OHLCV (raw or provider-adjusted, converted to full VND) for Vietnam `HOSE`, `HNX`, or `UPCoM` equities from VNDIRECT via `aq-python`.
---

# Fetch VNDIRECT OHLCV

Fetch completed daily OHLCV for Vietnam `HOSE`, `HNX`, or `UPCoM` equities from VNDIRECT, converting thousand-VND quotes to full VND (`×1000`) and validating against traded value/volume.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose `--adjustment raw` or `--adjustment provider-adjusted` explicitly and run:

```bash
aq-python scripts/fetch_vndirect_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --adjustment raw \
  --panel observed-only \
  --terms "caller-authorized research retrieval; VNDIRECT and venue terms apply"
```

Rows whose close falls outside `[low, high]` are omitted automatically and recorded in `provider-audit.json`.

## Inspect & Ingest

1. Check `provider-audit.json` for pagination completeness, VND scale checks, and any omitted provider anomalies.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source vndirect \
     --json
   ```
