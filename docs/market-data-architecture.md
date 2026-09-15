# Market Data Architecture

This guide owns OpenAlice's market-data contracts and provider boundaries. New
features should extend TraderHub, the bar service, or a typed domain contract;
they should not expand the embedded OpenBB compatibility model by default.

Related guides: [[docs/project-structure.md]] and
[[docs/uta-live-testing.md]]. Broker implementation delivery is owned by
[[docs/broker-packs.md]].

## Supported Product Surfaces

OpenAlice has three market-data layers with different jobs:

| Layer | Primary consumers | Contract |
|---|---|---|
| TraderHub/reference data | Native agents, boards, low-frequency research | `traderhub` CLI and `/api/reference/*` |
| Bar service | Charts, raw CLI exports, quant tools and snapshots | `barId`-keyed K-line provider federation through `/api/bars` |
| Embedded provider compatibility | Remaining Alice fundamentals/search clients | Private `@traderalice/opentypebb` workspace package and `/api/market-data-v1` compatibility routes |

The first two layers are the product architecture. The compatibility package is
an implementation detail retained for provider adapters, legacy models, and
routes that have not yet moved to an OpenAlice-owned contract.

## Agent-facing Data Flow

Native coding agents use the injected CLI shims instead of importing packages
or constructing provider HTTP requests:

```text
low-frequency/reference research
  -> traderhub board/equity/etf/economy/...
  -> OpenAlice ToolCenter
  -> hosted TraderHub when available
  -> typed local fallback when supported

K-lines and quantitative work
  -> alice market search-bars/bars (raw data)
  -> optional alice analysis snapshot/quant
  -> BarService
  -> vendor source or UTA broker source selected by barId
```

`traderhub` is intentionally named after the hosted/reference domain. It owns
boards, fundamentals, macro series, calendars, ETFs, and related slow-moving
research data. `alice market` owns bar discovery and raw history; `alice analysis` supplies optional price-path calculations.

## TraderHub and Reference Data

`src/domain/market-data/reference/` defines OpenAlice-owned board contracts.
Each response carries an explicit `meta` envelope describing origin and as-of
time. The hosted hub is preferred when enabled; typed local providers are the
fallback where a board implements one.

Configuration lives in
`<OPENALICE_HOME>/data/config/market-data.json`:

```json
{
  "enabled": true,
  "providers": {
    "equity": "yfinance",
    "crypto": "yfinance",
    "currency": "yfinance",
    "commodity": "yfinance"
  },
  "extraVendors": [],
  "providerKeys": {},
  "hub": {
    "enabled": true,
    "baseUrl": "https://traderhub.openalice.ai"
  }
}
```

Self-hosters may point `hub.baseUrl` at their own compatible TraderHub. A
`hub:<baseUrl>` credential sentinel routes supported keyed-provider requests
through the hub without copying the hub's upstream credential into OpenAlice.

## Bar and K-line Providers

`src/domain/market-data/bars/` is the canonical price-history layer. A bar
source is addressed by `barId`, so provider selection is explicit and stable
across search, charting, snapshots, and raw exports.

BarService federates:

- vendor K-lines from the embedded provider adapters;
- broker/exchange K-lines exposed through UTA;
- source metadata such as capability and freshness.

UTA source discovery and Broker Pack installation are independent. `asVendor`
controls whether a configured UTA joins default K-line/contract discovery;
keyless public-data UTAs are explicit source choices. A Broker Pack merely
supplies the selected broker engine implementation. Missing support makes that
UTA source unavailable with an actionable error; it must not remove the UTA
provider kind, rewrite `asVendor`, or silently route the same `barId` through a
different vendor.

New K-line sources should implement the bar/provider contract and appear in bar
source discovery. They should not require a new OpenBB-style asset-class client
or a copied OpenBB route hierarchy.

## Embedded Compatibility Package

`packages/opentypebb/` is private to this monorepo. It still supplies useful
provider fetchers, standard-model types, query execution, and router adapters,
but it is not an independently supported SDK or server.

The package deliberately has:

- no standalone HTTP server entry;
- no package-local `dev`, `test`, or watch command;
- no npm or GitHub Packages publishing job;
- no external semantic-versioning promise.

