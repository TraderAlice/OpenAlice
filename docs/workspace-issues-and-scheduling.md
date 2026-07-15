# Workspace Issues and Self-Scheduling

This guide owns the current work-item and automation model: self-describing
markdown issues inside each Workspace, the global Issue board, schedule
scanning, headless execution, and Inbox delivery.

Related guides: [[docs/project-structure.md]] and
[[docs/development-workflow.md]]. Follow-up identity and provenance semantics
live in [[docs/conversation-provenance.md]]. The agent-facing usage manual ships as
`default/skills/self-scheduling/SKILL.md`.

## One Object, Two Roles

Each issue is one file:

```text
<workspace>/.alice/issues/<id>.md
```

- Without `when`, it is a tracked work item on the global Issue board.
- With `when`, the same issue self-schedules a headless run of its owning
  Workspace.

There is no central issue database and no separate schedule definition. Alice
scans every registered Workspace's live files and validates each issue in
isolation. One malformed issue is reported without breaking other files or
workspaces.

## File Contract

```markdown
---
title: Pre-market brief
status: todo
priority: high
assignee: "@workspace"
when: { kind: cron, cron: "30 8 * * 1-5", timezone: America/New_York }
agent: pi
---

Pull pre-market movers and overnight news, write `research/premarket.md`,
then push the report to Inbox. Prepare a concise brief before the trading day.
```

The filename stem is the stable issue id. Frontmatter:

- `title` — required human title.
- `status` — `backlog | todo | in_progress | done | canceled`; default `todo`.
- `priority` — `urgent | high | medium | low | none`; default `none`.
- `assignee` — the single ownership and dispatch contract:
  - `@workspace` means the owning Workspace recruits a new product Session for
    every scheduled fire;
  - an exact `@resumeId` continues one accountable product Session;
  - `@human` or `@unassigned` is valid only for unscheduled work.
- `when` — optional schedule:
  - `{ kind: at, at: <ISO timestamp> }`
  - `{ kind: every, every: <duration> }`
  - `{ kind: cron, cron: <5-field expression>, timezone: local | <IANA zone> }`
- `agent` — optional CLI adapter id for `@workspace`-owned scheduled work;
  otherwise Workspace/default resolution is used. A Session assignee already
  owns its runtime and cannot be overridden here.

Migration `0018_issue_assignee_ownership` removes the retired parallel
`execution` field. It maps `resume` to the former `session:<resumeId>` shape and
fresh/omitted scheduled ownership to the former `workspace` shape.
Migration `0019_issue_session_signatures` then writes those owners as
`@resumeId` / `@workspace`, the same visible signature language used in reports.

The markdown below frontmatter is the Issue's canonical **What**: the work
definition humans inspect and edit. For scheduled Issues, Alice sends this exact
markdown to the Agent Runtime. There is no second prompt in frontmatter and no
description/prompt fallback chain that can drift.

Comments are markdown too, but they are not part of What. They persist in the
adjacent `.alice/issues/<id>.comments.json` sidecar as structured records
(`id`, `author`, `at`, `markdown`, plus optional reply/delivery metadata). The
Issue document is intentionally editable by agents and has no reliable internal
structure, so comments must not depend on a heading surviving an arbitrary
rewrite.

Comments are also the Issue's normal conversation entry. When `assignee` is an
exact `@resumeId`, a comment from somebody else is delivered asynchronously to
that Session and its final reply is appended as another structured comment.
The source comment records `pending`, `replied`, or `failed`, so a durable note
never masquerades as a delivered message. A comment on `@workspace`, `@human`,
or `@unassigned` stays a timeline note: OpenAlice does not invent a new owner
just because somebody commented. An owner commenting on their own Issue is not
echoed back to the same Session.

`done` and `canceled` are terminal and stop scheduled firing. There is no
separate `enabled` flag. A successful one-shot `at` issue is automatically
marked `done`; repeating schedules retain their status.

### Cron clock semantics

Cron describes a wall clock, so the clock belongs in the file rather than in an
operator's memory:

```yaml
# Personal/local intent: follow the machine running this OpenAlice installation.
when: { kind: cron, cron: "0 9 * * *", timezone: local }

# Market intent: 08:30 in New York, including EST/EDT transitions.
when: { kind: cron, cron: "30 8 * * 1-5", timezone: America/New_York }
```

