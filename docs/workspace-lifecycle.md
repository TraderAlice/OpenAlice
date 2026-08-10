# Workspace and Session Lifecycle

This guide owns Workspace offboarding, departed-directory layout, restore and
purge semantics, Session retirement, handoff artifacts, and recovery after an
interrupted lifecycle transition.

Related guides: [[docs/project-structure.md]],
[[docs/conversation-provenance.md]], and
[[docs/workspace-issues-and-scheduling.md]]. For in-place managed-asset
reconciliation, see [[docs/workspace-template-upgrade.md]].
For directional desk consolidation, see [[docs/workspace-absorb.md]].

## The Active Directory Is an Office Floor

The directory at `<launcherRoot>/workspaces/` contains active Workspaces only.
It is intentionally safe to use as the cwd for a future manager Agent: ordinary
filesystem discovery there means “the desks currently in service,” not “every
desk that has ever existed.”

That manager now exists as the launcher-owned control plane described in
[[docs/workspace-manager.md]]. It is intentionally absent from the active
Workspace registry, so the office floor never contains a synthetic seventeenth
business desk merely because the user opened management chat.

```text
<launcherRoot>/
├── workspaces.json                 active runtime registry only
├── workspaces/                     active Workspace checkouts only
├── departed-workspaces/            retained offboarded checkouts
└── state/
    ├── workspace-catalog.json      complete lifecycle history
    ├── resume-identities.json      identity, lifecycle, and native mappings
    ├── headless-tasks.json         immutable execution history
    └── artifact-provenance.json    immutable attribution history
```

`workspaces.json` answers “what can Alice run now?” The Catalog answers “what
has existed, where did it go, and can it be restored?” Catalog rows are never
deleted and Workspace ids are never reused, including after purge.

## State Machines

Workspace lifecycle:

```text
active -> offboarding -> departed -> restoring -> active
                              |
                              +-> purging -> purged
```

`offboarding`, `restoring`, and `purging` are durable transition records, not
display-only statuses. The Catalog is written before registry/filesystem
mutation. On startup `WorkspaceLifecycleManager.recover()` finishes an
interrupted transition idempotently.

Product Session lifecycle:

```text
active -> retired
   ^         |
   +---------+  Workspace restore / explicit recall
```

`SessionRecord` is only an interactive seat. Removing or pausing one does not
retire the coworker. `resumeId` is the coworker identity; retirement is stored
on `ResumeIdentityRecord` and retains the native runtime mapping, run history,
Inbox links, and provenance. Its secret-free AI configuration lives with the
desk at `.alice/sessions/<resumeId>.json`, so offboarding moves it into the
departed checkout and restore recalls the same binding instead of re-resolving
changed Workspace defaults. A retired Session is not schedulable or resumable.
It may carry `successorResumeId` for explicit handoff. OpenAlice never silently
pretends a successor authored the predecessor's work.

## Offboarding Transaction

Before moving a Workspace, Alice gathers:

- live headless runs;
- interactive Session seats and resumeIds;
- open and scheduled Issues;
- git branch, clean/dirty state, and changed paths.

A live headless run is a hard blocker. Interactive PTYs are paused; Shell
scrollback is persisted. Dirty files and open Issues are not blockers because
the complete checkout moves intact, but they are recorded in the handoff.

Alice writes two self-contained artifacts before the move:

- `.alice/HANDOFF.md` — readable reason, notes, signatures, open Issues, and
  uncommitted paths;
- `.alice/offboarding.json` — the same transition snapshot in a stable
  structured form.

It then removes the active registry row, atomically renames the checkout to
`departed-workspaces/<workspaceId>`, retires every resume identity owned by the
Workspace, and completes the Catalog transition. Scheduled Issue scanning only
enumerates the active registry, and headless dispatch independently rejects a
non-active Catalog row to close scheduling races.

## Restore and Purge

Restore is “rehire with the old desk”:

1. refuse a missing archive, occupied active path, or active tag collision;
2. move the checkout back to its immutable original `activeDir`;
3. re-add the exact durable `WorkspaceMeta` to the active registry;
4. recall its resume identities without changing their ids or native mappings;
5. mark the Catalog row active.

Returning to the exact cwd is load-bearing. Claude, Codex, opencode, Pi, trust
stores, and transcript discovery may key native state by project path.

An absorbed Workspace is still a departed Workspace, with an additional
Catalog link to the active target and its import commit. Restoring it is an
explicit decision to recreate two active copies; it never removes files already
copied into the target.

Purge is deliberately separate and irreversible. It is allowed only after
offboarding. Purge removes the departed checkout, interactive Session records,
Shell scrollback, and the Workspace-local Session AI configuration. It retains
the Catalog tombstone, retired resumeIds, headless run history, Inbox entries,
and artifact provenance so historical signatures still resolve to
“retired/purged,” never “unknown author.”

## Baseline Boundary

The 0.89.2-beta baseline starts with an explicit Workspace Catalog and no
per-Workspace adapter allowlist. Pre-Catalog orphan directories and historical
`agents` arrays are not supported upgrade inputs. Restored desks use the live
installation adapter registry like every other Workspace; the adapter set
present when a desk was created or departed is not part of its durable identity.

## Load-Bearing Code

- `src/workspaces/workspace-catalog.ts` — immutable ids and durable states.
- `src/workspaces/workspace-lifecycle.ts` — assess/offboard/restore/purge and
  interrupted-transition recovery.
- `src/workspaces/workspace-absorb.ts` — directional copy plan, two-desk
  transaction, rollback, and Catalog link.
- `src/workspaces/resume-registry.ts` — active/retired Session signatures and
  successor links.
- `src/webui/routes/workspaces.ts` — lifecycle API surface.
- `ui/src/components/workspace/WorkspaceOffboardingDialog.tsx` — blockers,
  handoff inventory, reason, and notes before departure.
- `ui/src/pages/WorkspaceListPage.tsx` — departed inventory, restore, purge.

Do not reintroduce “delete the registry row and leave the folder in place.” It
pollutes manager discovery, destroys restore metadata, and turns known retired
coworkers into unexplained missing state.
