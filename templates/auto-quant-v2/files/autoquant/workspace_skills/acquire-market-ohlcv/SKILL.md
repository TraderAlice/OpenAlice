---
name: acquire-market-ohlcv
description: Route historical OHLCV acquisition for AutoQuant by market, venue, interval, history, adjustment, freshness, credentials, and provider limitations. Use when an Agent must obtain, refresh, compare, or troubleshoot stock, ETF, futures-proxy, or crypto K-lines for U.S., mainland China A-share, Japanese, South Korean, Taiwanese, Vietnamese, or named European venue research.
---

# Acquire Market OHLCV

Turn a bounded research-data need into one auditable staging package. Keep
provider network behavior outside AutoQuant Core and admit bytes only through
strict Project intake.

Run every bundled Python Skill script with `aq-python`, not an ambient
`python` or `python3`. `aq-python` deliberately selects the interpreter and
dependencies that own the installed AutoQuant Harness, even when an Agent's
login shell rewrites `PATH`. Do not install missing packages into a system or
user Python to make a bundled Skill run.

## Route the request

1. Clarify the research market and exact venue, instruments, completed-bar
   interval, inclusive observation window, adjustment meaning, currency,
   required freshness, and whether ragged observations are acceptable.
2. Read [common-acquisition-checklist.md](references/common-acquisition-checklist.md).
3. Read exactly one relevant market reference:
   - U.S.: [us-equities.md](references/us-equities.md)
   - mainland China A shares: [cn-a-shares.md](references/cn-a-shares.md)
   - Japan: [japan-equities.md](references/japan-equities.md)
   - South Korea: [south-korea-equities.md](references/south-korea-equities.md)
   - Taiwan: [taiwan-equities.md](references/taiwan-equities.md)
   - Vietnam: [vietnam-equities.md](references/vietnam-equities.md)
   - European Union venues: [eu-equity-venues.md](references/eu-equity-venues.md)
4. Select between at least two independently usable sources when the market
   reference has proved them. Compare freshness, history, adjustment, venue
   authority, credentials, limits, and returned data quality. Do not always
   prefer the broadest source.
   Do not claim cross-source price agreement unless both packages declare the
   same adjustment semantics; source plurality and semantic equivalence are
   separate findings.
5. Invoke the exact provider Skill named by the selected route. Use
   `$fetch-yahoo-ohlcv` or `$fetch-binance-ohlcv` only when their documented
   contract fits. Do not improvise an unproved provider route as accepted
   coverage.
   Wrap independently attempted provider commands when failure evidence is
   material:

   ```bash
   aq-python scripts/run_route_attempt.py \
     --provider <provider-id> \
     --write-failure <workspace>/staging/market-data/<route>/route-failure.json \
     -- aq-python /absolute/path/to/provider-script.py <arguments>
   ```

   A successful provider command writes its ordinary package/audit and no
   failure file. A nonzero or unlaunchable command preserves one bounded
   standard failure record and returns the original failure status; never
   handwrite a substitute success package.
6. Invoke `$package-autoquant-ohlcv` to inspect, package, and strictly intake
   the acquired bytes.

## Preserve the boundary

- Write acquisition output under
  `staging/market-data/<dataset-id>/`, never directly into `projects/`.
- Keep the executed acquisition script, raw response or closest available raw
  evidence, normalized source CSVs, provider audit, and dataset manifest.
- Record the original provider retrieval time only when this acquisition
  knows it. Never substitute Project, packaging, or filesystem time.
- Treat provider symbol lookup, metadata, adjustment, calendar, and venue as
  external claims until independently checked.
- Do not fill closures, suspensions, or missing observations merely to create
  a rectangular panel.
- Stop truthfully when no route satisfies the requested semantics. Changing
  adjustment, interval, venue, or history to make a downloader succeed changes
  the research input and requires caller approval.

## Finish

Return the chosen and rejected routes, exact acquisition window, provider and
Skill identities, raw and normalized hashes, package path, intake/Project
identity when created, observed limitations, and `tradingAuthority: none` in
substance.
