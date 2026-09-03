# Development and Test Feedback Optimization

Status: Active — the feedback-ladder and `AGENTS.md` checkpoint landed in PR
#1312. The complete development/test loop is now being rebuilt on
`codex/dev-test-loop-refactor`: owner/risk test lanes, CI authority separation,
and retryable rolling-dev activation remain in progress.

Delivery mode: Autonomous / topic contribution from current `dev`. One Draft
PR owns the coherent initiative; independently reviewable commits accumulate
there and it does not merge without maintainer acceptance.

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

The first checkpoint corrected the leaf-versus-full decision but exposed a
second structural mismatch. The root Vitest projects are named for execution
environments (`node` and `ui`), while development decisions need product-owner
boundaries. The `node` project currently contains Alice, UTA, Connector, CLI,
Desktop, shared packages, and repository tooling, so `test:node` is not a
meaningful owner suite. The generic `e2e` label also mixes deterministic local
integration, credentialed read-only network checks, and separately configured
broker writes, hiding both reliability and safety boundaries.

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
- The `node` Vitest project collects every non-UI owner. UTA alone has 51 spec
  files while its package script still prints `no tests yet`; UI, Desktop, and
  OpenTypeBB likewise have specs without a truthful package-level test API.
- `pnpm test:e2e` includes deterministic Workspace/MockBroker lifecycle tests,
  public Hyperliquid network access, and FRED/EIA paths that read configured
  local keys. Network availability and developer configuration therefore alter
  a command documented as ordinary product integration.
- `packages/ibkr` exposes `test:e2e` and `test:all` that place and cancel paper
  TWS orders whenever the default connection is available, without the
  repository's explicit `OPENALICE_UTA_LIVE_PAPER=1` acknowledgement gate.
- The central `CI` workflow multiplexes routine `dev` PR feedback, trusted beta
  version classification, master validation, schedule, and manual backstops.
  Its `build-and-test` job is not required by branch protection and does not
  aggregate the cross-platform or native-startup jobs its name implies.
- A successful rolling-dev run still repeats the platform-neutral server build
  four times. More importantly, candidate upload, mutable alias replacement,
  manifest activation, and live install share one failure boundary, and an old
  rerun has no final `refs/heads/dev == GITHUB_SHA` activation fence.

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
- test commands state both what product owner they cover and whether they may
  use subprocesses, containers, public networks, credentials, or trading
  writes;
- routine `dev` PR clean-build, master/full-source validation, and rolling-dev
  artifact activation are separate authorities rather than conditional modes
  inside one workflow; and
- `AGENTS.md` remains a compact entry point whose detailed workflow truth lives
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

### Separate execution environment from product ownership

Keep the root Node/jsdom Vitest projects as internal execution environments;
do not create one Vitest project per package. The developer-facing API instead
offers a small stable set of owner suites for Alice, UI, UTA, Connector,
Runtime/CLI, Desktop, and repository tooling. `test:node` may remain as a broad
compatibility aggregate, but it is not cited as an owner gate.

Owner selection stays explicit and repository-owned. Do not build a generic
changed-path CI router or require agents to infer package graphs. A contract
check proves that every hermetic spec belongs to the full suite and the
intended owner inventory without accidental overlap or omission.

### Name lanes by their side effects

`pnpm test` and owner suites are hermetic. Deterministic local product E2E stays
under `test:e2e`; host/process/container/package acceptance remains explicit
under surface-specific system commands. Public or credentialed read-only
network checks move to `test:external:readonly`. Every broker-writing suite,
including package-local IBKR tests, requires the same explicit live-paper
acknowledgement and paper/flat-account discipline.

Skipping because a key, network, TWS, Docker, or cloud service is absent is not
success for an external or live lane. It is either an explicit not-run result
or a reported residual gap.

### Split CI by authority, not by paths

A routine PR to `dev` owns one clean Ubuntu workspace build plus workflow
contracts. Full source validation owns `master` PRs, schedule, and manual runs:
root/full type checks, the hermetic suite, local Railway lifecycle, macOS and
Windows builds/tests, and native startup smoke. Exact beta version preparation
keeps its trusted-base classifier inside the master authority. Release and
path-specific installer/Desktop/Docker workflows retain their existing gates.

The legacy aggregate check is removed unless branch protection is deliberately
configured to require a replacement that truly depends on every full-source
job. A post-merge master rerun is not a substitute for the already validated
merge ref and is removed when no publication contract consumes it.

### Make rolling-dev publication a resumable state transition

