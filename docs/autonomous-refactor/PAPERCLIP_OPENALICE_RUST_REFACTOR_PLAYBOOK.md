---
title: Paperclip-Orchestrated Autonomous Rust Refactor Plan for OpenAlice
version: 1.0
status: Draft
canonical_path: docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md
companion_manifest: docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml
intended_consumers:
  - Human board / operator
  - Paperclip CTO / orchestration agent
  - AI-Coding Programming Robot Studio
  - Module engineers and QA agents
---

# Paperclip-Orchestrated Autonomous Rust Refactor Plan for OpenAlice

## 1. Mission

Build a Paperclip-managed autonomous engineering company that can plan, execute, verify, and document a staged Rust refactor of the OpenAlice modules that are best suited for migration out of TypeScript.

This plan is intentionally **control-plane first**:

- **Paperclip** is the orchestration layer for goals, tasks, approvals, budgets, workspaces, and agent coordination.
- **GitHub** is the source of truth for code, architecture documents, ADRs, benchmarks, and release notes.
- **OpenAlice** remains the application under change.
- **Rust** is introduced only for deterministic, high-value domain cores.

The target is not “rewrite OpenAlice in Rust.” The target is to move the modules with the best performance, correctness, and maintainability payoff into Rust while preserving OpenAlice’s current external behavior.

---

## 2. Why this scope

OpenAlice already has a layered architecture with clear seams between interface, core orchestration, domain logic, and automation. The most suitable Rust targets are the lower-level deterministic modules, not the UI, connectors, or AI provider layer.

### 2.1 In scope

1. **Analysis Core**
   - Current TS areas:
     - `src/domain/analysis/**`
     - `src/domain/thinking/**`
     - TS integration shims in `src/tool/analysis.ts` and `src/tool/thinking.ts`
   - Why:
     - deterministic math
     - formula parsing
     - rolling-window indicators
     - cross-asset calculations

2. **Trading Core**
   - Current TS areas:
     - `src/domain/trading/git/**`
     - `src/domain/trading/guards/**`
     - `src/domain/trading/snapshot/**`
     - selected deterministic parts of `src/domain/trading/account-manager.ts`
   - Why:
     - money/quantity precision
     - safety-critical state transitions
     - guard evaluation
     - snapshot/accounting logic

3. **Storage / Log Core**
   - Current TS areas:
     - `src/core/event-log.ts`
     - `src/core/session.ts`
     - archive/search parts of `src/domain/news/**`
   - Why:
     - append-only JSONL persistence
     - replay/recovery logic
     - fast search and scan workloads

4. **Optional Phase-2 Extension: Symbol Index**
   - Current TS areas:
     - `src/domain/market-data/equity/**` local index/cache logic
   - Why:
     - indexing and search are good Rust candidates
     - not required for the initial migration

### 2.2 Explicitly out of scope for the first autonomous program

Do **not** target these first:

- `ui/**`
- `src/connectors/**`
- `src/ai-providers/**`
- `src/tool/**` except thin integration shims
- `src/domain/trading/brokers/**`
- `src/openclaw/**`
- broad market-data HTTP/provider adapters

These layers are I/O-heavy, SDK-heavy, or intentionally thin orchestration glue. They are not the best first Rust targets.

---

## 3. Operating principles

### 3.1 Modular development principles

The AI-Coding Programming Robot Studio must obey these rules on every task:

1. **One issue = one module boundary**
   - A task may change one primary module and only the minimum required integration shims.

2. **Public behavior stays stable unless the issue explicitly authorizes an API change**
   - Existing OpenAlice tool schemas and external workflows are preserved.

3. **Rust replaces domain internals, not orchestration first**
   - TypeScript remains the control shell during the migration.

4. **Every migration is reversible**
   - Each Rust module must ship behind a feature flag or runtime toggle until parity is proven.

5. **Tests and docs are part of the diff**
   - No implementation-only issues.

6. **No multi-module speculative rewrites**
   - The robot must not “clean up adjacent areas” unless that cleanup is explicitly in scope.

