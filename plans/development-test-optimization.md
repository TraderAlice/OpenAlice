# Development and Test Feedback Optimization

Status: Active — dedicated feature-branch iteration on
`codex/dev-test-optimization`; baseline audit is complete and no integration PR
should be opened or merged until the maintainer accepts the initiative.

Delivery mode: Serial / interactive from current `dev`, with an explicit
feature-branch hold. Related increments stay on this branch and remain
independently reviewable.

Owner guides:

- [[docs/development-workflow.md]]
- [[docs/README.md]]

## Problem

OpenAlice has outgrown a verification rule that requires every code change to
run root TypeScript checking and the complete monorepo Vitest suite. The rule
was reasonable when the repository had roughly 179 tracked test/spec files; it
now makes a small UI-only change run more than six thousand tests across Alice,
UTA, CLI, Connector, Electron, scripts, and the UI.

The current documents also disagree with themselves: delivery policy asks for
proportional, surface-specific evidence while the root verification section
still imposes a blanket full-suite gate. The previous CI simplification moved
that cost from GitHub runners to the developer machine instead of designing a
short development feedback loop.

`AGENTS.md` has the same structural problem. It is described as a compact
startup index but currently combines repository invariants, detailed branch and
release procedures, a test manual, plan lifecycle rules, issue policy, and a
copy of the owner-guide index. That duplication makes later workflow changes
easy to patch in one place and contradict in another.

## Baseline Evidence

The Office session-link change merged by PR #1310 changed four UI files. Its
hosted full-test, cross-platform, and dev-smoke jobs were skipped, but local
policy caused the author to run the complete suite:

| Lane | Selection | Observed result |
|---|---|---|
| Complete `pnpm test` | Node and UI projects | 680 files / 6,050 tests collected; about 67 seconds wall time |
| UI project | All UI specs | 279 files / 1,662 tests; about 53 seconds wall time |
| Vitest changed mode from the PR base | Static dependents of the four changed UI files | 5 files / 76 tests; about 16 seconds wall time |

The root `tsconfig.json` includes only `src`, so `npx tsc --noEmit` provides no
coverage for a UI-only change. `cd ui && npx tsc -b` is the relevant type gate.

One hosted over-trigger is also confirmed: `ui/**` starts the CLI Installer
Smoke workflow for a routine `dev` PR, whose surviving checkout-install job
uses a synthetic UI fixture and does not read the changed UI source. UI does
belong in the final Bun payload, so any correction must preserve master and
release artifact acceptance rather than removing that coverage globally.

Counts and timings are measurements, not permanent thresholds. The durable
claim is the ownership mismatch between a small change and the work it
currently purchases.

## Audit Discoveries

- Vitest's Git provider supplies absolute changed-file paths. Its 4.1.5 default
  force-rerun globs do not reliably match a repository nested below a hidden
  directory such as `.codex`; collection-wide manifest/config triggers must be
  absolute and slash-normalized in the resolved workspace configuration.
- Scheduled Actions load their workflow definition from the default `master`
  branch even when jobs check out `dev`. Until the recent Railway-suite split is
  deliberately promoted, the old scheduled definition can combine with the new
  `dev` test exclusions and miss `pnpm test:railway:local`. Treat that as a
  current residual gap, not as evidence that nightly already owns the lane.
- The rolling `dev` CLI workflow builds the platform-neutral server in all four
  native jobs. A recent run spent about 13.7 runner-minutes and was dominated by
  macOS x64; a separate run accepted all candidates before R2 activation failed.
  Candidate correctness and mutable-channel activation should be separable so
  an external upload failure does not encourage rebuilding accepted bytes.
- The historical `codex/usability-improvements` branch had no open PR using it
  as base or head but remained in routine workflow triggers. The branch itself
  stays intact; only the stale CI routing is removed.

## Objective

Create a boring, predictable feedback system in which:

- routine development gets the smallest trustworthy owner-scoped result;
- wider owner changes can deliberately escalate to a complete project suite;
- cross-owner, shared-infrastructure, and hard-to-bound changes run the full
  monorepo suite;
- master promotion, scheduled validation, manual backstops, and stable release
  retain full acceptance;
- `pnpm test` remains the explicit hermetic full-suite contract and never gains
  external Railway or credentialed behavior; and
- `AGENTS.md` becomes a compact entry point whose detailed workflow truth lives
  in the owner guide.

## Decisions

### Keep the full suite explicit

`pnpm test` continues to mean the complete hermetic Node and UI Vitest suite.
It must not be silently redefined as a changed-test command because clean
master, scheduled, and release checkouts need a deterministic full backstop.

### Add an affected-test development lane

Routine feature branches use Vitest's native changed-file dependency selection
against the freshly fetched `origin/dev`. This avoids a repository-owned path
classifier and automatically includes directly changed specs plus statically
importing dependents.

Affected selection is not omniscient. Dynamically imported modules, generated
contracts, route registries, test configuration, package/dependency changes,
and implicit runtime boundaries require an explicit owner suite or the full
suite. Real-surface verification remains required where behavior is visible or
process-dependent.

