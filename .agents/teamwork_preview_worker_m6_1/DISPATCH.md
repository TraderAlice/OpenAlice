## 2026-08-29T15:06:14Z
You are Worker 3 for Milestone 6 (Quant Lab Frontend Experience) and Milestone 7 (Non-Destructive System Integration).
Your working directory is /home/monarch/projects/OpenAlice/.agents/teamwork_preview_worker_m6_1.
Original Request: /home/monarch/projects/OpenAlice/.agents/ORIGINAL_REQUEST.md
Project Scope: /home/monarch/projects/OpenAlice/.agents/teamwork_preview_orchestrator_1/PROJECT.md
Plan: /home/monarch/.gemini/antigravity-cli/brain/764e56cc-655f-45aa-b41e-e25d14ac480e/lean-integration-plan.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your write ownership:
- `src/webui/routes/lean.ts`
- `src/webui/routes/__tests__/lean.spec.ts`
- `ui/src/api/lean.ts`
- `ui/src/pages/QuantLabPage.tsx`
- `ui/src/pages/StrategyDetailPage.tsx`
- `ui/src/pages/BacktestResultsPage.tsx`
- `ui/src/pages/ResearchIntegrityPage.tsx`
- `ui/src/pages/TradeJournalPage.tsx`
- `ui/src/components/lean/` (components and sub-views)
- Exactly the 6 List A files for additive hooks:
  1. `src/main.ts` (+4 lines: import LeanService & createLeanTools, instantiate leanService and register with toolCenter if not null)
  2. `src/webui/plugin.ts` (+2 lines: import createLeanRoutes, mount app.route('/api/lean', createLeanRoutes(ctx)))
  3. `ui/src/tabs/types.ts` (+5 ViewSpec entries for quant-lab, quant-lab-strategy, quant-lab-results, quant-lab-integrity, quant-lab-journal)
  4. `ui/src/tabs/registry.tsx` (+imports and view module registrations in VIEWS)
  5. `ui/src/App.tsx` (+ 'quant-lab' in Page type union)
  6. `ui/src/components/activity-navigation.ts` (+ Beaker icon import and NavLeaf in beta section)

STRICT CONSTRAINT:
Do NOT modify any files in List B!

Tasks:
1. Implement `src/webui/routes/lean.ts` providing full Hono REST endpoints for config, status, strategies, templates, backtest executions, experiments, trade journal, and research integrity analysis.
2. Implement comprehensive route tests in `src/webui/routes/__tests__/lean.spec.ts`.
3. Implement `ui/src/api/lean.ts` typed API client.
4. Implement all UI pages in `ui/src/pages/` (`QuantLabPage.tsx`, `StrategyDetailPage.tsx`, `BacktestResultsPage.tsx`, `ResearchIntegrityPage.tsx`, `TradeJournalPage.tsx`) using existing OpenAlice UI primitives, design tokens, and components (e.g. `EquityCurve.tsx`, `PageSidebarShell`, Lucide icons).
5. Apply the additive hooks to the 6 List A files with proper conditional guards for `lean.enabled`.
6. Run `npx vitest run src/webui/routes/__tests__/lean.spec.ts src/domain/lean src/tool` and `npx tsc --noEmit`.
7. Verify that when `lean.enabled: false` (default), OpenAlice boots and operates cleanly.
8. Write your completion report to /home/monarch/projects/OpenAlice/.agents/teamwork_preview_worker_m6_1/handoff.md and notify parent.
