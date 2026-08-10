# 0.89.2 Migration Baseline

Status: Completed

Related owner guides: [[docs/project-structure.md]], [[docs/data-locations.md]],
[[docs/workspace-issues-and-scheduling.md]]

## Problem

A scheduled-Issue batch was rewritten from canonical `@new-then-resume` to the
deprecated `@workspace` token. The byte-for-byte rewrite matched retired
migrations 0018 and 0019. Those migrations read a journal below
`OPENALICE_HOME` but independently defaulted their Workspace target to
`~/.openalice/workspaces`. An isolated or historical process could therefore
use a fresh journal while mutating the live Workspace root. Unit-test setup
also allowed `OPENALICE_HOME` and `AQ_LAUNCHER_ROOT` to come from different
owners.

## Decisions

- Treat `0.89.2-beta` as the minimum supported persisted-state baseline.
- Retire development migrations 0001–0038 completely; the next shipped data
  migration uses 0039 and the existing journal/backup framework.
- Seed fresh baseline homes from current schemas and defaults instead of
  replaying historical layouts.
- Pin unit-test home, Workspace root, and global provider root to one temporary
  tree even when the invoking Agent inherits a live OpenAlice environment.
- Give future migrations their complete home and Workspace root through the
  runner context rather than re-deriving unrelated defaults.

## Completed Work

- [x] Removed migrations 0008–0038 and their dedicated historical specs.
- [x] Reset the active registry and generated index at the 0.89.2-beta baseline.
- [x] Added complete-home isolation and a regression assertion for unit tests.
- [x] Updated owner guides and code comments to describe baseline behavior
  instead of deleted migration paths.
- [x] Ran root typecheck, targeted Issue/migration specs, and the full unit suite.
- [x] Compared checksums for the live Workspace Issue directory before and
  after the full suite; no file changed.

## Verification

- `npx tsc --noEmit`
- `pnpm vitest run src/migrations/runner.spec.ts src/migrations/registry.spec.ts src/workspaces/issues/declaration.spec.ts src/workspaces/issues/mutate.spec.ts`
- `pnpm test`
- Live Workspace Issue checksum comparison around `pnpm test`

## Completion Criteria

No pre-baseline migration is runtime-reachable, future migrations cannot infer
a Workspace root independently of their journal context, and the ordinary unit
suite cannot read or write the live OpenAlice home.
