# Broker Packs

This guide owns OpenAlice's optional broker-integration packaging, installation,
activation, and runtime-loading contract. It does not own broker behavior or
market-data source selection; those remain in [[docs/uta-live-testing.md]] and
[[docs/market-data-architecture.md]].

## Boundary

The installed OpenAlice core contains Alice, UTA Core, and the Mock simulator.
It does not contain the live broker SDKs for CCXT, Alpaca, IBKR, LeverUp, or
Longbridge. Those implementations ship as versioned, platform-specific Broker
Packs and are installed only after the user chooses a broker or public crypto
data source in the Trading UI.

This split has three independent concepts:

1. **UTA Core** owns account orchestration, approvals, snapshots, FX, HTTP, and
   the broker interface. It must start without any live Broker Pack.
2. **Broker Packs** supply implementations of that interface and their external
   SDK dependencies. Mock is the sole built-in engine.
3. **Market-data routing** decides whether an online UTA participates in K-line
   and contract discovery. `asVendor` and keyless public-data UTAs remain that
   routing contract; installing a Pack does not enable a source, and disabling
   `asVendor` does not uninstall a Pack.

In particular, UTA remains a valid BarService provider. A configured account
with `asVendor: true`, or an explicitly enabled keyless CCXT source, exposes
broker/exchange K-lines exactly as before once its required Pack is available.
There is no silent fallback to a different provider when a Pack is missing.

## Pack API and Source Layout

Pack API version 1 exports:

```ts
BROKER_PACK_API_VERSION: 1
BROKER_ENGINE: 'ccxt' | 'alpaca' | 'ibkr' | 'leverup' | 'longbridge'
configSchema: ZodType
createBroker(config): IBroker
```

The wrapper workspaces live under `packages/uta-broker-*`. They bundle the
OpenAlice-owned adapter/protocol code needed at runtime; third-party broker SDKs
remain external within each deployed Pack. Release assembly removes workspace
links, pnpm lock/workspace metadata, and build-machine paths before archiving.
`services/uta/src/domain/trading/brokers/registry.ts`
statically imports only Mock, then loads one active Pack by file URL when an
account actually needs that engine.

Development and tests may resolve the wrapper workspaces directly. Production
launchers must use an activated downloaded Pack. Set
`OPENALICE_BROKER_PACK_ALLOW_WORKSPACE=1` only for an intentional source-tree
runtime; never use it to disguise a missing production artifact.

Pack-local dependency copies cross a structural API boundary. Core code must
not depend on class identity from a Pack's dependency tree; use structural
checks such as `Decimal.isDecimal` and stable error codes instead of
cross-package `instanceof` tests.

## Installed Layout and Transaction

Replaceable Pack payloads live outside portable user data:

```text
<OPENALICE_HOME>/runtime/broker-packs/<engine>/
├── active.json
└── releases/
    └── <openalice-version>-<content-id>/
        ├── broker-pack.json
        ├── dist/index.js
        ├── package.json
        └── node_modules/
```

Alice owns installation; UTA never runs a package manager. The UI calls Alice,
which performs this transaction:

1. fetch the exact OpenAlice version, OS, and architecture catalog;
2. choose the requested engine asset and validate its declared requirements;
3. stream it into a private staging directory with a size limit;
4. verify the published SHA-256 checksum before extraction;
5. validate package name, version, API entry, and manifest;
6. move the immutable release into place and atomically replace `active.json`;
7. request a UTA restart so the new active pointer is observed.

Failure before pointer replacement leaves the previous active release intact.
An installation lock rejects concurrent mutation of the same engine. Pack
reinstallation reuses a matching content-addressed release. If that release is
corrupt, Alice installs a separate immutable `-repair-...` release and switches
the pointer; it does not overwrite files that a Windows UTA process may still
have open. Pack directories are replaceable machine/runtime state: backup
`data/`, credentials, and Workspaces, then reinstall Packs after moving to an
incompatible machine.

Linux catalogs may declare a minimum glibc version. The current Longbridge GNU
artifact requires glibc 2.39, so older Ubuntu/WSL systems are rejected before
the native module is loaded instead of crashing UTA with `ERR_DLOPEN_FAILED`.

## Release Assets

`pnpm broker-packs:build` builds all wrapper packages, runs `pnpm deploy --prod`
for each engine, and emits:

```text
OpenAlice-Broker-Packs-<version>-<platform>-<arch>.json
OpenAlice-Broker-<engine>-<version>-<platform>-<arch>.tgz
```

The release workflow runs this on macOS arm64, macOS x64, Windows x64, and
Linux x64; publishes the files with the desktop release; mirrors them to the
download CDN; and verifies every catalog and referenced archive.

The build command also extracts every generated archive, verifies its catalog
membership, size, SHA-256, package identity, entry containment, and absence of
workspace/deployment metadata, then imports the entry in a clean Node process.
`pnpm broker-packs:verify` repeats that acceptance check against an existing
`dist/broker-packs/` directory. Release scripts invoke Corepack's `pnpm.cmd`
through `ComSpec` on Windows; package scripts must not rely on POSIX quoting.

Desktop package acceptance rejects `ccxt`, `longbridge`, its native binding,
and `@alpacahq/alpaca-trade-api` if they reappear under packaged
`node_modules`. Adding a new Pack requires extending that assertion and the
release matrix as appropriate.

## UI Contract

The Trading page owns three installation entry points:

- broker creation stops before credentials and offers Install/Repair when the
  chosen engine is absent;
- existing enabled accounts show a missing-support banner with the exact
  accounts that require each Pack;
- public crypto data-source toggles require the CCXT Pack before a source can
  be enabled, while still allowing an already-enabled source to be disabled.

Pack errors must be explicit and recoverable. Alice/Chat remains usable, UTA
continues starting, and other installed broker engines remain independent.

## Verification

Run the focused checks before the repository-wide gates:

```bash
pnpm broker-packs:build
pnpm vitest run src/services/broker-packs/installer.spec.ts \
  services/uta/src/domain/trading/brokers/registry.spec.ts \
  ui/src/components/uta/CreateUTADialog.spec.tsx
npx tsc --noEmit
cd ui && npx tsc -b
```

For desktop changes, follow [[docs/managed-workspace-runtime.md]] and require
`pnpm electron:assert-package` plus the packaged Workspace smoke. For a broker
implementation change, also follow the paper/demo scenarios in
[[docs/uta-live-testing.md]]; never use a real-money account for acceptance.
