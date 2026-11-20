---
name: fetch-eastmoney-ohlcv
description: Fetch raw completed daily OHLCV for Mainland China equities and funds (`XSHG`, `XSHE`, `XBSE`) from Eastmoney via `aq-python`, converting lots to shares with an amount/VWAP check.
---

# Fetch Eastmoney OHLCV

Fetch raw (`fqt=0`, CNY) completed daily OHLCV for `XSHG`, `XSHE`, or `XBSE` equities and ETFs/funds.

## Fetch

1. Prepare an asset inventory JSON using [assets-format.md](references/assets-format.md).
2. Choose an `--end-exclusive` date excluding any forming session and run:

```bash
aq-python scripts/fetch_eastmoney_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Eastmoney and exchange terms apply"
```

The script converts Eastmoney `f56` volume from 100-share lots to shares and checks that `f57` turnover divided by converted shares lies within `[low, high]`. Prefer `--panel observed-only` so individual trading suspensions do not truncate other symbols.

## Inspect & Ingest

1. Check `provider-audit.json` for date coverage, suspension gaps, and lot-conversion checks. If Eastmoney throttles or closes the connection, switch explicitly to `$fetch-sina-ohlcv`, `$fetch-sohu-ohlcv`, or `$fetch-tencent-ohlcv` rather than mixing partial files.
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source eastmoney-raw \
     --json
   ```
