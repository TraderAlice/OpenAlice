# Final Whole-Branch Fix Report

## Result

- Status: DONE_WITH_CONCERNS until the already-required manual MetaEditor compile/harness gate is completed; automated/source verification is green.
- Base: `b67534ab3a68df2ddc44040d942699964fbc2912`.
- Scope: all Critical and Important findings in `.superpowers/sdd/final-review-findings.md`, plus both requested documentation corrections.
- Operator boundary honored: no MT5/MetaEditor launch, MQL compilation, EA attachment, Algo Trading enablement, terminal input change, or broker request occurred.

## Root causes and fixes

1. Mutating gateway validation only checked demo mode and an allowlisted magic. Every entry, reversal-close, and emergency-close gateway now revalidates actual demo mode, exact account login, exact account server, broker/server pairing, chart/configured Gold symbol, and broker magic. The controller also publishes `blocked` / `identity_mismatch` status if a mutation becomes necessary after an account switch; the gateway repeats the validation to close the race between controller evaluation and the sole send primitive.
2. The pending entry latch was cleared after protected-fill reconciliation, so later terminal events inherited whichever decision was currently loaded. The durable latch now retains a separate active-position correlation with opening decision/observation IDs, exact position ID, requested volume/price/stop, evaluated `OrderCalcProfit` risk, and entry comment. Protected fills activate it, restart reconciliation recovers it by position history and comment, reversal `close_requesting` remains correlated to the reversal decision, and durable `closed` / `stopped` events use the opening correlation before it is cleared.
3. Offset-less MQL timestamps were parsed as workstation-local time. The bridge now emits RFC 3339 UTC timestamps with `Z` from `TimeGMT()` for heartbeat, tick-time, completed-D1 capture, and spread capture. Execution-status and spread parsers require canonical UTC. Status and completed-D1 freshness use trusted same-file mtime; cost-model bridge freshness uses the bridge `lastUpdated` mtime.
4. The operator daily-loss equality used `<=`, admitting an entry at the ceiling. It now requires `dailyRealizedLoss < daily_ceiling`; the independent hard `>= 40.00` pause remains in authoritative reconciliation.
5. Completed-D1 validation checked broker/symbol/demo but not server. The read API now requires the expected server and fails unsafe before observation derivation. Read-only execution status parsing now enforces `hfmarkets/HFMarketsGlobal-Demo4` and `icmarkets/ICMarketsSC-Demo` as exact pairs.
6. Lifecycle events copied `decision.maxRiskAmount` into `calculated_risk`. Submission receives the evaluated `environment.calculatedStopRisk`; pending and active correlations persist that actual value, and later position events replay it independently of the configured ceiling.
7. Documentation now describes `both_demo` brokers as independently bound and pausable under their own gates, and names spread files `spread_samples_YYYYMMDD.csv`.

## RED evidence

Command:

```powershell
pnpm exec vitest run src/domain/mt5/completed-d1.spec.ts src/domain/mt5/execution-status.spec.ts src/domain/mt5/demo-decision-service.spec.ts src/domain/mt5/demo-canary-source.spec.ts
```

Expected RED result: exit 1; 4 failed files; 8 failed and 66 passed tests (74 total). Failures were the wrong-server completed-D1 read and executable cycle, broker/server status mismatch, offset-less status timestamp, status freshness based on captured time instead of mtime, missing exact gateway binding, missing active-position lifecycle correlation, and configured ceiling reported as calculated risk.

Additional timezone RED command:

```powershell
pnpm exec vitest run src/domain/mt5/demo-decision-service.spec.ts
```

Expected RED result: exit 1; 1 failed and 7 passed tests. Offset-less spread samples were incorrectly accepted and published.

## GREEN evidence

Focused final command:

```powershell
pnpm exec vitest run src/domain/mt5/completed-d1.spec.ts src/domain/mt5/execution-status.spec.ts src/domain/mt5/demo-decision-service.spec.ts src/domain/mt5/demo-canary-source.spec.ts src/domain/mt5/read-only-bridge.spec.ts
```

Result: exit 0; 5 files passed; 78 tests passed; 0 failed.

Complete Task 10 TypeScript slice:

```powershell
pnpm vitest run src/domain/mt5 src/task/mt5-decision-scheduler.spec.ts src/task/mt5-outcome-importer.spec.ts src/webui/routes/research.spec.ts ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx
```

Result: exit 0; 18 files passed; 188 tests passed; 0 failed; duration 1.76s.

TypeScript compilation:

```powershell
pnpm exec tsc --noEmit
```

Result: exit 0; no diagnostics.

## Builds

All final successful build invocations used repository-documented Node `v22.23.1`, Git `usr/bin` on process `PATH`, and `NODE_OPTIONS=--max-old-space-size=8192` on this Windows host.

