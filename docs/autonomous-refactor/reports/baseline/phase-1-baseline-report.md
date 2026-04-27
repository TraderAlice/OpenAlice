# OpenAlice Phase 1 Baseline Report

## Run metadata
- Run date (UTC): 2026-04-27T07:46:40Z
- Run date (local JST): 2026-04-27 16:46:40 JST
- Resolved working directory (`pwd`): `/Users/opcw05/newtest/001/OpenAlice`
- Git root (`git rev-parse --show-toplevel`): `/Users/opcw05/newtest/001/OpenAlice`
- Node version (`node -v`): `v25.9.0`
- pnpm version (`pnpm -v`): `9.15.4`
- Playbook path read: `docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md`
- Manifest path read: `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`

## Target modules in scope
- `analysis_core`
- `trading_core`
- `store_core`

## Exact commands run
1. `pwd`
2. `git rev-parse --show-toplevel`
3. `git status --short`
4. `node -v`
5. `pnpm -v`
6. `pnpm install`
7. `git status --short` (post-install guardrail check)
8. `pnpm build`
9. `pnpm test`
10. `pnpm test:e2e`

## Pass/fail summary

| Command | Exit code | Result | Duration |
| --- | ---: | --- | ---: |
| `pwd` | 0 | PASS | 0s |
| `git rev-parse --show-toplevel` | 0 | PASS | 0s |
| `git status --short` | 0 | PASS | 0s |
| `node -v` | 0 | PASS | 0s |
| `pnpm -v` | 0 | PASS | 0s |
| `pnpm install` | 0 | PASS | 7s |
| `git status --short` (post-install) | 0 | PASS | 0s |
| `pnpm build` | 0 | PASS | 10s |
| `pnpm test` | 0 | PASS | 6s |
| `pnpm test:e2e` | 1 | FAIL | 22s |

## Command output highlights
- `pnpm test`: `56` files passed, `1097` tests passed.
- `pnpm test:e2e`: `1` file failed, `4` tests failed, `19` passed, `58` skipped.

Failed suite:
- `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts`

Observed failure pattern:
- Assertions expected numeric values but received string values (examples: `98500` vs `"98500"`, `144` vs `"144"`, `100000` vs `"100000"`).
- Representative failing assertions:
  - `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts:50`
  - `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts:80`
  - `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts:107`
  - `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts:136`

## Blockers
- Baseline e2e command is currently failing:
  - Command: `pnpm test:e2e`
  - Blocker: Trading lifecycle e2e parity/type mismatch in `uta-lifecycle.e2e.spec.ts` (numeric expectations receiving string payload values)
  - Impact: Full Phase 1 baseline command set is not green end-to-end.
  - Unblock owner: Trading core/module-contract follow-up owner (recommended to triage before Phase 2 implementation work).

## Workspace mutation check
- No tracked source files outside `docs/autonomous-refactor/reports/baseline/` were modified by this run.
- `git status --short` after baseline execution showed only:
  - `?? docs/autonomous-refactor/reports/`

## Artifacts produced
- `docs/autonomous-refactor/reports/baseline/phase-1-baseline-report.md` (this report)
- `docs/autonomous-refactor/reports/baseline/phase-1-command-summary.tsv` (command exit codes + durations)
- `docs/autonomous-refactor/reports/baseline/phase-1-command-log.txt` (command log)

## Next recommended issue to assign
- `OPE-3` — Write the analysis-core module contract.

Reason:
- This issue is already queued in `todo`, directly depends on a baseline report artifact, and can proceed immediately while the e2e blocker is tracked in parallel for trading scope.
