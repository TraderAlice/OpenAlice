---
name: fetch-sohu-ohlcv
description: Acquire bounded raw completed daily OHLCV for named XSHG, XSHE, or XBSE listed equities or funds from Sohu Finance's observable historical-quotes route, preserve exact JSONP bytes and request evidence, convert provider lots to shares, check traded value against OHLC, and emit an auditable AutoQuant staging package. Use as an independent mainland-China raw route, especially for validating post-migration Beijing 920 symbols against Sina.
---

# Fetch Sohu OHLCV

Use Sohu as an observable provider route, not exchange authority or a
documented redistribution contract.

## Workflow

1. Read `$acquire-market-ohlcv` and its mainland-China reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Choose a bounded completed daily range.
4. Run:

```bash
aq-python scripts/fetch_sohu_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Sohu terms apply"
```

The script preserves the exact GB18030 JSONP response, verifies the echoed
provider code and requested date bounds, maps raw OHLC, converts provider lots
to shares, and uses reported traded value as an internal consistency check.
The inventory's caller-verified `equity` or `fund` class is preserved in the
package; Sohu's provider code does not establish instrument class.

## Verify

- Inspect exact bytes, response metadata, source range, conversion audit, and
  hashes.
- Compare the same raw assets and dates with `$fetch-sina-ohlcv` or
  `$fetch-tencent-ohlcv`.
- Treat price and volume agreement as separate findings.
- Run `$package-autoquant-ohlcv` and strict intake.

## Stop conditions

Stop on response-shape changes, provider error status, ambiguous symbol/venue
mapping, stale or truncated history, contradictory traded value, or access
blocking. Do not relabel Sohu raw prices as adjusted.
