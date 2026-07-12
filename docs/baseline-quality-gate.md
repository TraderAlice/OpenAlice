# Baseline Quality Gate — Pre-M0 Release Readiness Review

**Role:** independent Release Quality Engineer. **Reviewed state:** tag
`v0.1-foundation` (= `d3e54421`), branch `claude/openalice-dev-setup-mr623q`.
**Date:** 2026-07-12. **Environment:** Windows 11, Node v22.19.0, pnpm 11.7.0.
**Method:** every gate re-executed fresh in this review — no prior session
results were trusted. This is a point-in-time record, not an owner guide.

---

## 1. Executive Summary

The repository is in a healthy, reproducible, verifiable baseline state. All
executable gates pass: frozen-lockfile install, root/UI/4-package typechecks,
2,495 unit/integration tests, forced cold build, warm cached build, real
dev-stack boot with clean teardown, Guardian crash/stubborn-owner recovery,
and desktop TypeScript build. The stabilization commit (`76af8705`) was
adversarially re-verified change-by-change: **no regressions found**, and the
circular-dependency graph is byte-identical to the pre-stabilization commit
(proven via a baseline worktree).

Residual risks are real but minor and mostly *pre-existing by design or by
plan* (M0 exists to fix several of them). Two validation gaps are inherent to
the environment: only Windows was exercised locally (macOS/Linux rest on the
CI matrix, which could not be queried — `gh` is not installed here), and the
Electron *packaging* path plus the broker-dependent e2e suite were not
executed (heavy / require broker endpoints; both are separate lanes by repo
design).

**Decision: APPROVED WITH MINOR RISKS** (§ 6).

---

## 2. Validation Performed

| Gate | Command | Result |
|---|---|---|
| Baseline integrity | `git status` at tag | clean tree, `v0.1-foundation` = `d3e54421` ✅ |
| Reproducible install | `pnpm install --frozen-lockfile` | exit 0, tree unchanged after install ✅ |
| Lockfile consistency | (same — frozen mode fails on any drift) | consistent ✅ |
| Type checking (root) | `pnpm typecheck` | exit 0 ✅ |
| Type checking (UI) | `cd ui && npx tsc -b` | exit 0 ✅ |
| Type checking (packages ×4) | `pnpm -F @traderalice/<p> typecheck` | guardian-runtime / ibkr / opentypebb / uta-protocol all PASS ✅ |
| Test suite | `pnpm test` | **207 files passed, 1 skipped · 2,495 tests passed, 9 skipped, 0 failed** (31s) ✅ |
| Production build (cold) | `turbo run build --force` + root `tsup --dts` | 7/7 tasks, 0 cached, 42.9s; tsup ESM+DTS success ✅ |
| Production build (warm) | `pnpm build` (earlier same-day, re-verified) | 7/7 cached FULL TURBO; deleted `dist/electron` restored from cache ✅ |
| Dev server / stack boot | `pnpm test:smoke` | UTA :47333 + Alice :47331/:47332 + Vite :5173 all bound; UTA restart clean; **no orphaned ports** ✅ |
| Process recovery | `pnpm test:guardian-recovery` | crashed-owner lock reclaimed; stubborn owner SIGTERM→forced-stop→reclaimed; PASS ✅ |
| Desktop (Electron main) build | `pnpm electron:tsc` | exit 0 ✅ |
| Unexpected generated files | `git status --porcelain` after all runs | empty ✅ |
| Broken imports / missing deps | implied by tsc ×6 + vitest + esbuild/tsup bundle + real boot | none found ✅ |
| Circular dependencies | `madge --circular` on HEAD **and** on pre-stabilization `84ddf5f6` (throwaway worktree) | 7 cycles, **identical on both commits** → zero regression; pre-existing, type-level (§ 5) ✅ |
| Platform coverage | local = Windows only; `gh` CLI absent → CI history unqueryable | Ubuntu/macOS rest on the CI matrix (`.github/workflows/ci.yml` runs all three); **gap noted** ⚠️ |

Not executed (with reasons): `pnpm test:e2e` (18 specs; single-fork serial
suite requiring live/testnet broker endpoints per its own config comments —
belongs to the UTA live-testing lane, not the PR gate); `electron:pack` +
packaged smokes (full packaging + vendored runtime; covered by the separate
`desktop-package-smoke.yml` workflow, not the per-PR gate).

## 3. Smoke Test Results

Major workflows, their status, and coverage:

| Workflow | Verified how | Automated coverage | Uncovered risk |
|---|---|---|---|
| Stack startup (Guardian → UTA + Alice + Vite) | executed: `test:smoke` HARD checks | smoke script (CI job) | none significant |
| Config load + migrations + auth bootstrap | executed: boot logs show token bootstrap, registry init, 186-entry compat mount | config/migration/auth spec files in suite | — |
| Workspace create / session spawn / resume | spec-level: workspace-creation golden specs, session pool/registry specs (in the 2,495) | strong unit/integration | no UI-driven E2E (browser) — TE-5 gap |
| Claude Code integration (adapter, detection, credential injection) | `claude` CLI present (2.1.108); adapter + agent-detect + ai-config + credential-injection specs all green | strong | live headless probe against a logged-in CLI not run in-gate (runtime readiness path) |
| Issues / schedules / headless dispatch | scanner + declaration + headless-task + registry specs green; dispatch smoke rides `test:smoke` env | strong | real cron-fire over hours (soak) — TE-7 gap |
| Inbox delivery | inbox-store + routes specs | good | — |
| Market data tools | domain client + tool specs (fixture-based) | good | live vendor drift (by design, fixtures) |
| Trading via UTA | UTA domain + routes + simulator specs; UTA booted in smoke (0 accounts) | good at sim level | live-broker scenarios live in the separate UTA live-testing lane |
| UI rendering | `tsc -b` + jsdom component specs + demo-handler contract | moderate | no browser E2E of the 5 golden paths (TE-5) |