### Escalate by ownership and risk

The local ladder is:

1. leaf change: affected tests, the owning typecheck, and the real affected
   surface;
2. shared change within one owner: the complete owner project suite plus its
   real surface;
3. cross-owner or uncertain change: root and applicable package typechecks,
   complete `pnpm test`, and each touched surface's acceptance;
4. release, promotion, scheduled, and manual backstop: the existing full lane,
   including platform/package checks owned by that lane.

Cross-surface means crossing code ownership or runtime boundaries. Navigating
between two routes inside the same UI owner does not by itself make a change
cross-surface.

### Make the root instructions an index again

`AGENTS.md` retains global safety and architecture invariants, the branch
authority decision, the compact verification ladder, and links to the durable
guides. Detailed CI job behavior, release exceptions, plan lifecycle procedure,
and the full owner-guide catalog belong in `docs/development-workflow.md`,
`PLANS.md`, and `docs/README.md` respectively.

### Optimize measured waste, not confidence theater

Routine hosted work stays simple. Remove proven duplicate or irrelevant jobs,
narrow over-broad triggers where the distinction is trustworthy, cancel
superseded runs, and reuse accepted artifacts. Do not add a large changed-path
router merely to avoid one small job, and do not weaken master/stable gates to
make development metrics look better.

## Scope

- Root test commands for affected, Node-owner, UI-owner, and full-suite use.
- `AGENTS.md` development, delivery, verification, plan, and guide routing.
- `docs/development-workflow.md` as the detailed authority for the new ladder.
- The applicable OpenAlice development/release skills so they request the same
  evidence as the repository contract.
- Routine PR and rolling `dev` workflow triggers whose work is measured as
  duplicate or unrelated.
- Local timing/selection fixtures that demonstrate the intended feedback loop.

## Non-goals

- Deleting tests or replacing Vitest.
- Making affected-test selection a stable-release gate.
- Weakening trading, persisted-data, credential, Electron/package, installer,
  master-promotion, or stable-release acceptance.
- Moving Railway CLI, real SSH, credentials, deployment, or publication into
  the hermetic default suite.
- Building a custom dependency graph or a general-purpose changed-path CI
  classifier in the first increment.
- Optimizing individual slow specs before the lane topology is correct.

## Work Plan

- [x] Establish the dedicated branch from current `origin/dev` and record the
  feature-branch hold.
- [x] Measure the complete Node/UI suites and reproduce PR #1310 with Vitest
  changed-file selection.
- [x] Trace the 6,000-test run to local policy rather than hosted CI and locate
  the contradictory rules.
- [x] Add explicit affected, Node-project, and UI-project package scripts while
  preserving `pnpm test` as the full hermetic contract.
- [x] Rewrite the root verification policy around the owner/risk ladder and
  remove duplicated workflow prose from `AGENTS.md` without losing global
  safety invariants.
- [x] Update `docs/development-workflow.md` and applicable skills to use the
  same vocabulary, escalation rules, and PR evidence contract.
- [x] Add focused contract coverage for the command and collection-wide
  force-rerun boundaries.
- [x] Remove or narrow confirmed routine hosted over-triggers, beginning with
  the UI-only CLI installer fixture, only when the final Bun/master acceptance
  route remains explicit.
- [x] Measure the rolling `dev` native CLI publication path and identify its
  repeated platform-neutral build plus candidate/activation coupling.
- [ ] Remove only duplicate rolling-publication work that does not contribute
  to an accepted platform artifact, and make activation safely retryable.
- [ ] Run proportional local acceptance for each increment, then run the full
  hermetic and workflow backstops once for the completed initiative.
- [ ] Present the final branch, measurements, and residual platform/release
  risks for maintainer acceptance before opening an integration PR.

## Verification

During implementation:

- exercise the affected command against a committed feature delta and
  staged/unstaged changes;
- confirm an Office-sized UI delta selects its relevant dependency closure;
- confirm Node-only and UI-only project commands do not collect the other
  owner;
- run workflow contract specs after workflow edits;
- validate any edited skill with the skill validator; and
- inspect the rendered browser route for product-facing fixtures used as
  acceptance examples.

At initiative acceptance:

- root and UI typechecks;
- complete `pnpm test`;
- `pnpm test:workflow-contracts`;
- YAML/workflow validation through the repository's contract specs; and
- a comparison table showing old and new work for a UI leaf change, a Node leaf
  change, a shared-owner change, and a cross-owner change.

## Completion Criteria

- A small UI-only feature change no longer has a repository rule requiring
  unrelated Alice, UTA, CLI, Connector, Electron, or script tests.
- A small Node-only feature change likewise avoids collecting the UI project.
- Owners have clear escalation commands rather than permission to skip
  verification.
- `AGENTS.md`, the development workflow guide, package scripts, skills, and
  hosted workflow behavior describe one coherent lane model.
- Full-suite and release gates remain directly runnable and are still required
  at their documented boundaries.
- The maintainer accepts the dedicated branch before it is proposed for `dev`.
