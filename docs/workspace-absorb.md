# Workspace Absorb

Workspace Absorb is directional consolidation: one target desk stays active and
one source desk retires intact.

```text
source Workspace ── reviewed files ──> target Workspace (stays active)
       └──────── exact checkout ────> departed-workspaces/
```

The target keeps its id, cwd, template, Git history, Sessions, and schedules.
The source keeps historical identity but leaves the active floor. This is not a
symmetric merge.

## What moves

Plans use the source Git working tree: tracked files plus untracked, non-ignored
files. Ignored build output and dependency caches do not become target assets.

- A free target path receives the source file at the same path.
- Identical files are duplicates and are not rewritten.
- A content collision requires an explicit keep-target, use-source, or keep-both
  choice. Keep-both places the source below
  `imports/<source-tag>-<source-id>/...`.

Source runtime/configuration assets never move: `.git`, `.alice`, managed prompt/
Skill trees, provider credentials, runtime homes, root template files, `.env*`,
and dependency/build caches remain in the archived source. This prevents silent
persona replacement, schedule reactivation, credential copying, or mixed
template versions. Source Issues/schedules remain readable but stop running
when the source leaves the active registry.

## Identity and provenance

Absorb never rewrites authorship. Source resumeIds retire with the source;
historical artifacts retain original Workspace and Session signatures. Copied
files are new target assets with an audit commit, not target-Session authorship.

The Catalog records `absorbedIntoWorkspaceId`, `absorbedAt`, and target import
commit. The complete source checkout remains inspectable or restorable in
`departed-workspaces/<workspaceId>`, including `.alice/sessions/`. Restore
intentionally creates two active copies and never removes target imports.

## Activity and concurrency

Preview and apply inspect process-backed TUI, Web, and headless activity, not
persisted flags. Exited children are pruned even if outer cleanup was lost.
Review names actual open work rather than hiding it behind a disabled action.

Both desks must be idle and the target staged index clean. Apply holds an
ordered two-Workspace lease so opposite-direction or concurrent mutations
cannot deadlock or race.

## Transaction and recovery

1. Recompute the plan under both leases and reject a stale digest.
2. Snapshot every target path that may change and write an Absorb journal.
3. Offboard the source, closing scheduling/runtime admission before reading it.
4. Copy only reviewed files from the departed checkout.
5. Create one target Git commit with source/plan trailers.
6. Mark the source Catalog row absorbed and remove the journal.

Ordinary failure restores target paths and returns the source to its original
cwd. After process interruption, recovery either finishes a detected Absorb
commit forward or rolls back uncommitted target changes before restoring the
source. The intact source archive is the lossless backstop and is never deleted
by Absorb.

## Load-bearing paths and verification

- `src/workspaces/workspace-absorb.ts` — plan, transaction, rollback, Catalog link.
- `src/workspaces/workspace-operation-guard.ts` — ordered leases/activity exclusion.
- `src/workspaces/workspace-lifecycle.ts` and `workspace-catalog.ts` — source
  offboarding, durable history, restore, and recovery.
- Workspace routes and target Settings UI — preview, choices, apply, and result.

Verification covers collision choices, excluded runtime/secrets, staged/active
blockers, stale digest, lease ordering, rollback, and committed recovery. Run a
real source → target → departed journey and confirm source provenance stays
retired and attributable. Use [[docs/development-workflow.md]] for lifecycle gates.
