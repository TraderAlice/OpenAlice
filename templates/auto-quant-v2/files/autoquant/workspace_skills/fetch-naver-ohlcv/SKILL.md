---
name: fetch-naver-ohlcv
description: Acquire bounded provider-adjusted completed daily OHLCV for named South Korean equities from Naver Finance's observable historical route, preserve exact response text, validate its Korean table schema, and emit an auditable AutoQuant staging package. Use as an independent Korean route when comparing Yahoo .KS or .KQ history without claiming equivalent adjustment semantics.
---

# Fetch Naver OHLCV

Use Naver Finance as an observable South Korean provider route, not KRX venue,
calendar, adjustment, or licensing authority.

## Workflow

1. Read `$acquire-market-ohlcv` and its South Korea reference.
2. Prepare [assets-format.md](references/assets-format.md).
3. Run:

```bash
aq-python scripts/fetch_naver_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Naver and KRX terms apply"
```

The initial route supports provider-adjusted KRW equity daily bars and preserves
provider volume as shares. Samsung history is visibly back-adjusted across its
2018 split, but Naver does not establish a complete adjustment methodology;
never relabel this route as raw, split-only, or dividend-adjusted. Naver may
emit a no-trade placeholder with zero open, high,
low, and volume but a positive carried close. The script retains the exact raw
row, omits only that exact shape from normalized observed history, and records
every omission. Historical split-adjusted integer rounding may also put close
exactly one KRW outside high/low; the script expands only that violated bound
by at most one KRW and audits the raw and normalized values. Any other
nonpositive-price shape or larger bound violation still fails closed.

## Verify

- Inspect exact raw hashes, Korean header mapping, ranges, row counts, and CSV
  hashes.
- Inspect `nonTradingPlaceholders`, including every raw date and affected
  asset; do not treat an omitted placeholder as an observed trading session.
- Inspect `roundedBounds`; every normalized high/low must differ from the raw
  provider value by no more than one KRW.
- Independently verify security/board identity.
- Compare the same provider-adjusted observations with `$fetch-yahoo-ohlcv`, including
  freshness and suspension gaps, but do not compare prices as adjustment-
  equivalent.
- Run `$package-autoquant-ohlcv` and strict intake.

Stop rather than changing symbols, adjustment claims, or sources when the endpoint
blocks, changes its table, truncates history, or returns ambiguous rows.