`timezone` accepts `local` or an IANA timezone. Omitting it preserves the former
machine-local behavior for existing Issue files, but new files should state the
clock explicitly. Cron is not an exchange calendar: holidays, early closes, and
"only on a trading day" remain business conditions in What. A future market
calendar primitive can add those semantics without making ordinary reminders
depend on a trading subsystem.

## Agent and Human Surfaces

Agents normally use:

```bash
alice-workspace issue list
alice-workspace issue show --id <id-or-title>
alice-workspace issue create --title "..." --what "..." --when '{"kind":"every","every":"1h"}' --assignee workspace
alice-workspace issue update --id <id> --status done
alice-workspace issue comment --id <id> --text "..."
```

The CLI and MCP tools use the same implementation and write the same files.
Direct file editing is also valid and is the clearest way to author rich What
markdown plus `when` / `assignee` / `agent` frontmatter.

`issue comment` is preferable to a generic `issue ask --owner` for normal
collaboration because it leaves the question and answer in the Issue Activity
timeline. Explicit asks remain useful for interrogating the creator or one
selected historical run without adding a board comment.

Reads such as list/show aggregate all workspaces. Writes from an autonomous or
headless run stay inside its own Workspace. Editing a peer Workspace requires
an attended, human-approved path and a commit in the peer repository.

## Execution Flow

```text
.alice/issues/<id>.md
  -> ScheduleScanner (~60s)
  -> due calculation from `when` + last-fired marker
  -> assignee selects a new Workspace Session or exact resumeId
  -> headless run of the owning Workspace
  -> native agent CLI
  -> normalized reply + message/tool blocks
  -> inbox_push when there is a user-visible result
  -> Inbox item linked to the run and issue
```

The scanner interprets timing only. It hands the visible markdown What to the
agent unchanged. Conditions belong in that prompt: for “notify only if X,” the
run checks X and exits silently when false.

The scanner persists only last-fired markers under the launcher state root.
Schedule semantics remain in the issue file. Markers are written after a
successful dispatch; capacity/transient rejection stays due for retry.

The Issue API also derives an `automationHealth` projection from these markers,
the latest scheduled run, and the assignee's resume availability. It is not
persisted in markdown and does not create another Issue workflow status:

- `not_started`, `due`, `running`, and `healthy` describe normal progress;
- `interrupted` means the work was cut off by launcher restart, or its 30-minute
  watchdog itself woke substantially late (usually computer sleep / launcher
  suspension); this is operational interruption, not an agent-work failure;
- `failed` retains a real timeout, launch error, runtime error, or non-zero
  process exit until a later success;
- `blocked` means the schedule has no future fire, or an exact Session owner is
  missing, retired, or not resumable;
- `inactive` means Issue status `done`/`canceled` has stopped the schedule.

Health measures scheduler fulfillment, not human attention. A successful run
may correctly exit silently when its condition is false, so Inbox delivery is
not a health prerequisite.

Failure explanations are read-side projections from the durable run record.
Old runs therefore gain structured `failure.kind/title/message/retryable`
diagnostics without migration. A killed run close to 30 minutes is a timeout;
a killed run whose watchdog closes much later is described conservatively as a
paused computer/launcher rather than falsely blaming the agent.

The Issue detail offers **Retry now** only for the latest failed or interrupted
scheduled run. Retry re-reads the live Issue and uses the same markdown What,
assignee, runtime, resume mapping, and 30-minute budget as a scheduled fire. It
does not write the last-fired marker, so a recovery attempt never shifts the
Issue's cadence. The backend rejects duplicate/racing retries and returns the
authoritative running detail immediately; there is no automatic retry storm.

Headless runs may overlap with interactive sessions or other runs in the same
checkout. Agents must tolerate concurrent edits. The launcher currently admits
at most eight headless processes globally and serializes registry persistence,
but there is no per-Workspace exclusive lock. One small dispatch-start guard
prevents a manual retry and a schedule tick from launching the same Issue at the
same instant; it is released as soon as the run is registered.

Offboarding is the lifecycle exception: a Workspace with a live headless run
cannot depart. Once its Catalog row enters `offboarding`, new dispatch is
rejected and the active registry row disappears, so its local schedules stop.
An active peer Issue assigned to a retired `@resumeId` remains visibly owned by
that signature but cannot fire until a human assigns an active Session or
restores the departed Workspace. See [[docs/workspace-lifecycle.md]].

