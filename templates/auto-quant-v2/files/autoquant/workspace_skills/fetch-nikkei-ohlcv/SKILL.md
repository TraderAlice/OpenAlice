---
name: fetch-nikkei-ohlcv
description: Acquire a bounded recent raw daily OHLCV sample for named Tokyo-listed equities from Nikkei's displayed one-month four-price history, preserve exact HTML and page as-of evidence, resolve yearless Japanese session labels conservatively, and emit an auditable AutoQuant staging package. Use as a recent independent Japanese route for freshness and overlap checks when Yahoo's broader delayed history is not enough.
---

# Fetch Nikkei OHLCV

Use Nikkei's displayed recent history as a narrow independent route, not as
JPX authority or a long-history API. The page currently describes itself as
one month of four-price history.

## Workflow

1. Read `$acquire-market-ohlcv` and its Japan reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Request only a recent completed range contained by the displayed month.
4. Run:

```bash
aq-python scripts/fetch_nikkei_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --request-delay 1 \
  --terms "caller-authorized research retrieval; Nikkei terms apply"
```

The script preserves exact HTML, identifies the Japanese OHLCV table by its
declared headers, derives years from the page's explicit as-of date, and uses
the unadjusted OHLC and displayed share volume. It does not construct adjusted
OHLC from the page's adjusted-close-only column.

## Verify

- Inspect page as-of time, listing selector, exact response hash, resolved
  dates, row coverage, and normalized hashes.
- Compare the recent overlap with another independent route, but do not call
  Nikkei raw and Yahoo split-adjusted equivalent contracts.
- Run `$package-autoquant-ohlcv` and strict intake.

## Stop conditions

Stop when the requested range predates the displayed table, the page is stale,
the listing selector is ambiguous, the table shape changes, or the page blocks
automated access. Never synthesize years, old pages, or adjusted OHLC beyond
the bounded rules in the script.
