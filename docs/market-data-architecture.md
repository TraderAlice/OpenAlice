# Market Data Architecture

This guide owns OpenAlice's market-data contracts and provider boundaries.
New features extend TraderHub, the bar service, or a typed domain contract —
never the embedded OpenBB compatibility model by default. Related:
[[docs/project-structure.md]] and [[docs/uta-live-testing.md]].

## Layers

| Layer | Primary consumers | Contract |
|---|---|---|
| TraderHub/reference data | Agents, boards, low-frequency research | `traderhub` CLI and `/api/reference/*` |
| Bar service | Charts, raw CLI exports, quant tools, snapshots | `barId`-keyed K-line federation via `/api/bars` |
| Embedded provider compatibility | Remaining fundamentals/search clients | private `@traderalice/opentypebb` + `/api/market-data-v1` |

The first two are the product architecture; the compatibility package is an
implementation detail for routes not yet migrated. Agents use the injected
CLI shims, never provider HTTP: `traderhub` owns boards, fundamentals,
macro, calendars, ETFs; `alice market` owns bar discovery and raw history;
`alice analysis` supplies optional price-path calculations.

## TraderHub and reference data

`src/domain/market-data/reference/` defines OpenAlice-owned board contracts;
every response carries an explicit `meta` envelope (origin, as-of). The
hosted hub is preferred when enabled; typed local providers are the fallback
where implemented. Configuration lives at
`<OPENALICE_HOME>/data/config/market-data.json` (per-asset-class providers,
`providerKeys`, `hub.enabled`/`hub.baseUrl`). Self-hosters may point
`hub.baseUrl` at their own TraderHub; a `hub:<baseUrl>` credential sentinel
routes keyed-provider requests through the hub without copying the hub's
upstream credential into OpenAlice.

## Bar and K-line providers

`src/domain/market-data/bars/` is the canonical price-history layer; a
source is addressed by `barId`, so selection is explicit and stable across
search, charting, snapshots, and exports. BarService federates vendor
K-lines, broker/exchange K-lines via UTA, and source metadata. UTA source
discovery and Broker Pack installation are independent: `asVendor` controls
whether a configured UTA joins default K-line/contract discovery; keyless
public-data UTAs are explicit choices; a Pack only supplies the engine
implementation. Missing support makes that UTA source unavailable with an
actionable error — it must not remove the provider kind, rewrite
`asVendor`, or reroute the same `barId` through a different vendor. The
per-UTA `asVendor` preference is one setting surfaced in both Settings →
Data → Market Data and the UTA broker editor. New K-line sources implement
the bar/provider contract and appear in source discovery — never a new
OpenBB-style asset-class client or copied route hierarchy.

## Embedded compatibility package

`packages/opentypebb/` is monorepo-private: no standalone server entry, no
package-local dev/test/watch commands, no publishing job, no semver promise.
Alice mounts the remaining compatibility routes at `/api/market-data-v1`
via `src/server/market-data-compat.ts` for existing clients only; new
agent-facing or product contracts do not start there.

## Change routing

| Change | Owner path |
|---|---|
| New low-frequency board / hosted dataset | `src/domain/market-data/reference/` + TraderHub tool/CLI mapping |
| New K-line vendor or broker source | `src/domain/market-data/bars/`, provider discovery, UTA if broker-owned |
| Existing fundamentals/search provider fix | `packages/opentypebb/src/providers/` + typed Alice client |
| New user credential name | market-data config schema + `src/domain/market-data/credential-map.ts` |
| Compatibility HTTP behavior | `src/server/market-data-compat.ts` + focused route tests |

Provider discovery is self-described (optional vendors expose `vendorMeta`
joined with configuration at runtime); do not maintain a prose inventory.

## Raw history consumption

`alice market bars --bar-id 'yfinance|AAPL' --asset-class equity --interval
1d --count 250 --output bars.json` returns `{ bars, meta }` (stdout without
`--output`); the chart `/api/bars` keeps its `{ results, meta }` envelope
over the same service. Outside a Workspace, use `openalice exec --project
<key> alice market bars …`; no formula engine is needed. Non-obvious
provider invariants: the service returns at most 5,000 bars and rejects
invalid counts/intervals/dates; `asOf` anchors vendor and broker requests
alike; date bounds are inclusive calendar days (UTC days for intraday);
intraday timestamps keep explicit UTC offsets while daily/weekly bars are
calendar labels; Yahoo translates inclusive ends to its exclusive upstream
bound and excludes an appended live tick (the latest candle may be
incomplete); commodity spot history is daily-only; adjustment policy and
session calendars stay provider-owned; count-only requests use bounded
lookback (explicit older Yahoo windows fail with a source-specific message;
`1w` accepted, `4h` unsupported — export 1h and aggregate). FX keeps USD-base
pairs (`JPY=X` normalized to `USDJPY`); incomplete OHLC rows are omitted,
not fatal; commodity roots map to vendor futures symbols (e.g. lumber
`LBR=F`) — not executable spot quotes. CCXT pagination walks exchange pages
within the window, deduplicates timestamps, stops when the provider stops
advancing, and never lets a per-page cap silently truncate a request.
Eastmoney may drop a connection without an HTTP response while quotes still
work (a transport error is not proof of DNS/proxy fault); its human-
verification challenge is a diagnostic possibility — never automate it,
import cookies, or silently substitute another vendor under an Eastmoney
barId.

`meta.freshness` (identical over HTTP and CLI): fetch completion time,
latest record timestamp, precision, record age only for timezone-bearing
instants (never measured feed latency), and the earliest returned record;
`delay.status` is `possible` only for an OpenAlice delayed-source
classification (basis distinguishes it from historical/empty/insufficient
evidence); `estimatedSeconds` stays null until real latency evidence
exists. `meta.quality` reports inspected/excluded row counts before count
selection plus the latest excluded record — null/non-finite OHLC excluded,
zero/negative prices valid; the chart shows exclusions separately from
freshness and neither surface substitutes a quote or switches sources to
manufacture a candle.

## Market references in replies

`[[market/{barId}/{interval}]]` is a reserved Connector Protocol reference
(last slash delimits the interval; broker keys may contain slashes, pipes,
colons). Consumers request the latest 300 bars. Vendor calls without an
asset-class hint resolve an exact catalog identity — lookup may broaden the
query but never the result identity; ambiguous catalogs fail with guidance
(no equity default, no provider substitution); broker identities keep UTA
routing. `/cli/market-reference` exposes only the read-only `getMarketBars`
operation on the local tool gateway; Connector owns the portable PNG
renderer and never reads Workspace files for market data. Snapshots qualify
possible delay; snapshot age is not feed latency.

## RSS archive

`alice rss glob`/`grep` search the collector's recent in-memory index within
the lookback before applying the output limit (default 500, oldest-first);
the index is bounded by `maxInMemory`/`retentionDays`, not a full-history
disk search. `alice rss read --id` resolves the durable JSONL sequence ID
(memory index for recent entries, streamed archive for evicted ones). Reads
return stored feed content (possibly only a summary) and never fetch the
publisher page.

## Verification

Use the [[docs/development-workflow.md]] feedback ladder. Compatibility-
package changes run from the monorepo root so they share Alice aliases:
`pnpm -F @traderalice/opentypebb typecheck` and
`pnpm vitest run packages/opentypebb/src`. Typecheck Alice when its client
or routes change; cross-owner/shared protocol, registry, dependency, or
uncertain impact requires the broader gates. Bars/reference contract
changes also run their focused suites and exercise the `traderhub` or
`alice analysis` CLI path. Keyed/network tests need explicit credentials and
must never become a silent prerequisite of the unit suite.
