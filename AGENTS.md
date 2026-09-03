# OpenAlice

OpenAlice is a local trading workspace for native coding-agent CLIs. Alice
launches Workspaces and injects trading context; the separate UTA process owns
broker credentials, connections, state, and every trading write. Persisted state
is file-backed rather than database-backed.

This file contains only rules that apply at the start of every task. Current
code, tests, rendered behavior, and GitHub state override stale prose. Before
editing a subsystem, select and read its owner guide from [[docs/README.md]].
Detailed delivery and release procedure lives in
[[docs/development-workflow.md]], test selection and side effects live in
[[docs/testing.md]], and active multi-step work lives in [[PLANS.md]].

## Start Here

```bash
pnpm install              # full local install, including Electron
pnpm dev                  # Guardian -> UTA + Alice + Vite
pnpm dev --takeover       # replace the recorded local Guardian owner tree
pnpm build                # packages + UI + UTA + Alice
pnpm test:changed         # hermetic changed-file closure against origin/dev
pnpm test:owner:ui        # complete hermetic UI owner suite
pnpm test:integration     # deterministic local product integration
pnpm test                 # complete hermetic monorepo Vitest suite
pnpm test:select --help   # owners, lanes, areas, packages, and side effects
```

Before changing files:

1. Run `git fetch origin`, `git status -sb`, and inspect the current diff.
2. Preserve unrelated user changes. Do not reset, overwrite, stash, or commit
   them merely to obtain a clean tree.
3. Routine work starts from current `dev` on a focused feature branch. If the
   checkout is on `master`, a merged branch, or a surprising historical branch,
   establish the intended base before editing.
4. Start from the real surface: reproduce UI/runtime behavior, inspect current
   code, and read the applicable owner guide before designing.
5. Before adding a migration, compatibility parser, or dual-read path, establish
   whether the persisted shape shipped. Replace unreleased `dev`-only shapes
   directly; do not turn them into permanent upgrade boundaries.

## UI Design Workflow

For frontend visual, layout, or interaction changes, separate product design
from implementation.

- In serial work, present viable approaches and tradeoffs, recommend one, and
  align with the maintainer before detailed design or implementation.
- State the selected interaction model, responsive behavior, accessibility
  implications, and shared primitive ownership before editing. Verify the real
  browser route afterward.
- Autonomous work follows the same sequence in its plan or PR, explicitly
  records its own choice, and never implies maintainer approval it did not get.
- Keep ceremony proportional for small fixes without skipping the design
  decision.

## Product and Architecture Boundaries

- `src/` is Alice: Workspace lifecycle, tools, data domains, HTTP/IPC surfaces,
  file-backed state, and the UTA client boundary.
- `services/uta/` owns brokers, accounts, approvals, snapshots, FX, and trading
  writes. Do not move broker state back into Alice.
- The model loop runs in native CLIs (`claude`, `codex`, `cursor-agent`, `agy`,
  `grok`, `omp`, `opencode`, `pi`). Alice owns credentials and injection, not an
  in-process agent loop.
- New agent-facing capabilities normally ship as Workspace templates, skills,
  or satellite repositories. Do not grow a parallel workflow engine in `src/`.
- UTA is optional for non-trading use. Startup, onboarding, and Chat must work
  in lite/read-only mode without a broker carrier.
- Chat and AutoQuant V2 Workspaces are durable and reusable. AutoQuant's
  internal projects and experiments remain owned by its coding agent.
- `OPENALICE_HOME` is the user-state root. Shipped persisted-state changes use
  the migration framework and generated [[src/migrations/INDEX.md]]; never hide
  one-off cleanup in startup code.
- Secrets never belong in tracked files, logs, fixtures, PR bodies, or agent
  instructions. Treat account, auth, provider, sealing, signing, and
  notarization paths as sensitive.

See [[docs/project-structure.md]] for current ownership and entry points.

## Delivery Authority

- `dev` is the routine integration lane and active preview channel. Routine PRs
  target `dev`.
- `master` is the release-source/user-facing lane. Promotion, beta/stable tags,
  version synchronization, feeds, and publication follow the manual contract in
  [[docs/development-workflow.md]]; merging to `master` does not itself publish.
- Do not commit directly to `master`. Avoid direct commits to `dev` unless the
  maintainer explicitly requests integration work. Never force-push or delete
  either branch.
- Prefer merge commits for ordinary PRs. Preserve a feature branch while its
  work is unmerged and delete it only after GitHub records a successful merge.

Choose delivery authority before implementation:

| Mode | Trigger | Delivery |
|---|---|---|
| Serial / interactive | Default when the user is actively steering concrete work | After proportional local verification, open and merge a PR to `dev` without treating pending remote CI as a synchronous lock |
| Autonomous / topic | Explicit `/goal` or autonomous contribution request | Keep one coherent Draft PR open for later acceptance; CI never grants merge authority |

An explicit feature-branch iteration request overrides PR timing in either
mode: keep all related increments on one owned branch and do not open or merge
its PR until the maintainer accepts it. One integrator owns that branch;
parallel workers hand off commits rather than racing to push or creating one PR
per finding.