7. **GitHub is canonical for durable engineering knowledge**
   - The playbook, module contracts, ADRs, benchmarks, and test reports live in the repository.

### 3.2 Mandatory autonomous execution invariants

For every issue, the robot must:

- read this playbook first
- read the companion manifest second
- read the module contract for the target module third
- verify the allowed-file list before editing
- create or reuse the correct issue worktree
- run the smallest baseline test set needed before editing
- run the full required acceptance test set before requesting review
- update the issue with:
  - what changed
  - what remains
  - exact commands executed
  - benchmark or verification results
  - rollback note

If blocked, the robot must move the Paperclip issue to `blocked` and leave a precise unblock action.

---

## 4. Paperclip deployment model

## 4.1 Use Paperclip as a control plane, not as a replacement for GitHub

Paperclip should manage:

- goals
- project structure
- agent roles
- task routing
- issue documents
- approvals
- budgets
- routines
- execution workspaces and worktrees
- run logs and audit trail

GitHub should remain the source of truth for:

- source code
- PRs
- code review
- architecture docs
- ADRs
- test fixtures
- benchmark outputs
- release notes

## 4.2 Deployment posture

Recommended posture:

- self-hosted Paperclip instance
- one Paperclip company for this refactor program
- one project workspace rooted at the OpenAlice fork/checkout
- one GitHub fork or organization repository holding the canonical playbook and code

---

## 5. Adapter strategy for the AI-Coding Programming Robot Studio

## 5.1 Decision tree

### Option A — preferred
Use an existing Paperclip-compatible coding adapter if your robot studio already runs through a supported CLI/runtime pattern (for example Claude Code-, Codex-, Copilot-, Cursor-, or similar local agent workflows).

### Option B — second choice
If the robot studio is not already compatible, build a **custom external Paperclip adapter** rather than forking Paperclip core.

### Option C — avoid unless necessary
Do not modify Paperclip core until the adapter/plugin route is proven insufficient.

## 5.2 Custom adapter contract

If a custom adapter is required, implement `robotstudio_local` (or `robotstudio_http`) as a separate installable package with the same split Paperclip uses for other adapters:

```text
packages/adapters/robotstudio-local/
  src/
    index.ts
    server/
      index.ts
      execute.ts
      parse.ts
      test.ts
    ui/
      index.ts
      parse-stdout.ts
      build-config.ts
      config-fields.tsx
    cli/
      index.ts
      format-event.ts
```

### Adapter requirements

The adapter must provide:

- persistent session identity / resume behavior
- structured stdout or event parsing
- workspace-aware execution
- configuration UI fields
- environment diagnostics
- test coverage for parsing and auth/runtime failures

### Adapter acceptance criteria

- can execute a Paperclip task in a project workspace
- can resume task context on later wakes
- can write files in the assigned worktree
- can surface structured transcript output into Paperclip
- passes Paperclip test/typecheck gates if the Paperclip repo is modified

---

## 6. Company design inside Paperclip

Create a Paperclip company named:

```text
OpenAlice Rust Refactor Studio
```

### 6.1 Company goal

```text
Safely refactor the deterministic, correctness-critical modules of OpenAlice into Rust while preserving external behavior, strengthening tests, and making the migration repeatable by autonomous agents.
```

### 6.2 Org chart

Recommended agent structure:

1. **Board (human)**
   - final approvals
   - budget control
   - release approval

2. **CTO / Program Orchestrator**
   - decomposes work
   - enforces scope boundaries
   - routes tasks to engineers
   - requests approvals

3. **Architecture Lead**
   - owns module contracts
   - approves interface boundaries
   - writes ADRs

4. **Adapter & Tooling Engineer**
   - owns Paperclip adapter/plugin work
   - owns worktree/bootstrap automation
   - owns feature flags and integration scaffolding

5. **Analysis Engineer**
   - owns `analysis-core`

6. **Trading Core Engineer**
   - owns `trading-core`

7. **Storage Engineer**
   - owns `store-core`

8. **QA & Benchmark Engineer**
   - owns parity tests, regression suites, and benchmarks

