# Workspace and Session Lifecycle

This guide owns Workspace offboarding, departed checkout layout, restore/purge,
Session retirement, execution authority, takeover, and interrupted-transition
recovery. Managed-file reconciliation and directional consolidation belong to
[[docs/workspace-template-upgrade.md]] and [[docs/workspace-absorb.md]].

## Active floor and durable identity

`<launcherRoot>/workspaces/` contains active Workspace checkouts only. The
Workspace Manager uses it as cwd, so ordinary filesystem discovery means “desks
currently in service.” The Manager itself is not inserted into the active
registry.

`workspaces.json` answers what can run now. The Catalog answers what existed,
where it went, and whether it can restore. Its rows are never deleted and
Workspace ids are never reused, including after purge. Durable state also owns
resume identities, managed executions, headless history, and provenance under
`<launcherRoot>/state/`.

Workspace transitions are:

```text
active -> offboarding -> departed -> restoring -> active
                              +-> purging -> purged
```

Transition states are durable records, written before registry/filesystem
mutation. Startup recovery finishes interrupted transitions idempotently.

Session `lifecycle` moves active → retired and may recall on Workspace restore.
Independent floor `presence` is active, archived, or deleted; missing means
active. Archive/soft delete does not destroy `SessionRecord`, `resumeId`, native
mapping, run history, Inbox links, or provenance. A retired Session cannot
resume or schedule. An optional successor is handoff metadata, never rewritten
authorship.

The secret-free Session AI binding remains in the Workspace checkout, so
offboarding moves it and restore recalls the same binding rather than applying
changed defaults.

## Session execution authority

`WorkspaceService.executions`, backed by `SessionExecutionManager`, is the only
application entry for starting or stopping Session processes. HTTP, IPC,
conversation tools, Issues, schedules, Connector work, offboarding, and shutdown
share it. PTY/Web containers observe and transport; they do not control process
lifecycle independently.

Every launch supplies concrete origin, intent, surface, and secret-free AI
selection. Birth provenance is immutable; each launch gets an execution id.
The journal records timing, PID, optional task id, phase, runtime activity, and
termination—not secrets, environment, prompts, or command lines.

Phases are `starting → running → stopping → ended`, with `failed` for startup or
runtime failure. Natural exit may go directly to ended/failed. Web activity is
protocol-derived; TUI bytes do not invent model state.

The manager persists admission before spawn, excludes concurrent writers of one
`resumeId`, waits for real exit on stop/handoff, and rejects stale execution
callbacks. Shutdown closes admission and waits for startup/stop plus terminal
persistence. Concurrent dispose callers share one shutdown promise; a closed
service rejects new dispatch.

Roster running/paused is only a projection. Allocation does not mark running,
and metadata writes cannot change process state. Startup closes executions whose
owner restarted and reconciles orphan roster rows. PTY exit never auto-respawns;
a new managed launch gets a new execution id.

A failed execution-journal write blocks new admission. Stop still terminates
the process if journaling fails and reports that persistence failure.

## Interactive takeover and admission

Background dispatch to an occupied Session enters FIFO takeover admission before
acquiring the resume lock. Pending requests leave interactive input available.
The head request reserves identity, stops and awaits the current process, and
retains reservation through background completion. Later requests queue;
interactive starts/prompts cannot race handoff. Different Sessions remain
independent.

The takeover sidecar stores source, request/decision times, inactivity deadline,
and handoff state, not prompts or credentials. Activity resets the server-owned
deadline. Approval and timeout require observed GUI idle; working, compacting,
retrying, and awaiting-input cannot be interrupted by idle takeover. Terminal
handoff requires explicit approval. Rejecting or closing the request dialog does
not stop the Session. Restart cancels pending offers rather than replaying work.

Scheduling offers work; the execution manager decides admission. The persistent
admission sidecar owns launch blocks and never starts work, retries a task, or
advances schedules. Every managed start checks it before spawn; takeover checks
before queue and immediately before handoff. Approval cannot override a block.

Emergency `interrupt(resumeId, executionId, actor)` requires the expected
execution id so a stale click cannot stop a later run. It records actor/reason,
cancels takeovers, terminates the process tree with escalation, and marks
interrupted only after confirmed exit. Partial output/history survive. Failed
stop retains stopping occupancy and stop error for retry. Routine stop and GUI
turn abort remain distinct operations.

Admission blocks are independent of outcomes:

- `user-cooldown` follows explicit user interruption and expires without replay;
- `execution-fault` follows consecutive failures and requires explicit release;
  success resets the streak, interruption does not count as failure.

Releasing one block cannot override another block, active execution, or takeover
ownership. Only user-attributed controls interrupt, release, or change policy;
client-supplied actors are rejected. Release endpoints never start execution.

## Offboarding transaction

Assessment gathers live headless runs, interactive seats/resumeIds, open and
scheduled Issues, Git state, and changed paths. Live headless work is a hard
blocker. Interactive processes pause and Shell scrollback persists. Dirty files
and open Issues are recorded but not blockers because the whole checkout moves.

Before movement Alice writes `.alice/HANDOFF.md` and `.alice/offboarding.json`.
It removes the active registry row, atomically renames the checkout to
`departed-workspaces/<workspaceId>`, retires owned resume identities, and
completes the Catalog transition. Scanner enumeration and dispatch's independent
Catalog check close scheduling races.

Never replace this with “delete registry row, leave folder.” That pollutes floor
discovery and loses restore/provenance semantics.

## Restore and purge

Restore refuses missing archive, occupied active path, or tag collision; returns
the checkout to its exact original cwd and WorkspaceMeta; recalls identities
unchanged; and marks the Catalog active. Exact cwd preserves native trust,
transcript, and project-path state. Presence archive/deletion survives restore.

Restoring an absorbed source intentionally creates two active copies and never
removes target imports. Purge is separate, irreversible, and departed-only. It
removes checkout, interactive Session records, Shell scrollback, and local AI
files while retaining Catalog tombstone, retired resumeIds, headless history,
Inbox, and provenance so signatures resolve to retired/purged, never unknown.

Pre-Catalog orphan directories and adapter allowlists are not upgrade inputs;
restored desks use the live adapter registry.

## Load-bearing paths and verification

- `src/workspaces/workspace-catalog.ts` and `workspace-lifecycle.ts` — durable
  states, offboard/restore/purge, and interrupted recovery.
- `src/workspaces/session-execution-manager.ts` and service execution facade —
  process authority, journal, takeover, interruption, and admission.
- `src/workspaces/resume-registry.ts` — Session retirement/recall/successors.
- `src/workspaces/workspace-absorb.ts` — two-desk transaction and Catalog link.
- `src/webui/routes/workspaces.ts` and Workspace offboarding UI — lifecycle and
  Session-control entry points.

Lifecycle changes require focused Catalog/execution/recovery specs, owning
typechecks, and an isolated real Workspace journey. Exercise interruption
recovery when journal ordering changes and actual process exit before handoff
when ownership changes. Expand runtime acceptance via
[[docs/development-workflow.md]].
