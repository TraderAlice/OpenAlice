---
name: fetch-vndirect-ohlcv
description: Acquire bounded completed daily OHLCV for named HOSE, HNX, or UPCoM equities from VNDIRECT's observable stock-prices route, preserve paginated raw JSON, convert quoted thousand-VND prices to VND with a traded-value audit, and emit an AutoQuant staging package. Use as an independent Vietnam route before comparing the same venue and adjustment with Yahoo.
---

# Fetch VNDIRECT OHLCV

Use VNDIRECT as an observable Vietnam provider route, not venue, calendar,
corporate-action, or licensing authority.

## Workflow

1. Read `$acquire-market-ohlcv` and its Vietnam reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Select raw or provider-adjusted prices explicitly.
4. Run:

```bash
aq-python scripts/fetch_vndirect_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --adjustment raw \
  --panel observed-only \
  --terms "caller-authorized research retrieval; VNDIRECT and venue terms apply"
```

The provider quotes prices in thousand VND. The script multiplies every
selected OHLC field by 1,000. For raw rows it verifies
`nmValue / nmVolume` against provider average × 1,000 before packaging.
Provider rows whose close falls outside their own low/high range are omitted
as complete observations and listed in the audit; the Skill never repairs
them.

## Verify

- Inspect raw page hashes, provider floor, pagination, price scale, value/
  volume checks, range, and CSV hashes.
- Keep HOSE, HNX, and UPCoM separate.
- Compare the same symbols, raw/adjusted claim, and dates with
  `$fetch-yahoo-ohlcv`.
- Run `$package-autoquant-ohlcv` and strict intake.

Stop on response changes, missing pages, floor mismatch, scale failure,
ambiguous adjustment, or stale/truncated coverage. Never silently change
venues or price scale.