9. **Docs & Release Engineer**
   - owns changelog, migration docs, rollback docs, release notes

### 6.3 Budget policy

Start with conservative budgets and hard stops.

Recommended relative allocation:

- CTO / orchestration: 20%
- Architecture: 10%
- Adapter/tooling: 15%
- Analysis: 15%
- Trading core: 20%
- Storage: 10%
- QA/benchmark: 7%
- Docs/release: 3%

If token spend becomes unstable, reduce periodic heartbeats and rely more on assignment/comment wakes.

---

## 7. GitHub repository layout

Store this program directly in the OpenAlice fork/repository so that the robot works from the same source tree it modifies.

### 7.1 Required repository paths

```text
docs/
  autonomous-refactor/
    PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md
    openalice-rust-refactor.manifest.yaml
    module-contracts/
      analysis-core.md
      trading-core.md
      store-core.md
      symbol-index.md
    adr/
      ADR-001-rust-boundary.md
      ADR-002-feature-flag-policy.md
      ADR-003-binding-strategy.md
    reports/
      baseline/
      benchmarks/
      parity/
crates/
  analysis-core/
  trading-core/
  store-core/
packages/
  node-bindings/
    analysis-core/
    trading-core/
    store-core/
```

### 7.2 Canonical document rule

The GitHub copy is canonical.

Paperclip issue descriptions must always point to:

- the repository path of this playbook
- the target module contract path
- the ADRs relevant to the task

Do **not** rely on issue attachments as the only copy of the document.

---

## 8. Critical operational caveats for Paperclip

1. **Project workspace must be explicitly configured**
   - The OpenAlice repository path must be the project’s primary workspace.
   - Execution must happen inside a project-linked workspace or issue worktree.

2. **Use isolated worktrees for implementation issues**
   - Each active implementation issue gets its own branch/worktree.

3. **Do not depend on issue attachments alone for agent context**
   - Keep the playbook and module contracts in the repo and reference their exact paths in issue descriptions/comments.

4. **If using company import/export, re-enable heartbeats manually after import**
   - Imported companies may arrive with heartbeat timers disabled.

5. **Treat Paperclip plugins/adapters as local/self-hosted infrastructure**
   - This program assumes a persistent self-hosted deployment, not a horizontally scaled cloud plugin setup.

---

## 9. Workspace and branching policy

## 9.1 Branch naming

Use one branch per issue:

```text
refactor/<module>/<paperclip-issue-id>-<short-slug>
```

Examples:

```text
refactor/analysis/PAP-201-port-formula-parser
refactor/trading/PAP-254-stage-commit-guard-kernel
refactor/store/PAP-301-jsonl-session-engine
```

## 9.2 Worktree policy

- each implementation issue runs in an isolated git worktree
- architecture and documentation issues may share the main workspace if no code is modified
- QA issues may use read-only verification worktrees when possible

## 9.3 Provision command

Set the project execution workspace policy so that each new worktree can bootstrap itself.

Recommended `provisionCommand`:

```bash
pnpm install && cargo metadata --no-deps >/dev/null
```

Optional stricter version:

```bash
pnpm install && cargo fmt --version && cargo clippy --version
```

---

## 10. Migration architecture

## 10.1 Binding strategy

Default strategy:

- Rust crates implement deterministic domain logic
- Node-facing bindings expose small DTO-based interfaces
- TypeScript remains the outer orchestration shell

Preferred first implementation style:

- **in-process Node-API bindings** for analysis and trading core
- **Node-API bindings or sidecar** for store core, depending on operational complexity

### 10.2 Feature flags

Add runtime toggles before switching any code path:

```text
OPENALICE_RUST_ANALYSIS=0|1
OPENALICE_RUST_TRADING_CORE=0|1
OPENALICE_RUST_STORE=0|1
```

Until parity is proven:

- default = off in shared environments
- CI exercises both legacy and Rust paths where practical
- shadow comparison may run in tests or debug mode

### 10.3 Public interface rule

