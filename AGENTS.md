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

