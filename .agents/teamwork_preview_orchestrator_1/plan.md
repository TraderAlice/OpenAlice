# Plan: LEAN Integration in OpenAlice

## Strategy & Workflow
We adopt the Project Orchestrator pattern. Every phase will be executed via subagents:
1. Explorer investigates existing codebase, specs, and requirements.
2. Worker implements changes and executes tests/builds.
3. Reviewer conducts code review and test validation.
4. Challenger performs stress/adversarial checks.
5. Forensic Auditor verifies integrity (no hardcoded cheats, genuine logic).

## Milestone Roadmap
- **M0: Git Branch & Baseline Setup**:
  - Dispatch Explorer/Worker to verify `origin/dev`, checkout branch `feat/lean-integration`, run baseline test suite `pnpm test`.
- **M1: Isolated Architecture & Foundation**:
  - Implement `src/domain/lean/types.ts`, `src/domain/lean/config-gen.ts`, `src/domain/lean/results.ts`, `src/domain/lean/service.ts`, and unit tests.
- **M2: Forex Historical Data Ingestion & Formatting Pipeline**:
  - Implement `src/domain/lean/data-converter.ts`, download/generate EURUSD quote data in LEAN format (`data/lean/data/forex/oanda/minute/eurusd/`).
- **M3: Forex Strategy Formulation & Python Algorithm Bridge**:
  - Create strategy manager `src/domain/lean/algorithms.ts`, base Python strategy templates with spread & leverage.
- **M4: Statistical Bias & Research Integrity Engine**:
  - Implement `src/domain/lean/research-integrity/` (OOS split, walk-forward analysis, Monte Carlo bootstrap resampling, parameter sensitivity).
- **M5: Agent Tool Registry & Experiment Memory**:
  - Implement `src/domain/lean/experiments.ts`, `src/domain/lean/journal.ts`, `src/tool/lean.ts`.
- **M6: Quant Lab Frontend Experience**:
  - Implement `src/webui/routes/lean.ts`, `ui/src/api/lean.ts`, `ui/src/pages/QuantLabPage.tsx`, `ui/src/pages/ResearchIntegrityPage.tsx`, `ui/src/pages/TradeJournalPage.tsx`.
- **M7: Non-Destructive System Integration**:
  - Safely apply additive hooks to List A files (`src/main.ts`, `src/webui/plugin.ts`, `ui/src/tabs/types.ts`, `ui/src/tabs/registry.tsx`, `ui/src/App.tsx`, `ui/src/components/activity-navigation.ts`).
  - Verify `lean.enabled: false` hides all LEAN components.
- **M8: Verification & Automated Test Matrix**:
  - Comprehensive test execution (domain unit tests, tool tests, API route tests, UI tests, full regression `pnpm test`).
- **M10: Documentation & Operational Runbook**:
  - Create architecture and operational guides in `docs/` and project root.
