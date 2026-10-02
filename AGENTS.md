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

## Product and Architecture Boundaries

- AliceProject is the runtime and state-isolation boundary. Each owns a complete
  `OPENALICE_HOME` and Guardian tree; Workspaces and Sessions live within it.
  The Supervisor registry lives outside project homes. Selecting a project
  must not implicitly move, copy, merge, or delete state.
- Native CLIs own the model loop; Alice owns launch and context injection.
  Do not add an in-process model loop or a parallel workflow engine.
- UTA is optional: non-trading startup, onboarding, and Chat must work without it.
- Workspaces are durable and reusable; new agent-facing capabilities belong in
  templates, skills, or satellite repositories.
- Released persisted-state changes require the appropriate migration mechanism,
  not one-off startup cleanup.
- Never put secrets in tracked files, logs, fixtures, PR bodies, or agent instructions.

Details: [[docs/project-structure.md]], [[docs/alice-project.md]], and
[[docs/data-locations.md]].

## Delivery Authority

- Work from current `dev` on a focused feature branch; routine PRs target `dev`.
- After local verification, open and merge routine PRs unless a review pause or
  feature-branch iteration hold applies. Pending CI alone does not block;
  known product or contract failures must be resolved first.
- A review pause blocks merging. A feature-branch iteration hold keeps work on
  one branch without opening or merging its PR until the maintainer accepts it.
- `master` is the release source; merging there does not publish. Never
  force-push or delete `dev` or `master`, or commit directly to `master`.
  Direct `dev` commits require an explicit integration request.
- Prefer merge commits; delete feature branches only after a confirmed merge.

Detailed delivery modes, autonomous-contribution acceptance, CI feedback, and
release procedures live in [[docs/development-workflow.md]].

## Verification Ladder

Verify changes with relevant tests, owning typechecks, and the affected real
surface; report actual results and unverified risks. Detailed test selection,
safety boundaries, and release gates live in [[docs/testing.md]] and
[[docs/development-workflow.md]].

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

