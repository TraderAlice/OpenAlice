## 2026-08-29T14:51:11Z
You are Worker 2 for Milestone 3 (Strategy Formulation & Python Bridge), Milestone 4 (Research Integrity Engine), and Milestone 5 (AI Tool Registry & Experiment Memory).
Your working directory is /home/monarch/projects/OpenAlice/.agents/teamwork_preview_worker_m3_1.
Original Request: /home/monarch/projects/OpenAlice/.agents/ORIGINAL_REQUEST.md
Project Scope: /home/monarch/projects/OpenAlice/.agents/teamwork_preview_orchestrator_1/PROJECT.md
Plan: /home/monarch/.gemini/antigravity-cli/brain/764e56cc-655f-45aa-b41e-e25d14ac480e/lean-integration-plan.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your exclusive write ownership:
- `src/domain/lean/algorithms.ts` (Strategy CRUD, template loader, parameter parser)
- `src/domain/lean/templates/` (Python QCAlgorithm strategies: EmaCross, LondonBreakout, RsiMeanReversion)
- `src/domain/lean/research-integrity/` (`oos.ts`, `walk-forward.ts`, `monte-carlo.ts`, `sensitivity.ts`, `data-snooping.ts`, `index.ts`, `types.ts`)
- `src/domain/lean/experiments.ts` (Experiment store, parameter sweeps, lineage)
- `src/domain/lean/journal.ts` (Manual trade journal store)
- `src/tool/lean.ts` (Vercel AI SDK tools: leanCreateStrategy, leanRunBacktest, leanGetResults, leanOptimize, leanResearchIntegrity, leanListExperiments, leanJournalEntry, leanFormalizeIdea)
- `src/domain/lean/index.ts` (re-export new modules)
- `src/domain/lean/__tests__/algorithms.spec.ts`
- `src/domain/lean/__tests__/research-integrity.spec.ts`
- `src/domain/lean/__tests__/experiments.spec.ts`
- `src/domain/lean/__tests__/journal.spec.ts`
- `src/tool/__tests__/lean.spec.ts`
