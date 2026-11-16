---
name: fetch-sina-ohlcv
description: Acquire bounded recent raw completed daily OHLCV for named Shanghai, Shenzhen, or Beijing listed equities or funds from Sina Finance's observable K-line route, preserve exact JSON and status evidence, validate venue prefixes and share-volume semantics, and emit an auditable AutoQuant staging package. Use as an independent raw mainland-China route when Eastmoney is degraded or when proving XBSE symbol behavior.
---

# Fetch Sina OHLCV

Use Sina as an observable independent provider, not exchange authority. The
route returns only a bounded recent history and may change without notice.

## Workflow

1. Read `$acquire-market-ohlcv` and its mainland-China reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Keep the range within the most recent 1,023 sessions and exclude forming
   bars.
4. Run:

```bash
aq-python scripts/fetch_sina_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Sina terms apply"
```

The script requests exactly 1,023 recent daily rows per symbol, preserves the
response, reapplies the date boundary, and preserves provider volume as shares.
It preserves the caller-verified `equity` or `fund` class rather than deriving
instrument type from the six-digit code.

## Verify

- Inspect provider prefix, status, raw hash, actual returned range, OHLC
  invariants, volume ratios against another source, and final hashes.
- Verify every symbol and venue independently, especially post-migration
  `920` Beijing codes.
- Run `$package-autoquant-ohlcv` and strict intake.

## Stop conditions

Stop on truncation, stale output, nonzero status, empty data, symbol-prefix
ambiguity, or access blocking. Never silently swap raw and adjusted routes.
