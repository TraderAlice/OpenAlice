---
name: fetch-eastmoney-ohlcv
description: Acquire bounded raw completed daily OHLCV for named mainland China listed equities or funds from Eastmoney's observable historical K-line route, preserve exact response bytes, convert reported lots to shares with an amount-derived audit, and emit an AutoQuant staging package. Use when the market router selects Eastmoney for XSHG, XSHE, or XBSE research or when comparing it with an independent mainland source.
---

# Fetch Eastmoney OHLCV

Treat Eastmoney as one observable provider route, not exchange authority. Its
historical endpoint is undocumented for this use, can throttle or return an
empty response, and its terms restrict reuse of exchange market data. Never
hide those limitations behind a generic “A-share supported” claim.

## Prepare

1. Read `$acquire-market-ohlcv` and
   `references/cn-a-shares.md`.
2. Create an asset inventory using
   [assets-format.md](references/assets-format.md).
3. Select a bounded end-exclusive range containing only completed sessions.
4. Read and record the applicable Eastmoney and exchange terms. The script
   requires a caller-supplied terms statement and does not grant
   redistribution rights.

## Fetch

Run:

```bash
aq-python scripts/fetch_eastmoney_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --panel observed-only \
  --terms "caller-authorized research retrieval; Eastmoney and exchange terms apply"
```

Use the Skill's absolute script path outside this directory. The output must
be absent or empty. Initial scope is deliberately narrow:

- caller-verified listed equities or funds on declared `XSHG`, `XSHE`, or
  `XBSE`;
- raw completed daily prices (`fqt=0`);
- CNY;
- Eastmoney `f56` volume converted from lots to shares by multiplying by 100.

The script retains `f57` amount and verifies that amount divided by converted
shares lies inside that row's low/high range. It stops if this unit check
fails. The evidence is empirical provider-response consistency, not an
official Eastmoney schema guarantee.

Choose `--panel aligned` only when the research question requires a common
intersection and the lost suspension/listing rows are acceptable. Prefer
`observed-only` for a truthful ragged Factor panel.

## Verify

- Inspect `provider-audit.json`, exact raw-response hashes, declared/provider
  identifiers, row losses, amount-derived VWAP checks, and CSV hashes.
- Check the code-to-venue mapping independently; Eastmoney's numeric market
  prefix does not authenticate an ISO venue.
- Compare the same raw date range against an independent route such as Yahoo.
- Invoke `$package-autoquant-ohlcv` and strict Project intake. Do not copy
  generated CSVs directly into a Project.

## Stop conditions

Stop and record the route as degraded when the host closes the connection,
rate-limits, changes its fields, omits the requested history, or fails the
amount/volume unit check. Do not silently switch endpoints, adjustments,
symbols, or sources.
