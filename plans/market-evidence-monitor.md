# Market Evidence Monitor

Status: active — implementation complete on `feature/market-evidence-monitor`;
live Mac acceptance remains.

Related issues: none.

Owner guides: [[docs/market-data-architecture.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/development-workflow.md]].

## Scope

Build a read-only evidence monitor for BTC and TSLA inside the existing Market
web shell. Reuse BarService for attributed daily and hourly candles, compute
observable price/volume evidence without claiming to know a market actor's
intent, persist settings/observations/alerts under the OpenAlice data root, and
present the result as a responsive dashboard with deterministic demo data.

## Decisions

- This is a Market product surface, not a second trading engine or account
  service. It never submits, stages, approves, or cancels orders.
- Strategy inputs and output types are isolated from HTTP and React so future
  algorithms can be added behind one registry.
- The first strategy is an evidence-chain interpretation of location,
  effort/result, confirmation, invalidation, and competing explanations.
- Daily and hourly bars remain separately attributed. Daily bars are never
  relabelled as intraday data when the hourly source fails.
- A semantic fingerprint excludes cache/transport mechanics so repeat scans do
  not create duplicate observations or alerts.
- The UI is one focused working view in the existing Market shell. On narrow
  windows, controls wrap and evidence tables scroll instead of creating a
  second navigation hierarchy.
- Browser notifications are opt-in and only available while the dashboard is
  open. Native/background delivery is a later product increment.
- Live acceptance is a separate, loopback-only smoke command. Its default mode
  is read-only; explicit `--scan` performs two monitor scans per selected asset
  and records a machine-readable receipt without touching trading routes.

## Checklist

- [x] Add typed analysis, source-health, fingerprint and evaluation modules.
- [x] Add file-backed settings, observation, receipt and alert storage.
- [x] Add read-only HTTP routes and mount them in WebPlugin.
- [x] Add Market navigation, route identity, API client and dashboard.
- [x] Add deterministic demo handlers and fixtures.
- [x] Add focused backend/UI tests and run owner typechecks.
- [x] Exercise the demo build and record live Mac acceptance as a residual gap.
- [x] Commit and push the held feature branch without merging.
- [x] Add and verify the Mac live-API acceptance command on the draft branch.
- [ ] Run the live command on macOS and observe scheduling for 24–72 hours.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Focused market-monitor backend and UI specs
- `pnpm test:changed` when the origin exposes a compatible `dev` base;
  otherwise explicit owner/path selection against `upstream/dev`
- `pnpm -F open-alice-ui build:demo`
- `pnpm market-monitor:acceptance -- --help`
- `pnpm vitest run scripts/market-monitor-live-smoke.spec.ts`
- Real `/market/evidence` demo route; Mac live-data acceptance remains external

Verified in the managed Linux workspace on 2026-09-12:

- Root and UI TypeScript checks passed.
- Four focused files passed 12 tests.
- The deterministic demo production build passed and reported
  `/market/evidence` ready.
- The broader affected-test command reaches unrelated PTY, socket, installer,
  and temporary-Git suites that require host capabilities unavailable in this
  workspace. No Market Monitor test failed; native Mac acceptance remains the
  final environment-specific check.
- The live-acceptance helper and the original monitor closure pass five files
  and 16 tests; its help/argument contract also passes under pnpm 11.

## Completion

The branch is complete when BTC and TSLA can be scanned read-only, duplicate
snapshots are suppressed, source failure is visible without erasing the last
good view, the 1D/1H dashboard and histories work in demo and production paths,
all proportional tests pass, and the verified branch is pushed for Mac review.
