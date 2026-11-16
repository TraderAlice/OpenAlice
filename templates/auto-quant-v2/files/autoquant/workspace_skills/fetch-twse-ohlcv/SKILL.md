---
name: fetch-twse-ohlcv
description: Acquire bounded raw completed daily OHLCV for named TWSE-listed equities from the official TWSE monthly historical report, preserve exact success or failure responses, normalize ROC dates and numeric separators, and emit an auditable AutoQuant staging package. Use as the venue-authoritative Taiwan route before same-raw comparison with FinMind; use Yahoo only for explicitly different split-adjusted coverage context.
---

# Fetch TWSE OHLCV

Use the official TWSE historical report for `TWSE`-listed equities. This Skill
does not cover TPEx, real-time data, a redistribution licence, or corporate
action adjustment.

## Workflow

1. Read `$acquire-market-ohlcv` and its Taiwan reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Choose completed daily sessions and obtain the applicable TWSE data-use
   basis.
4. Run:

```bash
aq-python scripts/fetch_twse_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --request-delay 3 \
  --terms "caller-authorized research retrieval; TWSE terms apply"
```

The script makes one official monthly request per asset/month, preserves each
response, converts ROC calendar dates to Gregorian dates, and retains official
trade volume as shares. Keep the default three-second request delay unless
current official guidance justifies another value; the CDN has returned
security redirects under bursty access. It fails on HTML security pages,
response-shape changes, ambiguous fields, or suspected range truncation. On a
failed monthly request it writes `provider-failure.json`, a bounded
`request-attempts/.../request-attempts.json` receipt, and any exact HTTP error
body before returning nonzero. Use the common route-attempt wrapper as well so
the provider-specific receipt and standard process failure remain together.

## Verify

- Inspect all monthly response hashes, field declarations, missing months,
  date conversion, price/volume invariants, and final CSV hashes.
- Compare the same raw sessions with `$fetch-finmind-ohlcv`. Record freshness,
  price differences, volume agreement, traded-money checks, and missing
  observations without calling FinMind exchange truth.
- Use `$fetch-yahoo-ohlcv` only for explicitly split-adjusted coverage or
  freshness context, and compare it in coverage-only mode. Do not use Yahoo as
  the same-raw peer.
- Run `$package-autoquant-ohlcv` and strict intake.
- Keep `TWSE` explicit. Never claim that this route covers `TPEx`.

## Stop conditions

Record the official route as degraded when TWSE returns its security block,
throttles the caller, or omits the requested history. Do not proxy through an
unidentified mirror or silently replace it with FinMind or Yahoo. Preserve the
generated provider and route failure receipts; do not manually probe the same
blocked request merely to reconstruct evidence the script already recorded.
