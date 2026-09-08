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
- source metadata such as capability and freshness;
- the trading SESSION a broker series covers.

Session is resolved by UTA per instrument (stocks/options default to regular
hours, FX/futures/crypto to the continuous tape), never by the caller, and the
effective value plus a `sessionForced` flag ride back on `BarMeta`. See the
IBKR adapter README for the default table and the broker capability fallback.

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
Dates and OHLCV retain provider semantics: adjustment policy, exchange timezone
and whether the latest candle is complete are not guaranteed by this envelope.
Freshness is a date-level weekday estimate, not a live-market assertion.

Outside a Workspace use `openalice exec --project <key> alice market bars ...`.
No formula engine is needed to export data or process it with local code.
