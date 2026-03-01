# Minimal Conflict Manifest (现状全保留)

## Policy

- Strategy: keep all current governance integration changes on this branch.
- Goal: minimize post-pull conflict surface while preserving runnable governance closed-loop.
- Scope date: 2026-03-01 (local branch state).

## Must Keep (长期保留改动)

- Governance script chain and contracts:
  - `scripts/build_decision_packet.py`
  - `scripts/validate_decision_packet.py`
  - `scripts/replay_runtime_state.py`
  - `scripts/verify_freeze_manifest.py`
  - `scripts/verify_environment_lock.py`
  - `scripts/post_pull_sync.py`
  - `scripts/install_post_pull_hooks.sh`
  - `scripts/remove_post_pull_hooks.sh`
  - `scripts/seed_governance_config.py`
  - `scripts/tests/test_governance_pipeline.py`
  - `scripts/tests/test_exit_code_contract.py`
  - `scripts/tests/test_post_pull_sync.py`
- Governance runtime code wiring:
  - `src/core/ports/governance-port.ts`
  - `src/custom/governance/**`
  - `src/upstream-adapters/governance/**`
  - `src/main.ts`
  - `src/core/types.ts`
  - `src/connectors/web/routes/governance.ts`
  - `src/connectors/web/web-plugin.ts`
- Governance config compatibility adapters:
  - `src/upstream-adapters/config/upstream-config-adapter.ts`
  - `src/upstream-adapters/web/upstream-config-route-adapter.ts`
  - `src/connectors/web/routes/config.ts`

## Local Generated, Not Tracked (可回收 / 每次可重建)

- `data/config/governance.json` (seed on demand, intentionally not tracked)
- `data/runtime/governance_seed_report.json`
- `data/runtime/environment_verify_report.json`
- `data/runtime/freeze_verify_report.json`
- `data/runtime/post_pull_sync_report.json`
- `decision_packet/**` (unless explicitly committed for audit snapshots)

## Merge-Sensitive Touchpoints

- `src/main.ts`
  - Reason: high-frequency upstream edits + local governance execution gate.
- `src/core/config.ts`
  - Reason: schema evolution affects governance defaults and write path.
- `src/connectors/web/routes/config.ts`
  - Reason: section alias normalization intersects existing config API behavior.
- `package.json`
  - Reason: script entry collisions during pull/rebase.
- `.gitignore`
  - Reason: governance config tracking policy must remain stable.

## Post-Pull Reconcile Rule

- Preferred sequence:
  1. `pnpm sync:post-pull`
  2. `pnpm sync:install-hooks` (optional persistent local hook mode)
- If upstream touched merge-sensitive files, keep governance gate and route mounts first, then re-apply formatting and import ordering.