Pending CI alone does not block serial progress, but a known product or contract
failure must be understood and repaired before adding scope. Beta promotion may
use recorded local acceptance plus the lightweight master PR gates. Stable
release, explicit review pauses, and untrusted contributions retain their full
synchronous gates.

## Verification Ladder

Use the smallest gate that can realistically falsify the change, then escalate
with ownership breadth and risk:

| Change shape | Minimum evidence |
|---|---|
| Leaf change inside one owner | `pnpm test:changed` or an explicit `test:select` intersection; owning typecheck; real affected surface |
| Shared change inside one owner | Matching `pnpm test:owner:*` suite or package-local test; owning typecheck; real affected surface |
| Cross-owner, shared test/build infrastructure, dependency/config change, or uncertain impact | Root and applicable package/UI typechecks; complete `pnpm test`; every touched surface's acceptance |
| Beta promotion | Recorded local full-suite/surface acceptance plus automatic master source gate and Windows dev-stack smoke |
| Manual backstop or stable release | Complete remote matrix and release gates from [[docs/development-workflow.md]] |

`pnpm test:changed` compares the feature branch and working tree with freshly
fetched `origin/dev`. It follows Vitest's static import graph; dynamic imports,
generated contracts, registries, implicit runtime coupling, and a zero-test
selection require an explicit owner/area/package selection or escalation. It
is development feedback, not a release gate. `pnpm test` retains the
deterministic full-suite meaning. See [[docs/testing.md]] for the complete
namespace, composition rules, and side-effect contracts.

Typecheck the owner that changed: root `npx tsc --noEmit` covers `src/`; UI uses
`cd ui && npx tsc -b`; a package uses its own `typecheck` command. Do not cite a
green typecheck that did not include the changed code.

Add the applicable surface gate:

| Surface | Required evidence |
|---|---|
| `ui/` | UI typecheck, changed specs or `pnpm test:owner:ui` as appropriate, and the real browser route |
| UI `/api/*` contract or demo | Update `ui/src/demo/` handlers and walk `pnpm -F open-alice-ui dev:demo` |
| `packages/<name>/` | Package typecheck; use its local `test` or `pnpm test:select --package <workspace-name>` when it owns specs, then escalate to the owner suite for shared behavior |
| UTA state, ledger, staging, or sync | `pnpm test:integration:uta` plus targeted specs from [[docs/uta-live-testing.md]] |
| Broker adapter, order write, or permission | Smallest explicit live-paper scenario; verify demo/paper mode and leave the account flat |
| Workspace issues, schedules, headless dispatch | Follow [[docs/workspace-issues-and-scheduling.md]] |
| Guardian lock, ownership, or takeover | `pnpm test:system:guardian` and the real launcher path |
| Desktop, IPC, PTY, managed runtime, or packaging | Matching unsigned Electron/package smoke from [[docs/managed-workspace-runtime.md]] |
| Root installer or distributed CLI | [[docs/cli-installer.md]], `pnpm test:system:installer`, and the interactive playground before release |
| Docker/server/remote deployment | [[docs/docker-deployment.md]], `pnpm docker:smoke`, or `pnpm test:system:remote` as applicable |
| Persisted state | Apply the shipped-boundary rule above; shipped shapes need an idempotent migration, spec, and regenerated index |
| Onboarding, first run, or auth | Isolated state plus dev and packaged paths where relevant |

`pnpm test` is hermetic: it must not open real SSH, read cloud credentials,
deploy, or publish.
Those system paths remain explicit `test:system:*` or artifact-owner commands.
`pnpm test:integration` is non-trading and must never load configured broker
accounts or contact public providers. External read-only and live-paper lanes
are opt-in; an all-skipped run is not acceptance. Live-paper tests require
explicit `OPENALICE_UTA_LIVE_PAPER=1`, a verified demo/paper account, and a
flat-account check even after failure.

Routine development and package smoke must not read release signing secrets.
If an applicable native, browser, package, or external gate cannot run, state
the exact residual risk; an unrelated green test is not substitute evidence.

## Repository Records

- Concrete deferred defects go to GitHub Issues with symptom, reproduction,
  suspected subsystem, reason for deferral, and evidence. Do not create repo
  TODO files or Linear tasks; handle findings already owned by the current
  change in that change.
- Substantial multi-session work uses one canonical `plans/<topic>.md` entry and
  follows [[PLANS.md]].
- Durable subsystem truth and the complete guide catalog live in
  [[docs/README.md]]. Keep that index current instead of copying it here.
- `README.md` is public positioning. Ask for product framing before rewriting
  its tagline, pillars, hero, or other marketing copy.

## Code Conventions

- ESM only; include `.js` extensions in TypeScript imports.
- Strict TypeScript, ES2023 target.
- Zod for config schemas; TypeBox for tool parameter schemas.
- `decimal.js` for financial arithmetic.
- Prefer shared shadcn/Base UI primitives under `ui/src/components/ui/`.
  Extend that layer before hand-rolling portals, positioning, focus, dismissal,
  keyboard behavior, or bespoke control styling inside a feature.
- Frontend reads of backend-owned data go through a domain hook. Keep
  presentation components prop-driven and test each hook's selection plus
  loading/error semantics.
- Prefer structured Workspace launcher logs; the main process currently uses
  `console` and has no universal pino sink.