The following outer shells remain TypeScript-first during the migration:

- `src/tool/**`
- `src/core/tool-center.ts`
- connectors and UI
- broker-specific adapters

The robot must refactor internals without forcing broad upstream interface churn.

---

## 11. Phase plan

## Phase 0 — Bootstrap the autonomous engineering company

### Objective
Create the Paperclip operating environment and GitHub document structure.

### Tasks

1. Create GitHub paths under `docs/autonomous-refactor/`
2. Commit this playbook and the manifest
3. Create Paperclip company and org chart
4. Create one Paperclip project pointing at the OpenAlice repository workspace
5. Configure execution workspace policy with project worktrees
6. Choose adapter strategy:
   - use existing supported adapter, or
   - implement custom `robotstudio_local` external adapter
7. Define approval flow:
   - architecture review
   - implementation review
   - release review
8. Create baseline issue templates and module contracts

### Exit criteria

- Paperclip company exists
- project workspace resolves to the OpenAlice repo
- at least one engineering agent can execute a no-op task in the workspace
- playbook is present on GitHub
- first task issue can link to the playbook path and module contract path

---

## Phase 1 — Baseline and contract capture

### Objective
Establish a trusted baseline before any Rust code lands.

### Tasks

1. Run current OpenAlice baseline:

```bash
pnpm install
pnpm build
pnpm test
pnpm test:e2e
```

2. Capture current behavior for each target module:
   - indicator outputs and invalid-expression behavior
   - trading stage/commit/push behavior and guard outcomes
   - event/session/news append and query behavior

3. Create module contracts:
   - allowed files
   - public DTOs
   - parity expectations
   - test matrix
   - rollback plan

4. Record baseline benchmarks:
   - formula evaluation speed
   - indicator speed for representative OHLCV sizes
   - trading guard evaluation
   - event/session append throughput
   - archive search latency

### Artifacts

- `docs/autonomous-refactor/module-contracts/*.md`
- `docs/autonomous-refactor/reports/baseline/*`
- golden test fixtures under repo-owned test paths

### Exit criteria

- all baseline tests pass
- contracts exist for each in-scope module
- golden fixtures exist and are checked in

---

## Phase 2 — Analysis Core refactor (`analysis-core`)

### Objective
Port deterministic formula and indicator logic to Rust while preserving the existing TypeScript tool surface.

### Owned areas

- `src/domain/analysis/**`
- `src/domain/thinking/**`
- thin integration edits in:
  - `src/tool/analysis.ts`
  - `src/tool/thinking.ts`

### Rust deliverables

```text
crates/analysis-core/
packages/node-bindings/analysis-core/
```

### Required sub-tasks

1. Freeze the public contract of the current calculation entry points
2. Port formula tokenization/parsing/AST evaluation
3. Port indicator kernels
4. Port deterministic validation/error messages where feasible
5. Build TS-to-Rust adapter layer
6. Add parity tests against golden fixtures
7. Add performance benchmarks
8. Add feature flag switch

### Acceptance tests

- identical or intentionally normalized outputs for supported formulas
- invalid expressions reject cleanly
- no change to TypeScript tool schemas
- benchmark improvement or at minimum no unacceptable regression

### Exit criteria

- `analysis-core` bindings in place
- contract parity passed
- documented rollback path exists

---

## Phase 3 — Trading Core refactor (`trading-core`)

### Objective
Port the deterministic safety-critical heart of Trading-as-Git into Rust without rewriting broker adapters.

### Owned areas

- `src/domain/trading/git/**`
- `src/domain/trading/guards/**`
- deterministic/accounting parts of `src/domain/trading/snapshot/**`
- deterministic/accounting helper sections referenced by `account-manager.ts`

### Rust deliverables

```text
crates/trading-core/
packages/node-bindings/trading-core/
```

### Must remain TypeScript in this phase

- `src/domain/trading/brokers/**`
- UI approval flows
- connector routes
- broker SDK plumbing

### Required sub-tasks

1. Define canonical DTOs for:
   - money
   - quantity
   - order intent
   - staged operation
   - commit record
   - guard result
   - snapshot summary
