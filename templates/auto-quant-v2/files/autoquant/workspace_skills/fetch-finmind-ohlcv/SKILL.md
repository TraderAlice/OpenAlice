---
name: fetch-finmind-ohlcv
description: Acquire bounded raw completed daily OHLCV for named Taiwan-listed equities from FinMind's TaiwanStockPrice route, preserve exact JSON and request evidence, validate symbol identity, share volume, and traded money, and emit an auditable AutoQuant staging package. Use as an independently executable research-length Taiwan route and compare its overlapping raw observations with official TWSE data.
---

# Fetch FinMind Taiwan OHLCV

FinMind is an aggregator route, not TWSE authority. Keep official TWSE first
for venue evidence; use FinMind when an independently executable longer
research panel is needed.

## Workflow

1. Read `$acquire-market-ohlcv` and its Taiwan reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Choose a bounded completed daily range.
4. Run:

```bash
aq-python scripts/fetch_finmind_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; FinMind terms apply"
```

## Verify

- Inspect retained JSON, symbol/date coverage, price and volume invariants,
  traded-money checks (including any audited scope anomalies), and hashes.
- Keep an all-zero no-trade provider placeholder absent from the observed-only
  panel and inspect its audit; never forward-fill it.
- Compare raw overlap against `$fetch-twse-ohlcv`; agreement does not make
  FinMind an exchange source.
- Run `$package-autoquant-ohlcv` and strict intake.

Stop on response-shape changes, provider error status, ambiguous listing,
truncated history, unexplained widespread traded-money anomalies, or access
blocking. A small audited mismatch may reflect a broader trade scope than the
displayed OHLC and must remain visible.
