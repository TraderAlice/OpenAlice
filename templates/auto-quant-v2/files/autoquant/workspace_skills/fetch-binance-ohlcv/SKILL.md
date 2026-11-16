---
name: fetch-binance-ohlcv
description: Acquire bounded closed paginated Binance Spot public K-lines, preserve exact request and file hashes, verify a continuous UTC bar-close grid, and emit an auditable AutoQuant V2 staging package. Use for continuous crypto OHLCV research when Binance Spot is an authorized provider route.
---

# Fetch Binance OHLCV

Use the public Spot K-line route for bounded research input. Keep provider
instrument identity, quote asset, access terms, and venue claims explicit.

## Prepare

1. Read `$acquire-market-ohlcv` and
   [assets-format.md](references/assets-format.md).
2. Choose inclusive first and last completed bar-close timestamps in UTC.
3. State the exact higher feature intervals AutoQuant should derive.
4. Pass the applicable access/terms understanding explicitly.

## Fetch

```bash
aq-python scripts/fetch_binance_hourly.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start-close 2025-01-01T01:00:00Z \
  --end-close 2026-01-01T00:00:00Z \
  --feature-intervals 3h,4h,6h,12h,1d \
  --terms "caller-authorized research retrieval; Binance terms apply"
```

The output directory must be absent or empty. The script paginates with an
explicit range, converts provider open times to nominal bar-close timestamps,
deduplicates, and rejects any missing or extra hour.

## Verify and hand off

- Inspect the exact request window, returned count, first/last close,
  duplicates, zero-volume rows, and file hashes in `provider-audit.json`.
- Confirm every provider symbol and quote currency.
- Invoke `$package-autoquant-ohlcv` and strict Project intake.
- Do not infer order-book liquidity, futures funding, margin, fill, Broker, or
  account authority from Spot OHLCV.
