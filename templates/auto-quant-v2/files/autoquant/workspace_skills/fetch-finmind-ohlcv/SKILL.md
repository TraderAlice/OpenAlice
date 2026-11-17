---
name: fetch-finmind-ohlcv
description: Fetch multi-year raw completed daily OHLCV for Taiwan-listed equities from FinMind `TaiwanStockPrice` via `aq-python`, omitting zero-volume placeholders and checking traded money.
---

# Fetch FinMind Taiwan OHLCV

Fetch raw TWD daily OHLCV for Taiwan-listed equities via FinMind's `TaiwanStockPrice` endpoint when a fast multi-year panel is needed.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose completed daily sessions and run:

```bash
aq-python scripts/fetch_finmind_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; FinMind terms apply"
```

The script omits all-zero no-trade provider placeholders from the normalized CSV (recording them in `provider-audit.json`) and checks traded money against OHLC bounds.

## Inspect & Ingest

1. Review `provider-audit.json` for coverage, omitted no-trade placeholders, and traded-money diagnostics.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source finmind-raw \
     --json
   ```
