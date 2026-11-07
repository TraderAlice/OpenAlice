# OpenAlice

OpenAlice is a local trading workspace for native coding-agent CLIs. Alice
launches Workspaces and injects trading context; the separate UTA process owns
broker credentials, connections, state, and every trading write. Persisted state
is file-backed rather than database-backed.

Current code, tests, rendered behavior, and GitHub state override stale prose.

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

## Delivery Authority

- Work from current `dev` on a focused feature branch; routine PRs target `dev`.
- After local verification, open and merge routine PRs (`gh pr merge --merge --delete-branch`)
  unless a review pause or feature-branch iteration hold applies. Pending CI
  alone does not block; known product or contract failures must be resolved first.
- A review pause blocks merging. A feature-branch iteration hold keeps work on
  one branch without opening or merging its PR until the maintainer accepts it.
- `master` is the release source; merging there does not publish. Never
  force-push or delete `dev` or `master`, or commit directly to `master`.
  Direct `dev` commits require an explicit integration request.

## Verification

Verify changes proportionally with the affected tests, owning typechecks, and
real surface before merging, and report actual results:

- Tests: `pnpm test:changed` (or `pnpm test` / `pnpm test:integration` for broader changes)
- Typechecks: root `npx tsc --noEmit`, UI `cd ui && npx tsc -b`, or package-local `build`/`typecheck`
- Website (`apps/landing/`): `pnpm --filter @traderalice/landing test && pnpm landing:build`

## Repository Records

- Concrete deferred defects go to GitHub Issues with symptom, reproduction,
  suspected subsystem, reason for deferral, and evidence. Do not create repo
  TODO files or Linear tasks; handle findings already owned by the current
  change in that change.
- Substantial multi-session work uses one canonical `plans/<topic>.md` entry indexed in `plans/index.md` (see [[PLANS.md]]). Never let plans grow unbounded; delete `plans/<topic>.md` and its `plans/index.md` bullet when the work completes.
- `docs/` holds user guides (`docs/guides/`) and architecture notes
  (`docs/architecture/`), indexed by `docs/SUMMARY.md`. Read `docs/architecture/`
  only when you need specific subsystem context, and **do not create or update
  architecture docs unless the user explicitly asks**.
- `README.md` is public positioning. Ask for product framing before rewriting
  its tagline, pillars, hero, or other marketing copy.
