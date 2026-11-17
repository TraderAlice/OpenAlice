---
name: fetch-daum-ohlcv
description: Fetch paginated raw completed daily OHLCV (KRW, shares) for South Korean equities (`XKRX`) from Daum Finance via `aq-python`, ready for `aq data ingest`.
---

# Fetch Daum OHLCV

Fetch paginated raw KRW daily OHLCV for South Korean equities (`XKRX`) from Daum Finance.

## Fetch

1. Prepare [assets-format.md](references/assets-format.md).
2. Choose completed daily sessions and run:

```bash
aq-python scripts/fetch_daum_daily.py \
  --output /tmp/aq-fetch/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Daum terms apply"
```

The script paginates up to 1,000 rows per page, validates page counts, maps raw KRW OHLC and `accTradeVolume` shares, and logs `accTradePrice / accTradeVolume` diagnostics in `provider-audit.json`.

## Inspect & Ingest

1. Review `provider-audit.json` for pagination completeness, date coverage, and raw price/volume invariants (note Daum prices are unadjusted for splits—use `$fetch-naver-ohlcv` or `$fetch-yahoo-ohlcv` when split-adjusted KRW prices are needed).
2. Ingest directly into `<project>/data/`:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source daum-raw \
     --json
   ```
