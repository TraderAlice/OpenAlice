# Workspace Absorb

Workspace Absorb is the directional form of Workspace merge. The user chooses
one desk to keep and one desk to retire:

```text
source Workspace ── files ──> target Workspace
       │                         stays active
       └── exact checkout ──> departed-workspaces/
```

The product says **“Absorb another Workspace”**, not “merge A and B.” Direction
is load-bearing: the target keeps its id, cwd, template, Git history, Sessions,
and schedules; the source keeps its historical identity but leaves the active
office floor.

Related guides: [[docs/workspace-lifecycle.md]],
[[docs/workspace-template-upgrade.md]], and
[[docs/conversation-provenance.md]].

## What Moves

OpenAlice plans from the source Git working tree: tracked files plus untracked,
non-ignored files. Build output, dependency caches, and other ignored data do
not become target assets merely because they happen to exist on disk.

- A source file whose path is free in the target moves to that same path.
- Identical files are recognized as duplicates and are not rewritten.
- A different file at the same path requires a visible choice: keep the target,
  use the source, or keep both. “Keep both” places the source copy below
  `imports/<source-tag>-<source-id>/...`.
- Source runtime/configuration assets do not move: `.git`, `.alice`, managed
  prompt/skill trees, provider credentials, runtime homes, root template files,
  `.env*` files, and dependency/build caches remain with the archived source
  checkout.

This boundary prevents a consolidation from silently replacing the target
persona, re-enabling a scheduled Issue, copying API keys, or teaching two
different template versions to one Agent. Source Issues and schedules remain
readable in the departed checkout; they stop running when the source leaves the
active registry.

## What Does Not Change Identity

Absorb never rewrites historical authorship:

- source `resumeId` records retire with the source Workspace;
- old Inbox, report, Issue-run, and trade provenance keeps the original
  Workspace and Session signature;
- the Catalog records `absorbedIntoWorkspaceId`, `absorbedAt`, and the target
  Git commit so the UI can explain where the desk went;
- the source checkout moves intact to `departed-workspaces/<workspaceId>` and
  can still be inspected or explicitly restored.

Copied files are new target assets with an audit commit. They do not make the
target Session the author of the source's old work.

## Preparation and Concurrency

Preview and apply inspect process-backed Workspace activity, not persisted
`state: running` flags or a bare counter. The review lists the exact open TUI,
WebPi, and headless turns. An exited child process is pruned from the guard even
if an outer cleanup promise was lost, preventing a zombie “someone is working”
blocker.

Both source and target must have no live interactive or headless work. The
target must also have no staged Git changes, because Absorb creates one isolated
audit commit. Applying holds an ordered two-Workspace operation lease, so two
opposite-direction requests cannot deadlock or mutate either checkout at the
same time.

## Transaction and Recovery

Apply follows this order:

1. recompute the plan under both leases and reject a stale digest;
2. snapshot every target path that may change and write an Absorb journal;
3. offboard the source, closing its scheduling/runtime door before reading it;
4. copy the reviewed files from the departed checkout;
5. create one target Git commit with source/plan trailers;
6. mark the source Catalog row as absorbed and remove the journal.

If a normal error occurs, target paths are restored and the source is restored
to its original cwd. On process restart, the journal either finishes a detected
Absorb commit forward or rolls the uncommitted target changes back before
restoring the source. The source archive is therefore the lossless backstop;
Absorb never deletes it.

## Product Surface

The action lives in the target Workspace settings. Its flow is intentionally a
sentence the user can verify:

1. **Keep this Workspace** — the already-open target.
2. **Choose a Workspace to absorb** — active sources only; never the target.
3. **Review what comes over** — counts, stopped schedules/Sessions, and every
   path collision.
4. **Absorb and archive source** — destructive direction is repeated on the
   final button.
5. **Done** — show the commit and the departed source record.

Do not hide preparation behind a disabled button. If real work is open, list it
by Session/run. If no process evidence exists, applying must not be blocked.
