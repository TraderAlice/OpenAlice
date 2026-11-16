---
name: fetch-tencent-ohlcv
description: Acquire bounded raw completed daily OHLCV for named mainland China listed equities or funds from Tencent Finance's observable K-line route, preserve exact response bytes, convert reported lots to shares explicitly, and emit an AutoQuant staging package. Use when the market router selects Tencent as an independent XSHG or XSHE route or when comparing it against Yahoo or Eastmoney.
---

# Fetch Tencent OHLCV

Use Tencent Finance as an observable independent provider route, not official
venue, calendar, adjustment, or licensing authority.

## Workflow

1. Read `$acquire-market-ohlcv` and its mainland-China reference.
2. Prepare the exact inventory in
   [assets-format.md](references/assets-format.md).
3. Select only completed daily sessions and record the terms basis.
4. Run:

```bash
aq-python scripts/fetch_tencent_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Tencent and exchange terms apply"
```

The initial procedure accepts raw `day` rows only. It converts Tencent volume
from lots to shares by multiplying by 100 and discloses that conversion in
the audit. Confirm it against an independent shares-based route before
accepting coverage.
The asset inventory preserves a caller-verified `equity` or `fund` class; the
provider code does not infer that class.

## Verify

- Inspect exact raw hashes, provider quote metadata, output ranges, row counts,
  lot conversion, and CSV hashes.
- Reject a request if the returned first/last observation suggests the
  provider truncated the requested range.
- Compare overlapping raw prices and share volumes with the other selected
  source. Suspensions remain absent observations.
- Invoke `$package-autoquant-ohlcv` and strict intake; never write directly to
  `projects/`.

## Stop conditions

Stop on connection closure, throttling, response shape changes, ambiguous
symbols, missing requested history, or unsupported adjustment needs. Do not
silently substitute Tencent forward/backward-adjusted rows.
