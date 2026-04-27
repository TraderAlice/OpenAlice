# Adapter & Tooling Bootstrap Report — analysis_core

- Issue: [OPE-15](/OPE/issues/OPE-15)
- Owner: Adapter & Tooling Engineer (delegated to CTO / Program Orchestrator for this run)
- Date: 2026-04-28
- Type: tooling/scaffolding (no domain logic)
- Related: [ADR-001](../../adr/ADR-001-rust-boundary.md), [ADR-002](../../adr/ADR-002-feature-flag-policy.md), [ADR-003](../../adr/ADR-003-binding-strategy.md), [analysis-core contract](../../module-contracts/analysis-core.md), [manifest](../../openalice-rust-refactor.manifest.yaml)

## Outcome

Phase 2 toolchain/bootstrap gate is **closed**. The Rust workspace shell, toolchain pin, no-op `analysis_core` crate, no-op Node-API binding shell, and CI wiring all compile and test cleanly alongside the existing TypeScript build. The first Rust parser slice for `analysis_core` is now unblocked at the toolchain level (architecture and integration approval gates remain governance-side concerns).

## Toolchain decision

- Rust pinned to **1.95.0** in `rust-toolchain.toml` with `rustfmt` and `clippy` components, `minimal` profile.
- 1.95.0 is the current official stable release as of 2026-04-28 and matches the issue brief.
- Installation was non-interactive via the standard rustup installer:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --default-toolchain none --profile minimal --no-modify-path
```

No password, GUI confirmation, or other human interaction was required. The installer modified only the user-level rustup home (`$HOME/.cargo`, `$HOME/.rustup`); it did not require sudo.

Versions confirmed in this run:

```text
rustup 1.29.0 (28d1352db 2026-03-05)
rustc 1.95.0 (59807616e 2026-04-14)
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
node v25.9.0
pnpm 9.15.4
```

## Workspace shape

```
rust-toolchain.toml                              # pins Rust 1.95.0 + rustfmt + clippy
Cargo.toml                                       # workspace root, resolver=2
Cargo.lock                                       # generated, checked in for the bootstrap
crates/
  analysis-core/
    Cargo.toml                                   # name = analysis-core, version 0.0.0
    src/lib.rs                                   # bootstrap_healthcheck() only
packages/
  node-bindings/
    analysis-core/
      Cargo.toml                                 # rlib, depends on crates/analysis-core
      src/lib.rs                                 # re-exports bootstrap_healthcheck
      package.json                               # @openalice/node-bindings-analysis-core
      index.js                                   # JS bootstrap shell
      index.d.ts                                 # TS surface (healthcheck only)
.github/workflows/ci.yml                         # adds cargo fmt/clippy/test, preserves pnpm steps
pnpm-workspace.yaml                              # adds packages/node-bindings/* glob
```

Constraints honored from [ADR-003](../../adr/ADR-003-binding-strategy.md) §"Package layout":

- The pure crate at `crates/analysis-core/` does not reference `napi`, `neon`, or `node` types.
- Only `packages/node-bindings/analysis-core/` is allowed to know about Node-API; for bootstrap it ships a `bootstrap_healthcheck` JS export and a stable TypeScript declaration so the workspace shape can be exercised without a committed native artifact.
- No `.node` artifact is built or committed. The actual `napi-rs` bridge, DTO conversion, and platform-specific binary distribution land under a separate scoped issue per [ADR-003](../../adr/ADR-003-binding-strategy.md) §"Build, distribution, and CI" and the Rejected-alternatives discussion of prebuilt binaries.

Constraints honored from this issue's allowed-files list:

- Only the files enumerated in the issue's Allowed-files section were created or modified.
- No edits under `src/`. No edits to `src/tool/analysis.ts` or `src/tool/thinking.ts`.
- No feature-flag routing implementation. No DTO schema changes. No Phase 2 implementation issue created or assigned.

## Verification commands

All commands run from repo root on `aarch64-apple-darwin`. Output summarized; raw output preserved in the heartbeat run log.

| Command | Result |
| --- | --- |
| `pwd` | `/Users/opcw05/newtest/001/OpenAlice` |
| `git rev-parse --show-toplevel` | `/Users/opcw05/newtest/001/OpenAlice` |
| `git status --short` (pre-commit) | new Cargo workspace files + 3 modified files in allowed list |
| `git log --oneline -10` | latest is `74b34f6 test: inline analysis_core fixture loader …` |
| `node -v` | `v25.9.0` |
| `pnpm -v` | `9.15.4` |
| `which rustc cargo rustup` (pre-install) | not found |
| `rustc --version` (post-install) | `rustc 1.95.0 (59807616e 2026-04-14)` |
| `cargo --version` (post-install) | `cargo 1.95.0 (f2d3ce0bd 2026-03-21)` |
| `rustup --version` (post-install) | `rustup 1.29.0 (28d1352db 2026-03-05)` |
| `pnpm install` | `Lockfile is up to date, resolution step is skipped — Already up to date` |
| `cargo metadata --no-deps >/dev/null` | exit 0 (warns about implicit `--format-version`; informational only) |
| `cargo fmt --all --check` | exit 0 |
| `cargo clippy --workspace -- -D warnings` | exit 0 |
| `cargo test --workspace` | 2 unit tests pass; 0 doctests; 0 ignored |
| `pnpm build` | turbo cached + tsup ESM build success in ~3.5s |
| `pnpm test` | 58 files / 1137 tests pass |
| `pnpm test:e2e` | 12 files / 23 passed (58 skipped per existing baseline) |
| `node -e "require('./index.js').bootstrapHealthcheck()"` (in binding pkg) | prints `analysis_core:bootstrap` |
| `npx tsc --noEmit` | exit 0 |

The manifest `provision_command` (`pnpm install && cargo metadata --no-deps >/dev/null`) succeeds end-to-end on this host.

## CI changes

`.github/workflows/ci.yml` now installs Rust 1.95.0 with `rustfmt` + `clippy` via `dtolnay/rust-toolchain@stable` (toolchain selector pins to the same version `rust-toolchain.toml` declares, so future bumps live in one file plus the workflow input) and runs:

```yaml
- run: cargo fmt --all --check
- run: cargo clippy --workspace -- -D warnings
- run: cargo test --workspace
```

The existing `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test` steps are preserved and unchanged in order.

## Notes and follow-ups (not in scope for this issue)

- **`target/` ignore.** `cargo build`/`cargo test` create a workspace-level `target/` directory at the repo root. The root `.gitignore` is **outside** this issue's allowed-files list, so `target/` was not added here. A short follow-up scoped change should add `target/` to the root `.gitignore`. Until then, contributors must avoid `git add target/`.
- **`napi-rs` bridge.** The actual Node-API binding (DTO conversion, panic boundary, generated `.node` artifact, multi-host CI matrix) is deferred to the first `analysis_core` Rust implementation issue. The package shell here is intentionally a JS-only bootstrap so the workspace can compile, test, and round-trip the healthcheck without committing a native binary.
- **First implementation issue.** The first Rust parser slice for `analysis_core` (per the contract's "First future implementation issue" section) is **not** created or assigned by this issue, in line with the non-goals list.

## Rollback

Per the issue's Rollback note, rollback is reverting the bootstrap commits and removing `rust-toolchain.toml`, `Cargo.toml`, `Cargo.lock`, the `crates/` and `packages/node-bindings/` shells, and the cargo CI steps. User-level `rustup`/`cargo` directories left by the installer are not part of the repo and are documented separately if cleanup is required.
