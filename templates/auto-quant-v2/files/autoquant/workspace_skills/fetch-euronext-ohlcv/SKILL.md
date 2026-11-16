---
name: fetch-euronext-ohlcv
description: Acquire bounded official completed daily OHLCV for named Euronext Paris equities from Euronext Live's historical CSV download, preserve exact response bytes and displayed metadata, select explicit non-adjusted or provider-adjusted history, and emit an auditable AutoQuant staging package. Use as the venue-authoritative XPAR route before comparing the same assets with an independent broad provider such as Yahoo.
---

# Fetch Euronext OHLCV

Use Euronext Live as the official first route for named `XPAR` equities. This
initial Skill does not imply one EU calendar, cover Milan's shorter history
window, authenticate redistribution rights, or explain Euronext's adjustment
algorithm.

## Workflow

1. Read `$acquire-market-ohlcv` and its EU-venues reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Keep the request within Euronext Live's displayed two-year history limit
   and exclude forming sessions.
4. Run:

```bash
aq-python scripts/fetch_euronext_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --adjustment raw \
  --panel observed-only \
  --request-delay 1 \
  --terms "caller-authorized research retrieval; Euronext terms apply"
```

The script requests the official CSV download directly, preserves its UTF-8
bytes, verifies the displayed ISIN, parses semicolon-delimited OHLC and number
of shares, reapplies the exact date boundary, and audits `Last` versus `Close`.

## Verify

- Inspect every request URI, response header summary, raw hash, provider
  metadata line, CSV hash, date range, and omitted observation.
- Compare only the same adjustment contract with another route. Yahoo quote
  history is `split-adjusted`; Euronext `provider-adjusted` does not establish
  that the algorithms are equivalent.
- Run `$package-autoquant-ohlcv` and strict intake.
- Keep `XPAR` explicit. Do not generalize this proof to every Euronext or EU
  venue.

## Stop conditions

Stop on an HTML page, unexpected delimiter/header, ISIN mismatch, ambiguous
adjustment, stale boundary, history truncation, or access restriction. Do not
silently shorten the requested range or switch to Yahoo.
