---
name: fetch-yahoo-ohlcv
description: Acquire bounded completed daily or strict XNYS 1h OHLCV from Yahoo Finance Chart, preserve raw JSON and metadata, enforce explicit adjustment and timestamp semantics, and emit either an auditable AutoQuant staging package or durable no-authority evidence. Use when the market router selects Yahoo as one broad historical source or when comparing Yahoo against a venue-authoritative provider.
---

# Fetch Yahoo OHLCV

Use Yahoo as one broad, delayed, unauthenticated provider route. Do not treat
successful Chart output as official venue, calendar, adjustment, or
redistribution authority.

## Prepare

1. Read `$acquire-market-ohlcv` and its relevant market reference first.
2. Create an asset file as described in
   [assets-format.md](references/assets-format.md).
3. Choose an end-exclusive local session date that excludes forming bars.
4. Obtain and preserve the applicable terms/access understanding. Pass it
   explicitly; the script does not invent a legal claim.

## Choose daily or XNYS 1h

Use the daily procedure for completed session observations and V1/V4 packages.
Use the intraday procedure only for an aligned U.S. equity/ETF question whose
base contract is XNYS regular-session `1h`, split-adjusted OHLCV, and one or
more completed higher feature intervals. Do not use it for extended hours, a
non-XNYS clock, dividend-adjusted intraday OHLC, or observed-only V5.

Yahoo's two surfaces have different limits and timestamp meanings. Selecting
the script is part of the fixed research-data contract, not a fallback after
seeing the response.

## Fetch daily

Run:

```bash
aq-python scripts/fetch_yahoo_daily.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --calendar XNYS \
  --timezone America/New_York \
  --adjustment split-and-dividend-adjusted \
  --panel aligned \
  --terms "caller-authorized research retrieval; Yahoo terms apply"
```

Use the Skill's absolute `scripts/fetch_yahoo_daily.py` path when running from
outside this folder. The output directory must be absent or empty.

Yahoo's `period1`/`period2` behavior is not trusted as the final session-date
boundary outside U.S. timezones. The script always applies the requested
Gregorian `[start, end-exclusive)` filter again after parsing and records any
out-of-range rows it removed.

Session dates are derived only after converting each timestamp to Yahoo's
returned `exchangeTimezoneName`; UTC calendar dates are not treated as local
session dates.

Choose `--panel observed-only` only for a compatible Factor-only V4 intake.
For a cross-market date-only package, use the neutral top-level container claim
`--calendar provider-observed --timezone UTC`; each asset's actual session date
still comes from Yahoo's returned exchange timezone and remains visible in the
provider audit. That V4 package does not yet claim exact close instants. Invoke
`$package-autoquant-ohlcv`, supply explicit per-asset calendar authority, and
run its `materialize_daily_close_time.py` procedure before V5 intake. Never use
one asset's calendar/timezone as the top-level claim for a mixed-market package.

Choose `--adjustment split-adjusted` to preserve Yahoo's historical quote
OHLC. These are not exchange-unadjusted prices: Yahoo back-adjusts historical
quotes for split-like corporate actions. For
`split-and-dividend-adjusted`, the script additionally multiplies every OHLC
field by `adjusted_close / raw_close` and leaves provider volume unchanged.

The default `--invalid-ohlc-policy reject` fails closed if Yahoo returns a row
whose high/low cannot contain its open and close. For price-only research, the
caller may explicitly authorize `--invalid-ohlc-policy drop-observation` when
an isolated provider rounding defect is preferable to abandoning the complete
task panel. That policy never clamps or repairs a price. It retains the raw
JSON and the exact removed date/OHLCV in `provider-audit.json`, and aborts when
the anomaly count exceeds the ceiling of 0.1% of normalized source rows, with
a minimum allowance of one isolated row and a maximum of 10 per asset. With an
aligned panel, inspect the final `outputRows`: removing one asset-date also
removes that date from the common panel for every asset.
The command result and top-level `provider-audit.json.invalidOhlc` projection
summarize every affected canonical asset and removed observation. Use that
projection before drilling into the matching per-asset records; an aligned
panel can lose one shared date even when more than one asset had an invalid
observation on that date.