2. Port stage/commit/push state machine
3. Port guard rule evaluation
4. Port FX and snapshot accounting math
5. Preserve existing outer workflow semantics
6. Add legacy-vs-Rust parity tests
7. Add failure-mode tests and rollback tests
8. Gate activation behind feature flag

### Acceptance tests

- stage → commit → push semantics preserved
- guard pass/fail behavior preserved or explicitly improved with ADR approval
- serialized commit history remains compatible at the outer API boundary
- no precision regressions in monetary fields
- no broker adapter rewrites required

### Extra review requirement

Any change that can affect real-money behavior requires:

- architecture approval
- QA approval
- board approval before default-on rollout

---

## Phase 4 — Storage / Log refactor (`store-core`)

### Objective
Port append-only persistence and archive scanning to Rust without breaking existing on-disk formats.

### Owned areas

- `src/core/event-log.ts`
- `src/core/session.ts`
- archive search portions of `src/domain/news/**`

### Rust deliverables

```text
crates/store-core/
packages/node-bindings/store-core/
```

### Required sub-tasks

1. Define compatibility requirements for existing JSONL data
2. Implement append/read/replay primitives
3. Implement safe recovery behavior
4. Implement archive scan/search path
5. Expose TS-friendly DTOs and iterators/results
6. Add crash/restart compatibility tests
7. Add throughput and latency benchmarks

### Acceptance tests

- existing JSONL files remain readable
- append semantics remain durable and ordered
- replay/recovery behavior matches baseline expectations
- archive search is functionally equivalent
- performance is improved or operationally justified

---

## Phase 5 — Hardening, rollout, and documentation

### Objective
Move from “works in a branch” to “safe to merge and operate.”

### Required sub-tasks

1. Run full cross-module regression suites
2. Verify feature-flag fallback for every Rust path
3. Publish benchmark summaries
4. Update ADRs and migration notes
5. Prepare release checklist
6. Perform staged enablement:
   - local dev only
   - selected canary environment
   - default on (only after approval)

### Exit criteria

- all required tests green
- all module contracts marked satisfied
- rollback toggles verified
- release documentation updated

---

## Phase 6 — Optional Symbol Index migration

This phase is optional and starts only after Phases 2–5 are stable.

### Owned areas

- `src/domain/market-data/equity/**` local indexing/search portions

### Goal
Improve local symbol indexing/search while keeping market-data network adapters in TypeScript.

---

## 12. Issue taxonomy and templates

Every Paperclip issue must have a type.

### 12.1 Types

- `bootstrap`
- `baseline`
- `module-contract`
- `adapter`
- `port`
- `binding`
- `integration`
- `qa`
- `benchmark`
- `docs`
- `release`

### 12.2 Mandatory issue body fields

```markdown
## Objective
## Scope
## Non-goals
## Allowed files
## Dependencies
## Commands to run
## Acceptance criteria
## Expected artifacts
## Rollback note
## Playbook links
```

### 12.3 Required outputs per implementation issue

At minimum, each implementation issue must produce:

- code diff
- test diff
- issue comment summarizing work
- benchmark or verification note
- updated module contract status
- explicit next action or review request

---

## 13. Approval workflow

Use Paperclip execution stages or issue review states to enforce the following gates.

### Gate A — Architecture approval
Required before first code edit on a new module or binding strategy.

### Gate B — Integration approval
Required before switching a TypeScript path to call into Rust.

### Gate C — Release approval
Required before enabling a Rust path by default.

### Special gate — Trading safety approval
Required for any change that can alter trade staging, guard logic, execution semantics, or snapshot accounting.

---

## 14. Test policy

## 14.1 OpenAlice tests

Minimum OpenAlice commands:

```bash
pnpm build
pnpm test
```

When relevant:

```bash
pnpm test:e2e
pnpm test:bbProvider
```

## 14.2 Rust tests

Required for every Rust crate:

```bash
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
```

## 14.3 Required test layers

