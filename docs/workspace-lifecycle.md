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
    ├── agent-runtime.jsonl         desk occupancy lifecycle journal
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

In-desk floor presence (independent of `lifecycle`):

```text
active <-> archived <-> deleted
```

`presence` answers whether the coworker is on the Ask Alice roster, filed in
the archive, or softly dismissed. Missing `presence` is `active`. Archiving a
running interactive Session first pauses it; the presence write still refuses a
live seat or headless turn. `lifecycle:
retired` still means the coworker left with the Workspace; restore recalls the
desk without washing archived or deleted people back onto the floor.

`SessionRecord` is the durable launcher roster row shared by headless and
interactive execution. Pausing, archiving, soft-deleting, or retiring a Session
does not destroy that row. `resumeId` remains the coworker identity; retirement
is stored on `ResumeIdentityRecord` and retains the roster row, native runtime
mapping, run history, Inbox links, and provenance. Its secret-free AI
configuration lives with the desk at `.alice/sessions/<resumeId>.json`, so
offboarding moves it into the departed checkout and restore recalls the same
binding instead of re-resolving changed Workspace defaults. A retired Session
is not schedulable or resumable. It may carry `successorResumeId` for explicit
handoff. OpenAlice never silently pretends a successor authored the
predecessor's work.

## Session execution authority

`WorkspaceService.executions` is the only application entry point for starting
or stopping a Session process. It exposes terminal, Web, asynchronous dispatch,
synchronous wait, and diagnostic probe operations backed by
`SessionExecutionManager`. HTTP, Electron IPC, conversation tools, Issues,
schedules, Connector-driven work, offboarding, and shutdown share this boundary.
The old service launch methods and coordinator state-transition method are
removed. The exposed PTY/Web containers provide observation and transport, not
process control. An architecture test guards this boundary.

Every launch requires a concrete `origin` (caller kind and entry point, with
Issue/Session/Connector identifiers where applicable), intent, surface, and
secret-free credential/model/effort selection. Birth provenance remains
immutable on the Session; execution provenance records each subsequent launch.

`workspaces/state/session-executions.json` records a unique execution ID,
requested/start/end timestamps, PID, optional task ID, phase, runtime activity,
and termination reason. The phases are `starting -> running -> stopping ->
ended`, with `failed` for startup or runtime failure. A natural exit can go
directly from running to ended/failed. Web protocol activity additionally
reports idle, working, awaiting-input, and other runtime states; TUI does not
invent model activity from terminal bytes.

The manager persists admission before spawning, excludes concurrent writers of
one `resumeId`, waits for actual exit on stop/handoff, and rejects callbacks from
an older execution. A shutdown closes admission and waits for startup/stop work.
PTY exit ends its execution; there is no hidden automatic respawn. A new process
requires another managed launch and receives another execution ID.

Session roster `running/paused` is only a projection. Ordinary metadata updates
cannot change it, and allocating a Session does not mark it running. At startup,
the manager closes executions whose owner restarted and reconciles orphaned
roster rows. A reconciliation record identifies the system recovery operation;
it does not claim to know the original caller of an older unrecorded process.
Existing roster and Session AI storage formats remain unchanged.

Read execution history with
`GET /api/workspaces/:id/sessions/:sid/executions`. It returns `{ executions }`
for that Session; no keys, environment variables, prompts, or command lines are
stored in this journal. A failed journal blocks new execution admission. A stop
still terminates the process if writing its journal fails and reports the
persistence failure to the caller.

## Interactive takeover

Background dispatch to an existing Session enters the execution manager's FIFO
takeover admission before acquiring the resume lock. Pending requests leave
interactive input available. The manager records source, request and decision
times, inactivity deadline and handoff state in
`state/session-executions.json.takeovers.json`. This file also owns the global
idle interval (60 seconds by default, configurable from 10 to 3600 seconds).
Configuration changes apply to new requests. A restart cancels pending requests;
it does not replay work from this diagnostic journal. The journal retains active
requests plus the last 500 resolved requests; no prompt or credential is stored.

User activity within the target Session resets its server-owned deadline.
Approval and timeout both wait for an observed GUI `idle` phase. Working,
compacting, retrying and awaiting-input phases cannot be interrupted by this
mechanism. A terminal has no trustworthy activity signal: it requires explicit
approval, which clearly states that its process will stop. Closing the request
Dialog merely hides it; rejecting declines that caller without stopping the
Session. A Session cannot request its own handoff.

The head request reserves the identity before stopping the current process,
waits for actual exit, and retains its reservation through background completion.
Later requests queue; interactive starts and prompts cannot race the handoff.
Different Sessions remain independent. Shutdown cancels waiting admissions before
stopping managed processes. Failed persistence closes admission.

`GET /api/workspaces/session-takeovers` projects requests and server time;
`POST /api/workspaces/session-takeovers/:requestId/decision` accepts approve or
reject; `PUT /api/workspaces/session-takeovers/settings` sets `idleSeconds`.
Session-local `/activity` requests record interaction without starting a process.
Pending dispatch callers wait for admission; they receive the ordinary task ID
once work is admitted, or a concrete refusal/error. Scheduling cursors retain
their existing dispatch success/failure semantics.

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

### Interruption and Session launch admission

Scheduling offers work; `SessionExecutionManager` decides whether the Session can
accept it. Its persistent admission sidecar (`session-executions.json.admission.json`)
owns launch blocks. It never starts work, retries a task, or advances a schedule.
Every managed start checks admission before spawning; takeover also checks before
queuing and immediately before handoff. Approval cannot override a launch block.

`interrupt(resumeId, executionId, actor)` is the emergency stop for any execution
surface, including headless and stalled startup. The expected execution ID prevents
a stale click from stopping a subsequent run. The manager records who interrupted,
when, and why, cancels pending takeover offers, signals the process tree, escalates
to forced termination, and records `interrupted` only after exit is confirmed.
History and partial output survive. A failed stop retains `stopping`, occupancy,
and `stopError`; another interrupt retries termination. Routine internal `stop`
remains for orderly shutdown, surface replacement and handoff, without a user
cooldown. GUI turn abort remains distinct from terminating the Session process.

Admission blocks are independent of execution outcomes:

- `user-cooldown`: an explicit user interruption blocks all new starts for
  600 seconds by default. The global setting accepts 10–86400 seconds and applies
  to future interruptions. Expiry merely restores eligibility.
- `execution-fault`: three consecutive failed executions block starts until
  explicit user release. Success resets the streak; interruption does not count
  as a failure. Releasing the fault resets its streak.
- Active execution and takeover ownership remain live manager constraints.
  Releasing one persisted block cannot override other blocks or occupancy.

Only user-attributed controls may release blocks or change cooldown policy. HTTP
handlers supply that attribution themselves; client-provided actors are rejected
for interruption. Release and interruption retain actor provenance. Admission
refusals expose `session_blocked`, the current policy blocks, and `retryAt` only
when all policy blocks have deadlines.

The UI reads `GET /api/workspaces/:id/sessions/:sid/control` through
`useSessionControl`. Busy and details dialogs share `SessionControlPanel`.
`POST .../interrupt` requires `executionId`; `POST .../blocks/:blockId/release`
releases only that block. `PUT /api/workspaces/session-controls/settings` changes
`cooldownSeconds`. No release endpoint starts an execution.

The sidecar is new optional state with an explicit version, created lazily; the
execution journal adds optional interruption metadata and an `interrupted` phase.
No existing Session identity/configuration file is rewritten or migrated.