```powershell
$env:PATH='C:\Program Files\Git\usr\bin;'+$env:PATH
$env:NODE_OPTIONS='--max-old-space-size=8192'
npx --yes --package node@22 --call "node --version && pnpm -F open-alice-ui build"
npx --yes --package node@22 --call "node --version && pnpm -F open-alice-ui build:demo"
npx --yes --package node@22 --call "node --version && pnpm build"
```

- UI production: exit 0; 3,219 modules transformed; built in 6.21s.
- UI demo: exit 0; 3,219 modules transformed; built in 6.01s.
- Root: exit 0; Turbo 6/6 successful; ESM and DTS succeeded; `dist/main.d.ts` generated.
- Existing non-fatal warnings: missing local `data/config/connectors.json` fallback, UI chunk-size advisory, npm `.npmrc` deprecation warning, and existing direct-`eval` bundler advisory.
- Environment note: the first current-Node UI attempt and one Node 22 worker attempt exited with Windows native code `3221225477`; the unchanged commands succeeded under Node 22 with the memory setting, and the final root retry also completed. No source/build-script workaround was made.

## Recursive scans

- Broker-call scan across all 13 `.mq5`/`.mqh` files: `OrderCheck=1`, `OrderSend=1`, `CTrade=0`; both calls remain only in `JmbCanaryTradeGateway.mqh` inside `CheckedSendCanaryRequest`.
- Prohibited-expansion scan: only three negative-test text matches in `demo-canary-source.spec.ts`; no production canary live-mode/real bypass, EURUSD allowlist, martingale, grid, recovery sizing, or lot-growth implementation.
- Research/API/UI login scan: no `accountLogin`, `account_login`, `expectedAccountLogin`, or `expected_account_login` matches.
- MQL login-sink scan: no raw `ACCOUNT_LOGIN` print/comment/file-write sink.
- Decision boundary scan: no shell, PowerShell, MetaEditor, `OrderCheck`, or `OrderSend` surface in the TypeScript decision service/CLI.
- Learning boundary scan: no policy-root, broker-call, shell, or LLM surface in outcome normalization/import.
- Delimiter scan: balanced braces and parentheses in all 13 MQL sources.

## Changed files

- `.superpowers/sdd/final-fix-report.md`
- `docs/mt5-data-and-training-protocol.md`
- `src/domain/mt5/completed-d1.spec.ts`
- `src/domain/mt5/completed-d1.ts`
- `src/domain/mt5/demo-canary-source.spec.ts`
- `src/domain/mt5/demo-decision-service.spec.ts`
- `src/domain/mt5/demo-decision-service.ts`
- `src/domain/mt5/execution-status.spec.ts`
- `src/domain/mt5/execution-status.ts`
- `src/domain/mt5/read-only-bridge.spec.ts`
- `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryGates.mqh`
- `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryReconcile.mqh`
- `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryState.mqh`
- `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTradeGateway.mqh`
- `tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5`
- `tools/mt5/OpenAliceMt5ReadOnlyBridge.mq5`
- `tools/mt5/README.md`
- `tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5`

## Self-review

- Re-read every final-review finding, approved plan/design safety invariant, and the Task 10 verification contract.
- Confirmed one generic checked-send primitive still owns exactly one `OrderCheck` and one `OrderSend`; no direct result claims a fill and no retry/resend path was added.
- Confirmed every mutation call independently validates the current terminal identity and that an account switch publishes fail-closed status.
- Confirmed protected entry still carries the stop in the original fixed `0.01` request and append/attempt/correlation barriers remain before the broker call.
- Confirmed opening and reversal IDs cannot overwrite one another; active opening evidence survives restart and is cleared only after a durable terminal event is found/appended.
- Confirmed actual calculated risk is distinct from policy/decision ceilings.
- Confirmed exact HFM/IC server pairing, HFM-first rollout, demo/XAUUSD-only scope, login privacy, Research/AI read-only boundary, and learning importer policy-write prohibition remain intact.
- `JmbCanaryState.mqh` was extended only for the required durable correlation record; it was not broadly reorganized or split.

## Concerns

- Manual MetaEditor compilation (`0 errors, 0 warnings`) and the submission-free MQL harness run remain mandatory human Stage 0 gates. They were intentionally not performed from PowerShell/Codex.
- The Windows native worker crash was transient but repeated during builds before final success; final verification is green under Node 22 with the recorded memory setting.
- The expanded reconciliation-latch schema intentionally treats any older latch layout as malformed and fails closed. Plan 3 has not passed Stage 0 deployment; if an old dry-run latch exists, the operator must review it rather than the EA silently migrating or discarding safety state.
