---
name: fetch-naver-ohlcv
description: Fetch provider-adjusted completed daily OHLCV (KRW, shares) for South Korean equities (`XKRX`) from Naver Finance via `aq-python`, omitting no-trade placeholders cleanly.
---

# Fetch Naver OHLCV

Fetch provider-adjusted KRW daily OHLCV for South Korean equities (`XKRX`) from Naver Finance.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose completed daily sessions and run:

```bash
aq-python scripts/fetch_naver_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Naver and KRX terms apply"
```

Naver back-adjusts historical prices across splits; zero-volume no-trade placeholders (`open=high=low=volume=0` with carried close) are omitted automatically and logged under `nonTradingPlaceholders` in `provider-audit.json`, while 1-KRW integer rounding bounds are normalized and audited under `roundedBounds`.

## Inspect & Ingest

1. Review `provider-audit.json` (`nonTradingPlaceholders`, `roundedBounds`, and date range).
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source naver-adjusted \
     --json
   ```
