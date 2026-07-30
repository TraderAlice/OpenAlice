# AutoQuant V2 Harness integration

- Status: `completed`
- Updated: `2026-07-30`
- Related owner guides: [[docs/project-structure.md]],
  [[docs/managed-workspace-runtime.md]], [[docs/workspace-agent-guidance.md]],
  [[docs/workspace-lifecycle.md]], and
  [[docs/workspace-template-upgrade.md]].

## Outcome

OpenAlice exposes AutoQuant as a first-class Agent Harness beside Ask Alice.
Entering the surface lets the user send a quantitative assignment into an
existing AutoQuant V2 desk or create one at an explicitly pinned upstream
release, then opens the native coding-Agent Session in that Workspace.

## Scope

- Replace the unused Classic creation template with a new `auto-quant-v2`
  template; existing Classic Workspace checkouts remain untouched.
- Pin the first supported source to AutoQuant V2 `v0.8.27` at commit
  `4bf9eb45763776ab5fc2e02829b804594fc377a3`.
- Add a generic template-source catalog and create-time version selection.
- Materialize the exact upstream tree into OpenAlice's fresh local Git Harness
  and commit a source receipt without installing Python dependencies.
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
- OpenAlice's initial-commit Harness rule remains authoritative: upstream Git
  history and pushable remotes are removed, while the exact upstream
  repository, release, and commit are retained in a tracked receipt.
- Dependency installation and quantitative iteration belong to the coding
  Agent inside the desk.
- AutoQuant Workspaces are durable desks. Generic managed-context template
  upgrades remain disabled; future Harness upgrades require an explicit
  AutoQuant-aware workflow.

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

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- real browser/dev AutoQuant entry and creation flow
- `pnpm electron:smoke:workspace`

## Completion

The plan completes when a user can open AutoQuant, create a pinned V2 desk,
launch a native Agent with a quantitative assignment, inspect the exact source
receipt, and return to that desk's Session without any Classic migration or
AutoQuant-specific orchestration service.
