# Market Data Architecture

This guide owns OpenAlice's market-data contracts and provider boundaries. New
features should extend TraderHub, the bar service, or a typed domain contract;
they should not expand the embedded OpenBB compatibility model by default.

Related guides: [[docs/project-structure.md]] and
[[docs/uta-live-testing.md]].

## Supported Product Surfaces

OpenAlice has three market-data layers with different jobs:

| Layer | Primary consumers | Contract |
|---|---|---|
| TraderHub/reference data | Native agents, boards, low-frequency research | `traderhub` CLI and `/api/reference/*` |
| Bar service | Charts, quant tools, snapshots, simulations | `barId`-keyed K-line provider federation through `/api/bars` |
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
  -> alice analysis search-bars/snapshot/quant/simulate
  -> BarService
  -> vendor source or UTA broker source selected by barId
```

`traderhub` is intentionally named after the hosted/reference domain. It owns
boards, fundamentals, macro series, calendars, ETFs, and related slow-moving
research data. `alice analysis` owns bar discovery and price-path analysis.

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
across search, charting, snapshots, and simulations.

BarService federates:

- vendor K-lines from the embedded provider adapters;
- broker/exchange K-lines exposed through UTA;
- source metadata such as capability and freshness.

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
