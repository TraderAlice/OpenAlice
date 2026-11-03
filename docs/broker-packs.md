# Broker Packs

This guide owns OpenAlice's optional broker-integration packaging,
installation, activation, and runtime-loading contract. Broker behavior and
market-data source selection remain in [[docs/uta-live-testing.md]] and
[[docs/market-data-architecture.md]].

## Boundary

The installed core contains Alice, UTA Core, and the Mock simulator only —
live broker SDKs (CCXT, Alpaca, IBKR, LeverUp, Longbridge) ship as
versioned, platform-specific Broker Packs installed after the user chooses a
broker or public crypto data source. Three independent concepts: (1) UTA
Core owns account orchestration, approvals, snapshots, FX, HTTP, and the
broker interface and must start without any live Pack; (2) Packs supply
implementations plus their external SDKs (Mock is the sole built-in engine);
(3) market-data routing decides whether an online UTA participates in K-line
and contract discovery — installing a Pack does not enable a source, and
disabling `asVendor` does not uninstall a Pack. A configured `asVendor`
account or keyless CCXT source exposes broker K-lines exactly as before once
its Pack is available; there is no silent fallback when a Pack is missing.

## Pack API and source layout

Pack API version 1 exports `BROKER_PACK_API_VERSION: 1`,
`BROKER_ENGINE: 'ccxt'|'alpaca'|'ibkr'|'leverup'|'longbridge'`, a Zod
`configSchema`, and `createBroker(config): IBroker`. Wrapper workspaces live
under `packages/uta-broker-*` and bundle OpenAlice-owned adapter code;
third-party SDKs stay external within each deployed Pack — except Alpaca,
whose pure-JS closure is bundled for compiled Bun compatibility (acceptance
must import the built entry with a compiled Bun executable:
`pnpm -F @traderalice/uta-broker-alpaca build` then `test:packaged`).
`services/uta/src/domain/trading/brokers/registry.ts` statically imports
only Mock, then loads one active Pack by file URL when an account needs that
engine.

Compatibility is governed by `BROKER_PACK_API_VERSION`, not product-version
equality; `broker-pack.json#version` selects the matching update catalog,
and an older Pack with a supported API stays loadable while its replacement
downloads. Core code must not depend on class identity from a Pack's
dependency tree — use structural checks (`Decimal.isDecimal`) and stable
error codes, not cross-package `instanceof`. Dev/test may resolve wrappers
directly; production launchers must use an activated downloaded Pack.
`OPENALICE_BROKER_PACK_ALLOW_WORKSPACE=1` is for intentional source-tree
runtime only, and `OPENALICE_BROKER_PACK_PREFER_WORKSPACE=1` prefers source
wrappers in dev/tests without changing the active pointer.

## Installed layout and transaction

```text
<OPENALICE_HOME>/runtime/broker-packs/<engine>/
├── active.json
└── releases/<openalice-version>-<content-id>/{broker-pack.json,dist/index.js,package.json,node_modules/}
```

Alice owns installation; UTA never runs a package manager. Transaction:
fetch the exact version/OS/arch catalog → choose the engine asset and
validate requirements → stream into private staging with a size limit →
verify the published SHA-256 → validate name/version/entry/manifest → move
the immutable release and atomically replace `active.json` → request a UTA
restart → verify UTA's loaded module identity. Installation and UTA
activation are recorded separately in each engine's `lifecycle/` journal
([[docs/update-lifecycle.md]]); a lost restart response is reconciled via
`GET /__uta/broker-packs/:engine` — changing the pointer alone cannot prove
a cached SDK was replaced. The probe creates no broker account or venue
connection. Pack owners share one serialized UTA restart queue with bounded
health probes; disabled UTA leaves activation pending without blocking Chat.

Failure before pointer replacement leaves the previous release intact; an
installation lock rejects concurrent mutation of one engine; reinstall
reuses a matching content-addressed release, and a corrupt one gets a
separate immutable `-repair-...` release rather than overwriting files a
Windows UTA may hold open. Pack directories are replaceable machine state —
back up `data/`, credentials, and Workspaces, then reinstall Packs after
moving machines. On startup Alice reconciles only Packs with an active
release: a Pack from another version or dev revision keeps serving through
the supported API while the current artifact downloads, validates, and
switches; an old-API Pack is not loaded but still qualifies for automatic
replacement; missing Packs remain an explicit user choice and corrupt ones
stay visible Repair cases. `OPENALICE_BROKER_PACK_AUTO_UPDATE=0` is the
emergency kill switch; source dev/test runtimes skip network reconciliation.
Linux catalogs may declare a minimum glibc (Longbridge GNU needs 2.39 —
reject older systems before `ERR_DLOPEN_FAILED`). Rolling dev bundles
`share/openalice/broker-pack-source.json` bound to the full source commit
and covered by the CLI content identity; status compares the active content
ID with the expected archive SHA-256 prefix, locally, never via a mutable
latest catalog.

## Release assets

