# Broker Pack Release Safety

Status: Complete

Related incident:
[[docs/incidents/2026-07-28-broker-pack-upgrade-gap.md]]

Owner guides:

- [[docs/broker-packs.md]]
- [[docs/development-workflow.md]]
- [[docs/managed-workspace-runtime.md]]

## Scope

Repair the v0.85 existing-user regression in which OpenAlice and bundled UTA
Core upgraded while an already-installed Broker Pack remained pinned to v0.84.
Ship the correction as v0.86.0-beta and make the previous-release upgrade path
a blocking release contract.

This emergency increment does not complete independent semantic versioning for
UTA Core and Broker Packs. It establishes the API compatibility boundary and
safe reconciliation needed before those release cadences can be separated.

## Decisions

1. `BROKER_PACK_API_VERSION` is the loader compatibility gate. Product-version
   equality identifies an available update but does not take a compatible
   account offline.
2. Automatic reconciliation updates only previously downloaded Packs. Missing
   integrations remain consented UI installs.
3. Candidate activation stays content-addressed and atomic. A failed update
   retains the prior compatible active pointer.
4. Development/test runtimes do not perform surprise network updates; an
   emergency environment kill switch remains available in production.
5. Release acceptance starts with the real previous GitHub Release artifacts
   on every supported platform.

## Work

- [x] Keep API-compatible previous-release Packs loadable.
- [x] Detect and automatically reconcile outdated downloaded Packs.
- [x] Expose Update separately from Install and Repair in Trading UI.
- [x] Add the previous-release Broker Pack upgrade smoke to the release matrix.
- [x] Record the v0.85 incident and durable owner-guide contract.
- [x] Complete focused, repository-wide, and packaged verification.
- [x] Merge to `dev` and inspect trailing CI.
- [x] Prepare, promote, and publish `v0.86.0-beta`.
- [x] Verify GitHub Release and CDN artifacts after publication.

## Verification

- `pnpm vitest run src/core/broker-packs.spec.ts
  src/services/broker-packs/installer.spec.ts
  services/uta/src/domain/trading/brokers/registry.spec.ts
  ui/src/pages/TradingPage.broker-packs.spec.tsx`
- `pnpm broker-packs:build`
- `pnpm broker-packs:upgrade-smoke -- --from v0.85.0-beta`
- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- `pnpm electron:smoke:packaged --temp-data`
- release matrix on macOS arm64, macOS x64, Windows x64, and Linux x64

Release evidence:

- GitHub Release:
  <https://github.com/TraderAlice/OpenAlice/releases/tag/v0.86.0-beta>
- Release workflow:
  <https://github.com/TraderAlice/OpenAlice/actions/runs/30360097577>
- The published tag resolves to master promotion merge `72862d38`.
- The release contains 20 Broker Pack archives (five engines across four
  platforms), four platform catalogs, both macOS architectures, and the
  Windows installer.
- The public CDN manifest advertises `0.86.0-beta`; versioned desktop
  installers, update feeds, Broker Pack catalogs and archives, and the
  release-owned CLI installer returned successfully after mirroring.

## Completion

An existing installation carrying the previous public release's Broker Packs
stays usable during update, reconciles atomically to the candidate, offers an
actionable recovery surface, and cannot publish until every platform proves
that path.
