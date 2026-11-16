---
name: fetch-daum-ohlcv
description: Acquire bounded raw completed daily OHLCV for named South Korean equities from Daum Finance's paginated daily-history route, preserve exact JSON and pagination evidence, validate Korean symbol identities and share-volume fields, and emit an auditable AutoQuant staging package. Use as an independent raw Korean route for comparison with Naver.
---

# Fetch Daum OHLCV

Use Daum as an observable provider route, not KRX authority or a documented
redistribution contract.

## Workflow

1. Read `$acquire-market-ohlcv` and its South Korea reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Choose a bounded completed daily range.
4. Run:

```bash
aq-python scripts/fetch_daum_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Daum terms apply"
```

The script requests enough reverse-chronological rows in pages of at most
1,000, preserves every page, verifies page identity and total counts, and maps
`openingPrice`, `highPrice`, `lowPrice`, `tradePrice`, and `accTradeVolume`.
It also records `accTradePrice / accTradeVolume` as a diagnostic. Daum does not
establish that those aggregates use the exact same session scope as daily
OHLC, so an out-of-range ratio neither repairs nor invalidates otherwise valid
OHLCV.

## Verify

- Inspect exact pages, status, source range, price/volume invariants, and
  hashes.
- Inspect `valueVolume`, including every out-of-range derived ratio and its
  distance from the nearest OHLC bound; treat it as provider-scope evidence,
  not a synthetic price.
- Compare the same raw assets and dates with `$fetch-naver-ohlcv`.
- Verify KOSPI/KOSDAQ listing identity independently; this first proof uses
  the exact `XKRX` label as a broad venue claim.
- Run `$package-autoquant-ohlcv` and strict intake.

## Stop conditions

Stop on response-shape changes, pagination inconsistency, stale or truncated
history, ambiguous symbol mapping, or access blocking. Do not relabel Daum
raw prices as adjusted.