## Structured Runtime Output

Claude Code, Codex, opencode, and Pi all emit different JSON event streams.
Adapters translate those streams into one launcher-owned contract while the run
is active:

- `assistantText` — the latest completed assistant reply;
- ordered `text`, `tool`, and `error` message blocks;
- tool name, input, output, and `running | completed | failed` status;
- compact metrics for reply presence, tool count, and tool failures.

The native stream contracts differ materially:

| Runtime | Native one-shot stream | Normalization posture |
|---|---|---|
| Claude Code | completed assistant/tool messages plus result | pair `tool_use` / `tool_result`; keep the latest assistant result |
| Codex | thread/turn lifecycle and started/updated/completed items | commands, file changes, MCP, web search, and collaboration become tools; stream/turn/error items become errors |
| opencode | completed text/tool parts plus step boundaries | terminal tool snapshots become one completed/failed tool block; no token-delta persistence |
| Pi | every session event, including cumulative message/tool updates | parse final messages and tool boundaries; discard transient updates from diagnostics before disk |

Automation reads a debounced `.structured.json` snapshot instead of replaying
an entire vendor log. This makes live polling cheap and gives future workbench
orchestration a stable contract independent of CLI versions. The Runs panel
loads records newest-first in cursor pages (25 initially and 25 older records
on demand), so polling refreshes the active page without repeatedly transferring
the full bounded history. Runs created before this contract are parsed
best-effort from the last 2 MB of stdout when opened.

Bounded stdout/stderr diagnostics remain as a fallback. Adapters may discard
documented high-frequency transient events before persistence: Pi drops
`message_update` (which repeats both the cumulative partial and current message)
and `tool_execution_update`, while retaining final messages, tool boundaries,
errors, and lifecycle events. Each diagnostic stream is still capped at 16 MB
as a second guard. Normalized output is separately bounded to 300 blocks, 64 KB
per text reply, and 8 KB per tool input/output.

## Delivery and Trading Safety

Structured headless output is the live control-plane result, while Inbox is the
durable user-delivery channel. A run with a meaningful report or artifact calls:

```bash
alice-workspace inbox push --doc <path> --comments "<summary>"
```

The launcher binds the run/issue origin; the agent does not pass its own
identity. Attached reports also receive a publication-time SHA-256 revision;
the Inbox still renders the live file, but provenance can distinguish the sent
revision from later edits. A no-change check should exit silently rather than
generating Inbox noise. `alice-workspace inbox read` returns this safe provenance to internal
agents as `origin` (`runId` / `sessionId`, `resumeId`, `issueId`, and `agent`
when available). For append-only entries created before `resumeId` was stamped,
the read path joins the stored run/session handle against the live registries;
native runtime session ids remain backend-only.

When a user opens an Inbox result, the frontend supplies its OpenAlice-owned
`resumeId`. The backend `ResumeRegistry` resolves that identity to the native
Claude/Codex/opencode/Pi session id and resumes the original conversation in an
interactive PTY. Later opens from Inbox, Automation, or the Workspace sidebar
reuse the Session indexed by `resumeId`; native ids never cross the product
protocol. New identities use one stable, human-readable key such as
`resume-calm-amber-river-a1b2c3`: the petname makes product surfaces legible and
the six-character base36 tail supplies global entropy. Existing UUID identities
remain valid and are never renamed. `taskId` remains one execution, while
`parentTaskId` records direct turn lineage. Runs and their logs are retained
rather than silently pruned.

Internal agents use the same product handle through the embedded collaboration
path. `alice-workspace issue ask --id <name> --creator --prompt '<question>'`
queries Issue provenance first without making the caller extract a Workspace or
resume id: it resumes the exact attributable Session,
reconstructs with a fresh worker only when the Workspace is known and no
Session origin exists, or returns unavailable without substituting another
agent. `alice-workspace conversation read --task-id <id>` returns the latest
assistant reply by default; diagnostic tool/message blocks require
`--mode detailed`. New task ids are short `run-xxxxxxxx` codes; existing UUID
task ids remain readable.

