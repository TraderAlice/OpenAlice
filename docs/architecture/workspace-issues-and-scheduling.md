# Workspace Issues, Scheduling, Inbox, and Activity Journal

This guide owns the autonomous work and delivery loop across Workspaces:
Markdown Issues, schedule scanning, headless execution, Inbox content and file
references, and the append-only Product Activity Journal. Session identity and
execution admission belong to [[docs/workspace-lifecycle.md]].

---

## 1. Self-Describing Issues (`.alice/issues/<id>.md`)

Each Issue is a single Markdown file at `<workspace>/.alice/issues/<id>.md`:

- Without `when`, it is a tracked work item on the Issue Board.
- With `when` (`every` or `cron` with explicit `local`/IANA timezone), it
  schedules headless runs in its owning Workspace. The Markdown body (`What`) is
  the prompt.
- One malformed Issue file never breaks other Issues or Workspaces. Autonomous
  agent writes stay within the caller's Workspace; cross-Workspace Issue edits
  require an attended human-approved Manager turn and a Git commit in the target
  repository.
- `assignee` is the sole execution-ownership contract:
  - `@resumeId`: continues that exact Session and serializes its turns
    (frontmatter cannot override an existing Session's runtime or AI binding).
  - `@new-then-resume`: recruits once, atomically writes the concrete
    `@resumeId` back to frontmatter, and continues that owner thereafter.
  - `@new-each-run`: recruits a fresh Session on every fire.

---

## 2. Schedule Scanning and Headless Execution

```text
Issue file -> ScheduleScanner -> due calculation -> execution admission
           -> new/exact product Session -> native headless Agent
           -> HeadlessTaskRegistry + .structured.json -> optional Inbox push
```

- **Cursor & retry discipline**: `ScheduleScanner` advances the persistent
  marker (`src/workspaces/schedule/marker-store.ts`) only when a durable run is
  accepted. A subsequent launch or runtime failure is that occurrence's single
  attempt and requires explicit retry—never an automatic retry storm. Cron
  catches up by default (`catchUp: false` skips elapsed slots).
- **Run now & Retry now**: `Run now` dispatches an extra turn without moving the
  schedule cursor; `Retry now` re-reads the live Issue for the latest
  failed/interrupted scheduled run and records `retryOfTaskId`. One Issue cannot
  have concurrent runs.
- **Execution truth (`HeadlessTaskRegistry`)**: Each turn gets a unique `taskId`
  (`parentTaskId` tracks continuation lineage). Adapters normalize native
  streams into `assistantText`, ordered text/tool/error blocks, and metrics in a
  debounced `.structured.json` snapshot. `processStarted` is true only after OS
  child `spawn`.
- **`automationHealth`**: A read-time projection from schedule markers, run
  outcomes, owner availability, and installed runtime—never a second persisted
  status. Successful runs may exit silently without pushing to Inbox.

---

## 3. Inbox Content and File References (`alice inbox push`)

Inbox is the durable agent-to-human report surface. Its only authored payload is
immutable Markdown `body` (`--body` or `--body-file`), stamped out-of-band by
Alice with the originating `SessionOrigin` and `@resumeId`.

- **Workspace-rooted references**: Bracket references (`[[reports/close.pdf]]`,
  `[[charts/nvda.png]]`) always resolve relative to the publishing Workspace
  root with strict `realpath` containment (`src/core/inbox-files.ts`). Code
  spans/fences, escaped brackets, and missing files remain literal text.
- **Revision hashes, not copies**: Publication records `fileRevisions`
  (`sha256:<hex>`) on the Inbox entry while files remain in the Workspace.
  Deleting or offboarding a Workspace never deletes published Inbox Markdown.
- **Safe delivery & rendering**: `/api/inbox/:id/files` rechecks the
  authoritative Inbox entry and source Workspace on every read and never serves
  active content as same-origin HTML. `useInboxContent(entry)` and
  `MarkdownContent` render documents as compact file blocks and images inline
  without a separate attachment tray. Connector notifications pass `body`
  unchanged (`content-references.ts` in Connector Protocol owns the pure bracket
  grammar).
- **Read state & bulk triage**: Global unread count is independent of loaded rows
  and local search. Bulk `Mark all as read` snapshots existing unread IDs into
  the v1 read-state sidecar atomically, excludes the active Office dossier
  review checkpoint, leaves newer arrivals unread, and returns the authoritative
  server unread count.

---

## 4. Product Activity Journal (`agent-runtime.jsonl`)

`<launcherRoot>/state/agent-runtime.jsonl` (exposed at `/api/agent-runtime`) is
an append-only stream of product facts answering "what did OpenAlice do for the
user?"

- **Projection, never a dispatch bus**: Domain producers (Agent lifecycle/turns,
  Inbox publications, and News ingest) append facts only after their own durable
  writes succeed. A journal write failure never rolls back domain work, and a
  journal entry never triggers dispatch or replay.
- **Family-aware reads**: Paged reads support family filtering (`agent`,
  `inbox`, `news`) so sparse Inbox/News facts remain reachable alongside dense
  Agent activity; cursor reads (`afterSeq`) stream ordered facts for live UI
  consumers (Office occupancy and Sonner/companion notifications).

---

## 5. Load-Bearing Paths and Verification

- `src/workspaces/issues/{declaration,comments,mutate,board,automation-health,run-failure}.ts`
  — Issue schema, safe mutation, comments, and board/health projections.
- `src/workspaces/schedule/{scanner,marker-store}.ts` — due calculation,
  dispatch guard, and atomic schedule cursors.
- `src/workspaces/{headless-task,headless-task-registry,headless-output}.ts` —
  headless child supervision, bounded diagnostics, and normalized output.
- `src/core/{inbox-store,inbox-files}.ts`, `src/server/inbox-origin.ts`, &
  `ui/src/hooks/useInboxContent.ts` — Inbox storage, origin stamping, and file
  resolution.
- `src/workspaces/agent-runtime-log.ts` & `src/webui/routes/agent-runtime.ts` —
  Product Activity Journal registration, storage, and family-paged reads.

Verify changes with owning root/UI typechecks, focused issue/scanner/headless/
inbox/journal specs, and a real scheduled or `Run now` child-process turn that
publishes an Inbox report with a Workspace file reference.