1. **Rust unit tests**
2. **TypeScript contract tests** comparing legacy vs Rust behavior
3. **Golden fixture tests** for expected outputs
4. **Property tests** where numeric/state invariants matter
5. **Benchmark runs** for before/after comparison
6. **End-to-end OpenAlice smoke tests** for affected user-facing flows

## 14.4 Paperclip tests

Only needed if you modify Paperclip adapter/plugin/UI code.

Minimum Paperclip commands:

```bash
pnpm test
```

When adapter/UI flows are changed:

```bash
pnpm typecheck
pnpm test:e2e
```

---

## 15. Autonomous execution loop for the robot studio

The robot studio must follow this exact operating loop.

### 15.1 Before starting work

1. Read:
   - playbook
   - manifest
   - target module contract
   - relevant ADRs
   - current issue body/comments
2. Validate workspace path
3. Validate branch/worktree
4. Run baseline commands for the task scope

### 15.2 During work

1. Keep changes inside allowed files
2. Prefer additive integration shims first
3. Implement smallest testable slice
4. Run local tests after each meaningful slice
5. Update the issue with durable progress

### 15.3 Before requesting review

1. Run required tests
2. Record command outputs or summarized results
3. Record benchmark delta if applicable
4. Update module contract checklist
5. Request the appropriate approval gate

### 15.4 If blocked

Set issue status to `blocked` and leave:

- exact blocker
- evidence
- proposed next action
- owner of unblock step

---

## 16. Recommended routines inside Paperclip

Create the following routines after Phase 0 is stable.

### 16.1 Nightly regression

- trigger: cron
- owner: QA & Benchmark Engineer
- purpose: run baseline build/test plus contract suites
- policy: no catch-up storm; skip overlapping runs

### 16.2 Weekly upstream sync review

- trigger: cron
- owner: CTO / Program Orchestrator
- purpose: inspect divergence from upstream OpenAlice and create sync issues

### 16.3 Benchmark audit

- trigger: API/manual and optional cron
- owner: QA & Benchmark Engineer
- purpose: refresh benchmark reports after merges

### 16.4 Documentation drift audit

- trigger: weekly cron
- owner: Docs & Release Engineer
- purpose: ensure playbook, manifest, module contracts, and actual paths still match

---

## 17. Definition of done

A module refactor is only done when all of the following are true:

1. Rust crate exists and is documented
2. TypeScript integration shim exists
3. Feature flag exists
4. Required tests pass
5. Benchmarks are recorded
6. Module contract is updated
7. ADRs are updated if boundaries changed
8. Rollback path is tested
9. Paperclip issue is reviewed and closed
10. GitHub PR is merged

---

## 18. Failure and rollback policy

If a Rust migration causes parity failure, performance collapse, or operational instability:

1. disable the relevant feature flag
2. revert to the legacy TypeScript path
3. preserve the failing fixture and benchmark evidence
4. create a focused remediation issue
5. do not continue to later phases until the failure is resolved or the phase is formally descoped

---

## 19. Recommended first issue breakdown

### Epic 0 — Control plane setup
- create company
- create project workspace
- commit playbook and manifest
- configure approvals and budgets

### Epic 1 — Adapter readiness
- validate supported adapter OR build `robotstudio_local`
- verify workspace-aware execution
- verify session resume

### Epic 2 — Baseline capture
- record baseline tests
- create module contracts
- create golden fixtures

### Epic 3 — Analysis core
- parser
- indicators
- binding layer
- parity tests
- benchmarks

### Epic 4 — Trading core
- DTOs
- state machine
- guards
- snapshot math
- bindings
- parity tests

### Epic 5 — Store core
- event log
- session log
- archive search
- compatibility tests

### Epic 6 — Hardening and rollout
- feature flags
- nightly routines
- release docs

---

## 20. Source basis for this plan

This playbook is based on:

- OpenAlice repository architecture and project structure
- OpenAlice package scripts and current monorepo layout
- Paperclip product model, roadmap, adapter model, plugin/workspace model, and development guidance

The operator should keep this playbook aligned with upstream changes in both projects.

