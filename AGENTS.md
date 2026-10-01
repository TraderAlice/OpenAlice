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