Manual test steps for the two least-automated flows are documented inline:
**(a) golden path** — `pnpm dev`, open printed UI URL, create Chat workspace,
send a prompt, confirm agent replies and `inbox_push` lands in Inbox;
**(b) packaged desktop** — `pnpm electron:pack` then `electron:smoke:packaged`.

## 4. Regression Findings (stabilization commit `76af8705`)

Adversarial re-verification of every touched surface:

| Surface | Finding |
|---|---|
| Startup behavior | no code paths touched; smoke boots identically (structured logs, ports, teardown) — **no regression** |
| Configuration loading | `config.ts` lost only an *unreferenced* export (re-verified repo-wide grep incl. `services/`, `apps/`, `scripts/`, `ui/`, `packages/`: zero references) + comment text — **no regression** |
| Claude integration / provider init | `WireShape` alias is type-only (erased); all adapter/injection/preset specs pass; UI uses its own serialized type — **no regression** |
| Workspace detection / task execution | untouched; agent-detect + headless specs green — **no regression** |
| Logging | untouched — **no regression** |
| Build caching | *improved*: pre-fix, the desktop task cached an **empty output set** (a warm-cache build could silently produce no `dist/electron/main.js`); post-fix, forced cold build passes AND cache restore of deleted outputs verified — **regression risk removed, none added** |
| Electron build | `electron:tsc` passes; desktop compiles only `src/**` with workspace deps covered by `^build` hashing (no stale-cache exposure) — **no regression** |
| Test infrastructure | deflaked spec: **10/10 isolated runs + green inside two full-suite runs**; retry params only engage on the failure path — **no regression** |
| Dependency graph | madge cycles identical pre/post commit — **no regression** |

## 5. Remaining Risks

**Release blockers:** none found.

**Important follow-ups (before or during M0):**
1. **Cross-platform confirmation** — this review is Windows-local; require one
   green full CI run (Ubuntu + macOS + Windows) on this branch before M0 work
   starts. (`gh` unavailable here; evidence gap, not a defect.)
2. **Flake fix is statistical** — 10/10 + 2 full suites is strong but not
   proof; watch the first ~10 Windows CI runs. The other ~10 specs sharing the
   plain-`rm` cleanup should get the shared retrying helper (M0 scope).
3. **No linter exists** — conventions are unenforced until M0/F-01 lands
   (first M0 task by design).
4. **Electron packaging lane not exercised** in this review — run
   `desktop-package-smoke.yml` (or local `electron:pack` + packaged smoke)
   before the next desktop release; unaffected by stabilization per § 4.

**Low-priority improvements:**
- 7 pre-existing circular imports (type-level: `core/types ↔ uta-client`,
  `reference/types ↔ providers`, `compaction ↔ session`) — benign at runtime
  today; worth `import type` hygiene when those files are next touched.
- `apps/desktop` declares `engines.node >=20` vs root `>=22` (cosmetic drift).
- `console.*` logging in `src/` (BUG-4, deliberately deferred to M1/F-03).
- pnpm 11.12.0 available vs pinned 11.7.0 (informational; pin is intentional).
- Known-intentional build warnings remain (direct-eval in the sandboxed
  evaluator; Vite chunk-size note).
- E2E suite (18 specs) requires broker endpoints and has no CI lane — by
  design, but it means broker-path regressions surface only in the UTA
  live-testing loop.

## 6. Quality Gate Decision

## **APPROVED WITH MINOR RISKS**

Every locally executable release gate passes with zero failures, the
stabilization commit demonstrably introduced no regressions (including a
worktree-proven identical dependency graph), install is reproducible, and the
real stack boots and recovers cleanly. The residual risks are (a) evidence
gaps inherent to a single-platform review environment and (b) pre-existing
debt that M0 itself is scoped to burn down. Nothing found meets the bar of a
blocker; "APPROVED" outright is withheld only because macOS/Linux and the
packaging lane were not directly exercised in this review.

## 7. Recommendations Before M0

1. **Push the branch and require one green cross-platform CI run** on
   `claude/openalice-dev-setup-mr623q` (or its PR to `dev`) — this converts
   the single remaining evidence gap into evidence. Zero code change needed.
2. Start M0 with **F-01/F-02 (Biome + hooks) first**, then TE-1's shared
   retrying-`rm` helper — both directly retire risks listed in § 5.
3. Fold two cosmetic fixes into M0's mechanical pass: desktop `engines`
   alignment and (optional) `.gitattributes` `eol` normalization for the
   LF/CRLF warnings observed on doc commits.
4. Trigger the desktop packaging smoke workflow once on this baseline so the
   packaged lane has a same-baseline green mark before M0 churn begins.
5. Keep the e2e/broker lane's manual cadence per
   [[docs/uta-live-testing.md]] — no baseline evidence suggests it changed.