`pnpm broker-packs:build` builds all wrappers, runs `pnpm deploy --prod`
with the hoisted node linker per engine, and emits
`OpenAlice-Broker-Packs-<version>-<platform>-<arch>.json` plus per-engine
`.tgz` archives. The release matrix builds macOS arm64/x64, Windows x64, and
Linux arm64/x64 (dev also Windows ARM64, except Longbridge whose upstream
native binding is unavailable there). Stable publication additionally
downloads real Packs from the previous release, activates them in an
isolated home, and exercises reconciliation — every active pointer must move
while previous immutable releases remain intact (beta does not run this
stable-only N-1 step). The build extracts every archive and verifies catalog
membership, size, SHA-256, package identity, entry containment, absence of
workspace/deployment metadata, then imports the entry in a clean Node
process; every manifest dependency must be a real directory (no pnpm
symlink/junction). Archive writes are synchronous (the async tar writer can
leave an unresolved top-level await on Windows). Release scripts invoke
Corepack's `pnpm.cmd` through `ComSpec` with a pre-quoted command line;
package scripts must not rely on POSIX quoting. Desktop package acceptance
rejects `ccxt`, `longbridge`, its native binding, and
`@alpacahq/alpaca-trade-api` under packaged `node_modules`; a new Pack must
extend that assertion and the release matrix.

## UI contract

Alice is the readiness authority. `GET /api/trading/config/broker-packs`
joins persisted UTA configuration with installed Packs, returning
engine-level `packs` plus one `accounts` readiness row per configured UTA.
Configured and loadable are deliberately different: `ready`,
`needs-install`/`needs-repair` (visible, non-operational),
`unsupported-preset` (legacy preserved); a frontend that cannot read the
contract fails closed with Retry. The join is machine-local: AliceProject
transfer preserves account configuration but not Pack payloads, so a
transferred account shows "configured, support needed" until the destination
installs its Pack. Discovery is cheap and read-only and must never install,
contact a broker, reconnect, or trade. Entry points: broker creation offers
Install/Repair before credentials; enabled accounts show Install/Update/
Repair banners; crypto data-source toggles require the CCXT Pack before
enabling. Pack errors are explicit and recoverable — Alice/Chat stays
usable, UTA keeps starting, other engines stay independent. Trading,
Portfolio, and UTA Detail share one readiness selector: missing/broken
support must not show Live indicators, wait in skeletons, poll account
endpoints, or offer Reconnect/Place Order/Close; they offer Install, Repair,
or Retry instead. `canTrade` is stricter than Pack readiness (configured on,
writable, `pro` mode, healthy trading-tier UTA; a missing health row is not
permission to trade). Historical snapshots visible during outages must be
labeled stale/non-live.

## Verification

```bash
pnpm broker-packs:build
pnpm broker-packs:upgrade-smoke
pnpm vitest run tests/integration/broker-pack-installation/installer.spec.ts \
  services/uta/src/domain/trading/brokers/registry.spec.ts \
  ui/src/components/uta/CreateUTADialog.spec.tsx
npx tsc --noEmit && (cd ui && npx tsc -b)
```

Bun CLI lanes additionally run `pnpm build:bun-runtime:feasibility` on
native hosts (rolling dev samples it on Linux x64 once per commit): the
isolated fixture uses the production active-release layout, imports a
private SDK from Pack-local `node_modules` with a real N-API binary, and
proves the compiled UTA role reloads it after a forced restart. Bun
standalone builds must enable `autoloadPackageJson`
(`scripts/bun-compile-options.ts`) or compiled executables cannot resolve
physical Pack SDKs. After building release archives run
`pnpm exec tsx scripts/verify-broker-packs.ts --compiled` (compiled probe
imports and constructs each broker including Longbridge's native binding;
synthetic config; no init, connection, or trading). Desktop changes follow
[[docs/managed-workspace-runtime.md]] (`electron:assert-package` plus
packaged Workspace smoke); broker-implementation changes also follow the
paper/demo scenarios in [[docs/uta-live-testing.md]] — never a real-money
account.

## Alpaca multi-asset boundary

Stock/ETF and spot-crypto: crypto rows keep `CRYPTO` identity with slash
pairs (`BTC/USD`); the upstream positions endpoint alone uses compact
symbols (`BTCUSD`) — never send slash paths there, encoded or not. Crypto
orders accept MKT/LMT/STP LMT with GTC/IOC; attached exits and stock
extended-hours flags are rejected. Notional orders retain cash quantity
separately from filled base quantity.

Options support **single-leg trading** when the account reports positive
`options_trading_level` (permission refreshed before entry/amendment;
Alpaca validates strategy approval and collateral). Whole contract
quantities, per-unit premium prices, MKT/LMT/STP/STP LMT and DAY/GTC; cash
notional, trailing, attached exits, and extended hours refused. Close/amend
preserve the OCC symbol; position quantities are positive counts with
direction in `side` (Alpaca's signed short quantities must not be negated
again). Multi-leg strategies and explicit exercise are not implemented.
Research: `alice-uta contract option-contracts` (paginated definitions, dated
open interest) and `option-chain` (paginated snapshots with feed
provenance); `contract expand` requires an expiry. The default snapshot feed
is `indicative` (delayed/modified); explicit OPRA requests preserve
entitlement errors instead of silently switching feeds. `contract
order-book` shares the optional broker read boundary with CCXT
(account-owned aliceId; credentials stay in UTA; old Packs return
unsupported). `historicalBars.qualityBySecType` distinguishes crypto history
from equity-only IEX entitlement. Option historical bars are not exposed.
