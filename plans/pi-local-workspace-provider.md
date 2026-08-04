# Pi Workspace-Local Provider Injection

Status: Completed

Related issues: none; maintainer-directed runtime debt repair; serial PR #981

Owner guides: [[docs/model-semantics-and-runtime-injection.md]],
[[docs/managed-workspace-runtime.md]], [[docs/workspace-issues-and-scheduling.md]]

## Scope

Move OpenAlice-managed Pi provider registration out of Pi's user-global
`models.json` and into each Workspace, without hiding Pi's native global auth,
settings, packages, trust, or sessions. Preserve existing Workspace model and
effort semantics, migrate installed state safely, and verify the real managed
Pi can discover and call the localized provider.

## Decisions

- Use one generic managed `.pi/extensions/openalice-provider.ts` that reads the
  sensitive local `.pi/openalice-provider.json` sidecar at Pi startup.
- Keep durable provider data limited to facts OpenAlice knows. The extension
  supplies Pi's documented compatibility defaults only when projecting a
  complete `registerProvider()` model.
- Write extension, sidecar, then project selection so a concurrent launch never
  observes a newly selected orphan provider.
- Treat an edited managed extension as user-owned: do not overwrite or delete
  it, and preserve its sidecar on reset so the user-owned code is not stranded.
- Localize active and departed Workspaces before removing stale namespaced
  global provider nodes. Back up both local `.pi` state and global models first.

## Checklist

- [x] Implement Workspace-local Pi registration and reversible ownership.
- [x] Migrate version-1 global provider bindings, including torn model repair.
- [x] Keep new Workspace provider files out of git.
- [x] Add focused adapter, conflict, concurrency, and migration coverage.
- [x] Verify real Pi model discovery and an authenticated mock request.
- [x] Pass repository, runtime-profile, and packaged Electron verification.
- [x] Deliver through the serial `dev` PR workflow.

## Completion Criteria

New and upgraded Workspaces run their selected Pi provider without adding an
OpenAlice node to global `models.json`; user-owned global and local state is
preserved; the migration is idempotent; and required source plus packaged
runtime checks pass.
