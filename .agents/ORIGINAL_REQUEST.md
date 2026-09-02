# Original User Request

## Initial Request — 2026-08-29T14:02:28Z

Proceed with the approved implementation plan documented in `/home/monarch/.gemini/antigravity-cli/brain/764e56cc-655f-45aa-b41e-e25d14ac480e/lean-integration-plan.md`. Use `origin/dev` as the base branch, Python for the initial LEAN algorithms, sample/appropriate free Forex data for the initial proof of concept, evidence-first research integrity without fake composite scores, and keep Quant Lab hidden until `lean.enabled` is `true`. Follow the plan exactly, preserve all existing OpenAlice functionality, and do not implement Phase 9/live trading. Start implementation now.

Working directory: `/home/monarch/projects/OpenAlice`
Integrity mode: development

## Requirements

### R1. Exact Plan Adherence & Non-Destructive Additive Integration
- Follow the approved technical implementation plan at `/home/monarch/.gemini/antigravity-cli/brain/764e56cc-655f-45aa-b41e-e25d14ac480e/lean-integration-plan.md` exactly.
- Branch off `origin/dev` (e.g. `feat/lean-integration`).
- The integration must be strictly additive. All existing OpenAlice features (UTA trading, broker connectors, Workspaces, existing Quant Analyst / `calculateQuant`, CLI, Web UI) must continue to function unchanged.
- LEAN-specific settings must reside in an isolated configuration structure (`data/config/lean.json`, defaulting to `enabled: false` so that disabling LEAN cleanly unmounts all LEAN-specific hooks).
- Modifications to existing files must be strictly limited to the additive registration hooks identified in List A of the plan (`src/main.ts`, `src/webui/plugin.ts`, `ui/src/tabs/types.ts`, `ui/src/tabs/registry.tsx`, `ui/src/App.tsx`, `ui/src/components/activity-navigation.ts`). Do NOT modify any files in List B.

### R2. Isolated LEAN Execution Architecture
- LEAN Engine execution must run as an isolated containerized service via Docker (`quantconnect/lean:latest`) or standalone process.
- The integration layer (`src/domain/lean/`) must manage configuration generation (`config.json`), historical data directory bindings, and algorithm lifecycle via subprocess orchestration.
- Execution results must be parsed from LEAN's native output JSON into typed TypeScript data structures.

### R3. Forex-First Quantitative Research Layer (Python Algorithms)
- Use Python for initial LEAN algorithms via the LEAN Python bridge.
- Ingest appropriate sample/free historical Forex data (starting with `EURUSD`) formatted into LEAN's expected data layout (`data/lean/data/forex/...`).
- Model Forex-realistic properties (bid/ask quotes, spreads, commission models, 24/5 session times, leverage/margin).

### R4. AI Tool & OpenAlice Integration Layer
- Expose LEAN capabilities to OpenAlice AI agents via typed tools in `src/tool/lean.ts` registered in `ToolCenter` (e.g. `leanCreateStrategy`, `leanRunBacktest`, `leanGetResults`, `leanOptimize`, `leanResearchIntegrity`, `leanJournalEntry`).
- Maintain an experiment history store (`data/lean/experiments/`) to record hypotheses, parameter sweeps, lineage, and backtest results.

### R5. Research Integrity & Statistical Bias Analysis (Evidence-First)
- Provide deterministic evaluation metrics for overfitting, out-of-sample (OOS) validation, walk-forward analysis, parameter sensitivity, and Monte Carlo resampling.
- Adhere strictly to an evidence-first approach: expose raw metrics, calculations, distributions, and academic methodologies rather than arbitrary unverified composite scores (no fake "78/100" numbers).

### R6. Quant Lab Web UI Interface
- Add an additive "Quant Lab" interface in OpenAlice Web UI, kept strictly hidden until `lean.enabled: true`.
- Provide strategy workspace, backtest visualization (equity curves, drawdowns, trade logs), experiment history, and research integrity dashboards following OpenAlice UI conventions.

### R7. Scope Boundary: No Live Trading
- Do NOT implement Phase 9 / live broker execution.
- Maintain an absolute safety boundary: research and backtesting only, with paper trading simulation in LEAN.

## Acceptance Criteria

### Baseline System Integrity & Plan Conformance
- [ ] Base branch is `origin/dev`.
- [ ] Existing OpenAlice test suite (`pnpm test`) passes with zero regressions.
- [ ] OpenAlice boots and functions normally when `lean.enabled: false` (Quant Lab hidden, LEAN tools unmounted).

### Engine & Backtest Execution
- [ ] LEAN executes a standalone EURUSD Python backtest in Docker and produces valid results JSON.
- [ ] The OpenAlice LEAN adapter successfully launches a backtest programmatically and parses output statistics, equity curves, and trade orders into typed structures.

### AI Tool & Experiment Tracking
- [ ] AI agent tools can trigger backtests, retrieve statistics, and record structured experiment runs.
- [ ] Experiment runs are persisted in file-based storage with parameter tracking and lineage.

### Research Integrity Calculations
- [ ] In-sample vs Out-of-Sample metrics, walk-forward splits, and Monte Carlo trade resampling generate mathematically accurate distributions from trade logs with explicit methodology and no arbitrary composite scores.

### Web UI
- [ ] Quant Lab routes and UI pages render cleanly in the Web UI only when `lean.enabled: true`.