Prefer `conversation ask ... --await` for a single follow-up. To question
several independent Sessions, dispatch every ask first, then collect the tasks
in one `conversation collect --task-id <a> --task-id <b>` call so the runs
overlap. If server-side collection reaches its budget while a task still runs,
use a later collect or one-shot read; agents should not manufacture shell sleep
loops.

The Issue detail UI treats scheduling as an intrinsic Work item capability.
`assignee: "@workspace"` recruits a new Session on every fire;
`assignee: "@resumeId"` keeps one responsible Session. Only the latter
has a stable owner to ask; Workspace-owned execution exposes the creator and
each concrete run as separate follow-up targets.

Scheduling never bypasses trading approval. A headless agent may research or
stage a trade, but execution remains behind UTA/Trading-as-Git permission and
human approval boundaries. The Trading-as-Git commit log remains the durable
trade decision trail; Issue automation does not duplicate it into a second
provenance store.

## Load-Bearing Paths

| Path | Responsibility |
|---|---|
| `src/workspaces/issues/declaration.ts` | File schema, canonical What parsing, validation |
| `src/workspaces/issues/comments.ts` | Structured per-Issue markdown comment sidecars |
| `src/workspaces/issues/mutate.ts` | Safe read-modify-write operations |
| `src/workspaces/issues/board.ts` | Global board/detail projections |
| `src/workspaces/issues/auto-complete.ts` | Successful one-shot → `done` transition |
| `src/workspaces/issues/automation-health.ts` | Live schedule/run/owner health projection |
| `src/workspaces/issues/run-failure.ts` | Read-side scheduled-run termination explanation |
| `src/workspaces/schedule/scanner.ts` | Workspace scan, due calculation, dispatch |
| `src/workspaces/schedule/marker-store.ts` | Atomic last-fired persistence |
| `src/workspaces/service.ts` | Scanner composition, agent resolution, headless registry |
| `src/workspaces/headless-task.ts` | Process lifecycle, bounded logs, live structured snapshots |
| `src/workspaces/headless-task-registry.ts` | Durable run records, resume lineage, and capacity projection |
| `src/workspaces/resume-registry.ts` | Product `resumeId` → backend-native runtime session mapping |
| `src/workspaces/headless-output.ts` | Vendor-neutral reply/tool block contract and accumulator |
| `src/workspaces/adapters/{claude,codex,opencode,pi}.ts` | Runtime-specific JSON event translation |
| `src/webui/routes/headless.ts` | Cross-workspace capacity, task, normalized output, and diagnostic-tail API |
| `src/webui/routes/inquiries.ts` | Inbox/Issue follow-up dispatch and durable business-object history |
| `ui/src/pages/AutomationRunsSection.tsx` | Run list, final reply, tool activity, and diagnostics UI |
| `src/tool/issue-tools.ts` | Workspace-scoped issue CLI/MCP tools |
| `src/tool/inbox-push.ts` | Headless/interactive delivery to Inbox |
| `src/workspaces/session-registry.ts` | Durable Session identity and resumeId → Session index |
| `src/webui/routes/workspaces.ts` | Idempotent resumeId → interactive-Session materialization |
| `src/webui/routes/issues.ts` | Issue board/detail HTTP API |
| `src/webui/routes/schedule.ts` | Scheduled projection API |
| `default/skills/self-scheduling/SKILL.md` | Agent-facing authoring instructions |

The retired `.alice/issue.json` and `.alice/schedule.json` formats are migrated
by `src/migrations/0010_workspace_issues_to_markdown/`. Do not add a second
central schedule store or revive the legacy cron/AgentWork path.

## Verification

```bash
npx tsc --noEmit
pnpm vitest run \
  src/workspaces/headless-output.spec.ts \
  src/workspaces/headless-task.spec.ts \
  src/workspaces/headless-task-registry.spec.ts \
  src/webui/routes/headless.spec.ts \
  src/workspaces/issues/declaration.spec.ts \
  src/workspaces/issues/mutate.spec.ts \
  src/workspaces/issues/comment-delivery.spec.ts \
  src/workspaces/issues/board.spec.ts \
  src/webui/routes/issues.spec.ts \
  src/workspaces/issues/auto-complete.spec.ts \
  src/workspaces/schedule/scanner.spec.ts
pnpm test
```

For UI changes, run strict UI types and verify Issue board, issue detail,
Activity comments/replies, the independent Runs section, schedule projection,
and linked Inbox reports in the real browser surface.
