# `parity/` — TS↔Rust migration parity harness + fixtures

This directory contains the **Phase 0** deliverables of the TS→Rust trading-core
migration described in [/RUST_MIGRATION_PLAN.v3.md](../../RUST_MIGRATION_PLAN.v3.md)
§5 Phase 0. It is *not* part of the production build — files here ship as TS
source and are invoked via `pnpm tsx`.

The `parity/` tree is committed to the repository (it is reviewed in PRs and
re-run by future migration phases) but is excluded from production bundling.

## Known environment issue: `pnpm test` blocked on macOS Sequoia

`pnpm test` (DoD command `0.V4`) currently cannot start vitest on this
machine because macOS Sequoia rejects `dlopen` on the prebuilt
`@rollup/rollup-darwin-arm64.node` with "Team IDs different". Reproduces
on a clean `master` checkout — *not* a side-effect of the Phase-0 work.
Full diagnosis + things-tried logged in [/TODO.md](../TODO.md) under the
`[migration][env-blocker]` tag.

**Workaround for Phase-0 local verification:** the canonical-decimal
formatter is verified by a stand-alone `tsx` script that does not pull
in vitest:

```bash
pnpm tsx parity/check-canonical-decimal-temp.ts
```

Exits 0 with `24 passed, 0 failed`. This is *not* a vitest spec
(`*.spec.ts`) on purpose — it runs locally even when vitest is blocked.
Once the env issue is resolved, the `vitest.config.ts` `node` project
include glob already covers `parity/**/*.spec.*`, so any future Phase-0+
specs are auto-discovered without further config changes.

## Layout

```
parity/
├── README.md                       — this file
├── canonical-decimal-temp.ts       — temporary toCanonicalDecimalString (replaced in Phase 1c)
├── check-canonical-decimal-temp.ts — stand-alone tsx verifier for the formatter (Phase 0 stopgap)
├── run-ts.ts                       — CLI harness driving real TradingGit through add→commit→push
├── load-legacy.ts                  — CLI that asserts legacy-path loader works on fixtures
├── decimal-inventory.md            — Phase 0.7 audit of every Decimal/sentinel field
├── scripts/                        — generators (re-runnable)
│   ├── gen-operations.ts           — emits parity/fixtures/operations/case-NNN-*.json
│   ├── gen-sentinels.ts            — emits parity/fixtures/sentinels/*.json
│   ├── record-on-wire.ts           — emits parity/fixtures/orders-on-wire/*.json
│   ├── record-git-states.ts        — emits parity/fixtures/git-states/state-NN-*.json
│   └── scan-decimals.sh            — ripgrep sweep feeding decimal-inventory.md
└── fixtures/
    ├── operations/                 — ≥200 staged-operation cases (Phase 0.1)
    ├── sentinels/                  — ≥80 UNSET_DECIMAL/UNSET_DOUBLE/UNSET_INTEGER cases (0.2)
    ├── git-states/                 — 10 GitExportState snapshots (0.3)
    ├── legacy-paths/               — 3 legacy-format commit.json fixtures (0.4)
    └── orders-on-wire/             — ~30 Order/Contract JSON.stringify snapshots (0.5)
```

## How to run

```bash
# All commands assume cwd = OpenAlice/.

# Run a single operation case end-to-end through TradingGit and emit canonical JSON.
pnpm tsx parity/run-ts.ts parity/fixtures/operations/case-001-buy-mkt-day.json

# Verify both legacy-path fixtures load identically (uses tmp dir, never touches data/).
pnpm tsx parity/load-legacy.ts

# Re-generate fixtures (idempotent — same inputs → same JSON byte-for-byte).
pnpm tsx parity/scripts/gen-operations.ts
pnpm tsx parity/scripts/gen-sentinels.ts
pnpm tsx parity/scripts/record-on-wire.ts
pnpm tsx parity/scripts/record-git-states.ts

# Decimal inventory sweep (read-only).
bash parity/scripts/scan-decimals.sh
```

## Hard rules for fixtures

These rules are checked in PR review and grep-verified by `verification §0`.

1. **`Decimal.toString()` is forbidden in fixture data.** Every Decimal-bearing
   field flows through `toCanonicalDecimalString` (defined here in
   `canonical-decimal-temp.ts`, replaced by `src/domain/trading/canonical-decimal.ts`
   in Phase 1c). The verifier `0.V7` greps `parity/fixtures/` for the literal
   string `Decimal.toString()` and fails the build if any occurrence is found.

2. **Fixtures are pretty-printed for reviewer eyes.** They use 2-space indent,
   sorted keys, LF line endings, trailing newline. The *canonical-JSON byte
   stream* (no whitespace, sorted keys) used for v2 hashing is computed only
   by `canonicalJson(...)` calls in the harness — not by the fixture file's
   literal bytes. (See R08 in `/PHASE0_PLAN.md` §8.)

3. **Sentinel-bearing fields never pass through the canonical formatter.**
   When a field carries `UNSET_DECIMAL` / `UNSET_DOUBLE` / `UNSET_INTEGER`,
   the fixture emits `{ "kind": "unset" }`. Only when the field carries a
   real value does it serialize as `{ "kind": "value", "value": "<canonical-string>" }`.

4. **Time-suppression in `run-ts.ts`.** `TradingGit` derives commit hashes
   from `new Date().toISOString()` per call. The harness fakes the clock at
   `2026-05-02T00:00:00.000Z` so fixtures are deterministic. Output JSON
   carries `"hashFromFakeClock": true` to flag this. Phase 2 fixes the
   underlying drift bug at [TradingGit.ts:69 ↔ 124] and replaces the hashes;
   reviewers should not panic about a hash mismatch between a Phase 0
   fixture and a fresh live run.

5. **No production code is modified by Phase 0.** The only existing-file edit
   permitted is extending `vitest.config.ts` so `parity/**/*.spec.*` is
   picked up by the `node` project (per R07).

6. **No live `data/` directory is touched.** `load-legacy.ts` builds a tmp
   directory, `process.chdir`s into it, runs assertions, then restores cwd
   in a `finally` block.

## How to add a fixture

- New operation case: edit `parity/scripts/gen-operations.ts`, add an entry,
  re-run, commit the script change + new JSON together. Hand-editing fixture
  JSON is forbidden — generators must be deterministic and re-runnable.
- New sentinel case: edit `COVERAGE.md` to add the row to the matrix, then
  edit `parity/scripts/gen-sentinels.ts` to emit the new ✓ cell.
- New git-state: edit `parity/scripts/record-git-states.ts` to add a step in
  the deterministic walk, re-run, commit.
- New on-wire snapshot: edit `parity/scripts/record-on-wire.ts`, re-run.

## Cross-references

- v3 plan §5 Phase 0: deliverables 0.1–0.7 spec.
- v3 plan §6.1: canonical decimal rules — the rulebook the temporary
  formatter implements.
- v3 plan §6.13: mixed-version commit log loader (Phase 2.5+).
- /PHASE0_PLAN.md: the implementation roadmap that produced everything here.
- /RUST_MIGRATION_VERIFICATION.md §0: the eight DoD commands (`0.V1`–`0.V8`).
