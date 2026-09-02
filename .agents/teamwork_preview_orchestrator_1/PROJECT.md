# PROJECT: OpenAlice ↔ LEAN Engine Integration

## Architecture
- **Isolation Principle**: OpenAlice remains the top-level orchestration, AI agent, and Web UI layer. LEAN Engine (`quantconnect/lean:latest`) is containerized via Docker for execution.
- **Additive Config**: Standalone `data/config/lean.json` with `"enabled": false` default.
- **Domain Layer**: `src/domain/lean/` handles service orchestration, config generation, results parsing, experiments store, research integrity engine, and manual journal.
- **AI Tool Layer**: `src/tool/lean.ts` exposes typed tools to ToolCenter.
- **Frontend Layer**: Quant Lab Web UI routes under `src/webui/routes/lean.ts`, pages in `ui/src/pages/QuantLab*`, `ui/src/pages/ResearchIntegrity*`, `ui/src/pages/TradeJournal*`, conditionally mounted when `lean.enabled` is true.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Git Branch & Baseline Setup | Branch off `origin/dev` as `feat/lean-integration` and verify clean test baseline | M0 | ORIGINAL_REQUEST §R1 |
| 2 | Domain Models & LeanService | Types, LeanService, Docker engine runner, config.json generator, result parser | M1 | Plan Phase 2 / R2 |
| 3 | Forex Data Ingestion & Formatting | Forex QuoteBar ZIP/CSV data pipeline, sample EURUSD minute data | M2 | Plan Phase 1, 9 / R3 |
| 4 | Forex Python Strategy Bridge | Python QCAlgorithm strategy templates with spread, leverage, 24/5 sessions | M3 | Plan Phase 3 / R3 |
| 5 | Research Integrity Engine | Out-of-sample splits, walk-forward analysis, Monte Carlo trade resampling, sensitivity | M4 | Plan Phase 5 / R5 |
| 6 | AI Tool Registry & Experiment Memory | `src/tool/lean.ts`, experiment persistence in `data/lean/experiments/` | M5 | Plan Phase 4 / R4 |
| 7 | Quant Lab Frontend Experience | UI views in `ui/src/pages/`, navigation hooks, API client in `ui/src/api/lean.ts` | M6 | Plan Phase 6 / R6 |
| 8 | Non-Destructive System Integration | Additive mounts in List A files (`src/main.ts`, `src/webui/plugin.ts`, etc.) | M7 | Plan List A / R1 |
| 9 | Verification & Automated Test Matrix | Comprehensive unit, integration, and regression tests (`pnpm test`) | M8 | Plan Phase 8 / Acceptance Criteria |
| 10 | Documentation & Runbook | Integration docs, architecture diagrams, operations runbook | M10 | Plan Phase 10 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Git Branch & Baseline Setup | Checkout `feat/lean-integration` from `origin/dev`, baseline tests | none | DONE |
| M1 | Isolated Architecture & Foundation | `src/domain/lean/` (types, service, config-gen, results) | M0 | DONE |
| M2 | Forex Data Ingestion & Pipeline | `data-converter.ts`, `data/lean/data/forex/oanda/minute/eurusd/` | M1 | DONE |
| M3 | Python Algorithm Bridge | Strategy templates (`QCAlgorithm`), Forex models (spread, fees) | M2 | DONE |
| M4 | Statistical Bias & Research Integrity | `src/domain/lean/research-integrity/` (OOS, walk-forward, Monte Carlo) | M3 | DONE |
| M5 | Tool Registry & Experiment Memory | `src/tool/lean.ts`, `experiments.ts`, `algorithms.ts`, `journal.ts` | M4 | DONE |
| M6 | Quant Lab Frontend UI | `src/webui/routes/lean.ts`, `ui/src/pages/`, `ui/src/api/lean.ts` | M5 | IN_PROGRESS |
| M7 | Non-Destructive System Integration | Mount hooks in List A files with `lean.enabled` guard | M6 | PLANNED |
| M8 | Verification & Test Matrix | Full test matrix execution, zero regressions | M7 | PLANNED |
| M10 | Documentation & Runbook | Markdown runbook & architecture docs | M8 | PLANNED |

## Interface Contracts
### OpenAlice AI Tool ↔ LeanService
- `leanCreateStrategy(name, pythonCode, description, parameters)` -> `{ strategyId, path }`
- `leanRunBacktest(strategyId, startDate, endDate, initialCash, symbol)` -> `{ backtestId, status, statistics, charts, orders }`
- `leanResearchIntegrity(experimentId, backtestId)` -> `{ oos, walkForward, monteCarlo, parameterSensitivity, evidence }`
- `leanJournalEntry(...)` -> `{ journalId }`

## Code Layout
- `src/domain/lean/`: Domain logic, Docker runner, config generator, result parser, research integrity, experiment store
- `src/tool/lean.ts`: OpenAlice ToolCenter tools
- `src/webui/routes/lean.ts`: Hono REST routes
- `ui/src/pages/QuantLab*.tsx`, `ui/src/pages/ResearchIntegrity*.tsx`, `ui/src/pages/TradeJournal*.tsx`: Frontend views
- `ui/src/api/lean.ts`: Frontend API client
- `data/config/lean.json`: Isolated config file
- `data/lean/`: Runtime data, algorithms, experiments, results
