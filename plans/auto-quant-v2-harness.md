# AutoQuant V2 Harness integration

- Status: `completed`
- Updated: `2026-07-30`
- Related owner guides: [[docs/project-structure.md]],
  [[docs/managed-workspace-runtime.md]], [[docs/workspace-agent-guidance.md]],
  [[docs/workspace-lifecycle.md]], and
  [[docs/workspace-template-upgrade.md]].

## Outcome

OpenAlice exposes AutoQuant as a first-class Agent Harness beside Ask Alice.
Entering the surface resolves one explicit default AutoQuant V2 desk. A fresh
install initializes that durable Workspace once; an install with existing
AutoQuant desks asks the user to select one. Only then can the user send a
quantitative assignment and open a native coding-Agent Session.

## Scope

- Replace the unused Classic creation template with a new `auto-quant-v2`
  template; existing Classic Workspace checkouts remain untouched.
- Default new AutoQuant desks to V2 `v0.8.31` at commit
  `426d815b18450172fbcf4c6b6af77c6ae05a4967`; retain `v0.8.30` and
  `v0.8.27` in the approved catalog for reproducible explicit creation.
- Add a generic template-source catalog and create-time version selection.
- Materialize the exact upstream repository into a local research branch and
  commit a source receipt without installing Python dependencies.
- Add an AutoQuant Activity entry that reuses the Ask Alice composer, runtime,
  credential, Workspace, Session, and file surfaces.
- Preserve AutoQuant's own `AGENTS.md`, while injecting OpenAlice collaboration,
  data, Inbox, and UTA skills.

## Decisions

- AutoQuant remains one unchanged standalone/hosted product shape. OpenAlice
  does not add an AutoQuant service API or mirror its Project/Study/Session
  lifecycle.
- A source version is an immutable creation input, separate from the OpenAlice
  template guidance version. Floating branches and semver ranges are not
  accepted.
- AutoQuant retains its upstream Git history and canonical `origin`; the
  research branch starts at the exact approved release commit and records that
  source in a tracked receipt.
- Dependency installation and quantitative iteration belong to the coding
  Agent inside the desk.
- AutoQuant Workspaces are durable desks. Generic managed-context template
  upgrades remain disabled; future Harness upgrades require an explicit
  AutoQuant-aware workflow.
- AutoQuant readiness is exactly one validated preference pointer to an active
  `auto-quant-v2` Workspace. The research composer never creates or guesses a
  desk.
- Initialization creates the first desk only when none exists. Existing desks
  require explicit selection; switching defaults stays behind the low-frequency
  Workspace control.

## Work

- [x] Add source metadata parsing, create contract, receipt, and Workspace UI
      lineage.
- [x] Add and verify the `auto-quant-v2` bootstrap; remove Classic from new
      Workspace creation.
- [x] Generalize quick-chat Workspace reuse/creation for the AutoQuant Harness.
- [x] Add the AutoQuant Activity, landing composer, URLs, and Workspace/Session
      navigation.
- [x] Add backend, bootstrap, UI, demo, and navigation coverage.
- [x] Walk browser/dev and packaged Electron Workspace paths.
- [x] Add the persisted default-Workspace pointer and idempotent migration.
- [x] Gate AutoQuant research behind initialization or explicit existing-desk
      selection.
- [x] Replace the Workspace-oriented AutoQuant sidebar with the default desk's
      bounded Session history and a low-frequency Workspace control.
- [x] Default new initialization to the immutable AutoQuant V2 `v0.8.31`
      release while retaining the older approved catalog entries.
- [x] Preserve AutoQuant's upstream Git ancestry and `origin` so later upgrades
      remain ordinary Coding Agent-managed fetch and merge work.
- [x] Re-run full repository, demo, browser/dev, and packaged Electron
      verification for the revised entry path.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- real browser/dev AutoQuant entry and creation flow
- `pnpm electron:smoke:workspace`

## Completion

The plan completes when AutoQuant renders no research controls before a valid
default desk exists, initialization or explicit selection establishes that
pointer, every new assignment becomes a Session in the selected desk, and a
fresh desk records the pinned V2 `v0.8.31` source without any Classic migration
or AutoQuant-specific orchestration service.
