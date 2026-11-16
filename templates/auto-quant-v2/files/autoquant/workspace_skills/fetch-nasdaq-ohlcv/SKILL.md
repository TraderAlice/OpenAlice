---
name: fetch-nasdaq-ohlcv
description: Acquire bounded split-adjusted completed U.S. daily OHLCV for named equities and ETFs from Nasdaq.com's historical-quotes route, preserve exact responses, normalize display-formatted prices and share volume, and emit an auditable AutoQuant staging package. Use as an independent U.S. route when comparing Yahoo with Nasdaq-displayed history.
---

# Fetch Nasdaq OHLCV

Use Nasdaq.com's historical-quotes surface as an independent provider route.
It is not proof that a security's primary venue is Nasdaq, and it is not the
credentialed Nasdaq Data Link Bars product.

## Workflow

1. Read `$acquire-market-ohlcv` and its U.S. reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Choose a bounded split-adjusted daily range and record applicable terms.
4. Run:

```bash
aq-python scripts/fetch_nasdaq_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel aligned \
  --terms "caller-authorized research retrieval; Nasdaq terms apply"
```

The script requests at most 5,000 displayed observations per symbol and fails
if the response declares more records than were returned or appears to omit
either range boundary. A row containing display `N/A` is omitted as a complete
observation and counted in the audit; it is never coerced to zero.

Choose panel semantics from the research contract, not from provider
convenience:

- use `--panel aligned` for fixed Event, Book Risk, Allocation, Portfolio, and
  RL intake; the script intersects sessions, records per-asset row loss, and
  emits an aligned V1 package;
- use `--panel observed-only` for Factor research that must preserve genuinely
  ragged listing histories or missing sessions; it emits V4 and is not an
  interchangeable fixed-Lab package.

A provider route can succeed under either mode. Do not choose V4 merely
because the source observations happen to be fully aligned after retrieval.

## Verify

- Inspect raw hashes, declared total records, response status, display-number
  normalization, coverage, and CSV hashes.
- Compare the same split-adjusted assets/dates against `$fetch-yahoo-ohlcv`.
- Verify venue and instrument identity independently; `assetclass=stocks` or
  `etf` is a request parameter, not listing authority.
- Run `$package-autoquant-ohlcv` and strict intake.

## Stop conditions

Stop on blocking, throttling, response-shape changes, ambiguous currency,
unsupported instruments, history truncation, or dividend-adjustment
requirements. Never relabel this split-adjusted display history as
exchange-unadjusted raw data.