Alice mounts the remaining compatibility routes at `/api/market-data-v1`
through `src/server/market-data-compat.ts`. Existing UI/domain clients may keep
using that mount while they are migrated. New agent-facing or product-level
contracts should not start there.

## Change Routing

| Change | Owner path |
|---|---|
| New low-frequency board or hosted dataset | `src/domain/market-data/reference/`, TraderHub tool/CLI mapping |
| New K-line vendor or broker source | `src/domain/market-data/bars/`, provider discovery, UTA when broker-owned |
| Existing fundamentals/search provider fix | `packages/opentypebb/src/providers/` plus the typed Alice client |
| New user credential name | market-data config schema and `src/domain/market-data/credential-map.ts` |
| Compatibility HTTP behavior | `src/server/market-data-compat.ts` and focused route tests |

Provider discovery is self-described. Optional vendors expose `vendorMeta`, and
the runtime joins that metadata with current configuration. Do not maintain a
copied provider inventory in prose.

## Verification

The compatibility package is tested from the monorepo root so it shares the
same aliases, setup, and runtime assumptions as Alice:

```bash
pnpm -F @traderalice/opentypebb typecheck
pnpm vitest run packages/opentypebb/src
npx tsc --noEmit
pnpm test
```

When changing bars or reference contracts, also run their focused suites and
exercise the corresponding `traderhub` or `alice analysis` CLI path. Keyed or
network tests require explicit test credentials and must not become a silent
prerequisite of the normal unit suite.

## Collected RSS archive

`alice rss glob` and `grep` search all available items in the collector's recent
index within the requested lookback before applying the output limit (default
500 matching items, oldest-first). `window` likewise filters the available
index before applying its output cap. The index is bounded by collector
`maxInMemory` and recovery `retentionDays`; it is not a full-history disk search.

`alice rss read --id` resolves the durable JSONL sequence ID. Recent entries use
the memory index; evicted entries are read by streaming the archive on disk.
This read path survives index eviction and restart without a persisted format
change. It returns stored feed content, which may be only a summary, and does
not fetch the publisher webpage. Empty search results establish only that no
match exists in the available subscribed-feed index.

## Raw history consumption

`alice market bars --bar-id 'yfinance|AAPL' --asset-class equity --interval 1d
--count 250 --output bars.json` returns `{ bars, meta }`. Without `--output`,
JSON goes to stdout for pipelines. Chart `/api/bars` retains its existing
`{ results, meta }` envelope over exactly the same service.

`meta` carries source identity, interval, freshness, response ceiling and local
`truncatedRows`. A zero truncation count does not prove upstream completeness.
The service returns at most 5,000 bars and rejects invalid counts, unsupported
intervals and invalid/conflicting dates. `asOf` anchors vendor requests as well
as broker requests. Commodity vendor spot history supports daily bars only.
Date bounds are inclusive calendar days (UTC days for intraday instants).
Yahoo, Eastmoney and broker intraday timestamps retain explicit UTC offsets; daily/weekly
bars remain calendar labels. Yahoo translates the inclusive end into its
exclusive upstream bound and excludes an appended live-price tick from candle
counts. The latest genuine candle may still be incomplete. Adjustment policy
and session calendars remain provider-owned.

Count-only requests use a bounded lookback rather than loading months of minute
bars. Yahoo inferred windows respect recent-history retention; explicit older
windows fail with a source-specific message. Yahoo accepts the common `1w`
period. Unsupported 4h requests fail explicitly: callers can export 1h bars
and aggregate locally. The chart switches to 5D/1M when selecting 1m/5m from a
longer range and updates the focused asset route rather than a stale tab URL.
Freshness is a date-level weekday estimate, not a live-market assertion.

Outside a Workspace use `openalice exec --project <key> alice market bars ...`.
No formula engine is needed to export data or process it with local code.

FX discovery retains USD-base pairs and crosses; Yahoo's abbreviated `JPY=X`
is normalized to `USDJPY`. Incomplete OHLC rows are omitted rather than failing
the whole series; valid zero and negative prices remain valid. Commodity roots
map to vendor futures symbols (including current lumber `LBR=F`), so these
histories are not executable spot quotes or explicit delivery-month contracts.