The separate default `--transient-scale-policy reject` also fails closed when
the provider emits a short one-to-three-row price-scale island: a fivefold or
larger entry jump, the opposite fivefold or larger exit jump, and recovery
within 25% below or one-third above the pre-island close. This catches bounded
temporary decimal/unit discontinuities without pretending that every large
return is bad data. When raw provider evidence and the research contract make
observation removal preferable, explicitly pass
`--transient-scale-policy drop-observation`. It never rescales prices. It
retains every original row in raw JSON and exact OHLCV plus boundary ratios in
top-level `provider-audit.json.transientScale` and the per-asset audit, and it
uses the same 0.1%-of-source, minimum-one, maximum-10 bound per asset. A
persistent split or regime change that does not quickly reverse is not removed
by this policy and still requires separate provider/corporate-action evidence.

## Fetch strict XNYS 1h

Run:

```bash
aq-python scripts/fetch_yahoo_intraday.py \
  --output <workspace>/staging/market-data/<dataset-id> \
  --assets /absolute/path/assets.json \
  --dataset-id <dataset-id> \
  --start YYYY-MM-DD \
  --end-exclusive YYYY-MM-DD \
  --calendar XNYS \
  --timezone America/New_York \
  --interval 1h \
  --feature-interval 1d \
  --adjustment split-adjusted \
  --panel aligned \
  --terms "caller-authorized research retrieval; Yahoo terms apply"
```

Repeat `--feature-interval` only for fixed selections from `3h`, `4h`, `6h`,
and `1d`. The script emits a V3 package only after every asset contains the
same exact complete XNYS panel.

Yahoo labels historical hourly rows by provider bucket **start**. AutoQuant V3
requires completed bar **close**. The procedure maps every expected provider
start to `min(start + 1h, scheduled session close)` using the pinned XNYS
calendar. It does not change OHLCV values. This includes the final half-hour of
a normal session and the short terminal bucket of an early close.

The request begins one hour before the first scheduled open. Live probes show
that beginning exactly at the first bucket can preserve price while returning
zero first-bucket volume. The warmup is filtered out after parsing, but it also
counts against Yahoo's observed trailing 730-day `1h` limit. The script records
its local eligibility estimate; Yahoo's actual response remains final.

HTTP success is not data authority. Yahoo can emit null expected rows,
ordinary-session gaps, an early-close null terminal bucket, or a zero-volume
session-close marker whose OHLC resembles a wider period. The procedure never
relabels that marker as the missing terminal bar. It also rejects duplicates,
unexpected in-session timestamps, invalid OHLC, negative volume, wrong
timezone/granularity metadata, incomplete sessions, and panel mismatch.

On success, inspect `provider-audit.json`, normalized CSVs, and
`dataset-package.json`. On any range, response, asset, session, or panel
failure, inspect `provider-failure.json` and retained raw responses. A failed
route returns nonzero and creates no dataset package. Do not handwrite a
success manifest from its partial bytes.

Yahoo intraday Chart does not expose adjusted close. This procedure supports
only provider quote OHLC treated as split-adjusted and leaves provider volume
unchanged. It does not claim dividend-adjusted prices, official venue data, or
independent hourly peer confirmation.

## Verify

- Inspect `provider-audit.json`, every raw JSON hash, every CSV hash, returned
  instrument metadata, source/normalized ranges, dropped rows, and alignment.
- If `drop-observation` was selected, disclose why it was authorized and cite
  every item in top-level `invalidOhlc.observations`, then reconcile it with
  the per-asset `invalidOhlcBoundsObservations`; do not describe the resulting
  panel as repaired provider history.
- If transient-scale removal was selected, disclose every item in top-level
  `transientScale.observations`, the entry/exit/recovery ratios, why the route
  was accepted, and the common-panel dates lost. Never describe removal as a
  verified split adjustment or silently replace it with rescaled prices.
- Spot-check provider symbols and venue identity outside the Chart response.
- Compare a bounded overlap against the market's second source when that peer
  covers the same interval and adjustment. Nasdaq's bundled daily route is not
  an hourly peer.
- Invoke `$package-autoquant-ohlcv`; do not move generated CSVs directly into
  a Project.

## Stop conditions

Stop rather than silently changing the task when Yahoo lacks the requested
history, interval, symbol, adjusted close, completed bar, exact XNYS session,
or credible venue mapping. Record range rejection, rate limiting, response
errors, null/gap evidence, or freshness gaps as provider evidence.