Rolling `dev` publication proceeds through explicit evidence: source inputs,
platform-neutral outputs, four native candidates, a commit-addressed immutable
candidate receipt, current-head activation, and exact-commit live install.
GitHub artifacts are short-lived transport; R2 immutable receipts record
accepted candidates; the live manifest is the sole channel pointer.

Activation performs a final remote `dev` head comparison before any mutable
write. A superseded SHA exits successfully without activation. Prefer live
manifests that resolve immutable archives directly; fixed aliases may remain
only as a bounded compatibility surface, not as candidate truth. Upload,
activation, and smoke failures retry from their own evidence boundary rather
than rebuilding accepted native bytes.

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

- Root test commands for affected, product-owner, hermetic-full,
  local-system, external-readonly, and live-write use.
- `AGENTS.md` development, delivery, verification, plan, and guide routing.
- `docs/development-workflow.md` as the detailed authority for the new ladder.
- The applicable OpenAlice development/release skills so they request the same
  evidence as the repository contract.
- Routine PR and rolling `dev` workflow triggers whose work is measured as
  duplicate or unrelated.
- Local timing/selection fixtures that demonstrate the intended feedback loop.
- Candidate receipts, activation fencing, and exact-commit live smoke for the
  rolling native CLI preview.

## Non-goals

- Deleting tests or replacing Vitest.
- Making affected-test selection a stable-release gate.
- Weakening trading, persisted-data, credential, Electron/package, installer,
  master-promotion, or stable-release acceptance.
- Moving Railway CLI, real SSH, credentials, deployment, or publication into
  the hermetic default suite.
- Building a custom dependency graph or a general-purpose changed-path CI
  classifier in the first increment.
- Creating one Vitest project per package, moving every spec into a new folder
  taxonomy, or renaming thousands of test cases to express the new lanes.
- Treating retries as evidence that a deterministic product failure is flaky.
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
- [x] Run proportional local acceptance for the feedback-ladder increment and
  the full hermetic and workflow backstops before its integration checkpoint.
- [x] Present the feedback-ladder checkpoint and receive maintainer acceptance
  to integrate it into `dev`.
- [x] Re-audit the accepted checkpoint from current `dev` and identify the
  environment-versus-owner mismatch, mixed E2E risk, package-script drift,
  unguarded IBKR writes, CI authority multiplexing, and dev activation hazard.
- [ ] Add the stable owner-suite API and coverage contracts without multiplying
  Vitest projects or changing the complete hermetic suite's meaning.
- [ ] Split deterministic local product E2E from explicit external read-only
  checks; put every broker write behind the live-paper acknowledgement gate.
- [ ] Split routine `dev` PR clean-build from master/scheduled/manual full-source
  validation and remove misleading or duplicated aggregate/backstop jobs.
- [ ] Publish commit-addressed rolling-dev candidates, fence current-head
  activation, and make upload/activation/live-smoke independently retryable.
- [ ] Build platform-neutral native inputs once and reuse only their explicit
  hash-verified output whitelist across the four host-native candidate jobs.
- [ ] Align `AGENTS.md`, owner guides, package scripts, workflow contracts, and
  applicable skills with the final command and authority vocabulary.
- [ ] Run proportional local acceptance for each later increment, then run the
  full hermetic and workflow backstops once for the completed initiative.
- [ ] Present final measurements and residual platform/release risks for
  initiative completion.

## Verification

During implementation:

- exercise the affected command against a committed feature delta and
  staged/unstaged changes;
- confirm an Office-sized UI delta selects its relevant dependency closure;
- confirm Node-only and UI-only project commands do not collect the other
  owner;
- prove each owner suite selects only its declared hermetic inventory and their
  union remains covered by the full suite;
- prove local E2E performs no external network or trading write, external
  read-only never mutates accounts, and every live-write config fails closed
  without acknowledgement;
- run workflow contract specs after workflow edits;
- exercise stale-SHA, upload retry, activation retry, and exact-commit live
  manifest behavior without publishing real bytes;
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
- `test:e2e`, external read-only checks, local system acceptance, and live-paper
  writes have disjoint, truthful side-effect contracts.
- No broker-writing command can begin merely because a local service or
  credential happens to be present.
- Routine `dev` PR CI, full source validation, rolling preview publication, and
  manual release are separate workflows or explicit authorities with no fake
  aggregate gate.
- A transient publication or activation failure can resume without rebuilding
  four already accepted native candidates, and an old rerun cannot reactivate a
  stale `dev` SHA.
- `AGENTS.md`, the development workflow guide, package scripts, skills, and
  hosted workflow behavior describe one coherent lane model.
- Full-suite and release gates remain directly runnable and are still required
  at their documented boundaries.
- Each integration checkpoint has explicit maintainer acceptance or follows the
  repository's normal serial delivery authority.