CCXT history walks exchange pages within the trailing requested window. A
venue's per-page cap must not silently turn a large request into an old first
page. Pagination deduplicates timestamps and stops if the provider no longer
advances; short results can still reflect upstream availability. Validate the
installed Broker Pack as well as source code when changing this adapter.

Eastmoney history can close a connection without an HTTP response while its
quote endpoint still works. A transport error alone does not establish a DNS,
proxy, or provider fault. In live acceptance (#1417), the official chart showed
a human-verification challenge; after the user completed it, unchanged CLI
requests for Shanghai/Shenzhen minute bars and daily history succeeded. Treat
that as a diagnostic possibility, not a guaranteed recovery procedure. Do not
automate the challenge, import browser cookies, or silently substitute another
vendor under an Eastmoney bar ID.

The Eastmoney equity page resolves its display name by exact bar ID and shows
the six-digit security code and SSE/SZSE market label. Name lookup failure
leaves a usable code-based heading and does not block history. Provider-native
secids remain on the bar request; broker discovery receives the security code
as a heuristic query, not a claimed canonical trading identity. The chart
displays its forward-adjustment policy beside the source and keeps full candle
timestamps available on the condensed date-range label.

### Bar record freshness

Bar responses expose `meta.freshness` identically through HTTP and the Project
CLI: fetch completion time, latest returned record timestamp, timestamp precision,
record age in seconds (only for explicit timezone-bearing instants), and whether
the caller supplied a historical anchor. Age is not measured feed latency.
Date-only, timezone-less and future records have no inferred age. Existing
`isLatestActual`/`staleTradingDays` are legacy weekday comparisons, not realtime
guarantees or exchange-calendar checks.

Charts show latest record time separately from fetch time; OpenAlice-classified
`delayed` does not imply a known number of delayed minutes. Board refresh labels
say “Fetched” because successful polling does not establish underlying freshness.

Freshness also names the earliest returned record, each endpoint's precision and
explicit timezone offset (null when unknown), and `timestampMeaning` as the
provider bar timestamp, without assuming open/close boundary semantics.
`delay.status` is `possible` for an OpenAlice delayed-source classification,
otherwise `unknown`; `basis` distinguishes this heuristic from historical
requests, empty results and insufficient evidence. `estimatedSeconds` remains
null until actual latency evidence is available. The explanation travels with
the CLI JSON; neither fresh timestamps nor `realtime` capability certify latency.

### Incomplete bar diagnostics

`meta.quality` reports inspected and excluded row counts within the fetched date
window, before count/ceiling selection, plus the latest excluded record and its
invalid OHLC fields. Null, non-number and non-finite OHLC values are excluded;
zero and negative prices remain valid. Yahoo's nullable provider models preserve
incomplete rows until this boundary so a missing latest close is observable.
The chart displays exclusions separately from freshness; neither CLI nor UI
substitutes a quote or switches sources to manufacture a complete candle.
Diagnostics describe rows reaching the bar service, not invisible upstream gaps.

## Market references in replies

`[[market/{barId}/{interval}]]` is a reserved Connector Protocol reference,
separate from files and Tracked entities. The last slash delimits the interval;
native broker keys may themselves contain slashes, pipes and colons. Supported
intervals match BarService, and consumers request the latest 300 bars.

Vendor calls without an asset-class hint resolve an exact catalog identity.
Lookup can broaden a normalized pair/secid into a base query, but never the
result identity. Ambiguous/unavailable catalogs fail with guidance to pass an
explicit hint; there is no equity default or provider substitution. Broker
identities retain their existing UTA routing.

`/cli/market-reference` exposes only the registered read-only getMarketBars
operation on the local tool gateway. Connector owns the portable PNG renderer;
it does not read Workspace files to obtain market data. Snapshots include the
source, interval, returned window, last bar and fetched timestamp, and qualify
possible delay. Snapshot age is not measured feed latency.

Acceptance (2026-09-11): full hermetic suite 792 files / 6,988 passed / 4 skipped;
root, UI, Connector and protocol typechecks; bundled Connector startup smoke;
real CLI AAPL bars; real GUI streamed card, history reopen, interval tab dedup,
390px layout; real Yahoo equity/crypto/currency/commodity reads and inspected
PNG. Connector ordering/failure tests passed; no new live Telegram delivery
or real trading write was performed in this acceptance.
