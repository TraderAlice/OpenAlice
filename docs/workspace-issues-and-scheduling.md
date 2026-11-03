# Workspace Issues and Self-Scheduling

This guide owns Markdown work items, the global Issue board, schedule scanning,
headless execution, and Inbox delivery. Agent-facing file authoring lives in
`default/skills/self-scheduling/SKILL.md`; identity and follow-up semantics live
in [[docs/conversation-provenance.md]].

Issue, schedule, and Connector-triggered launches enter
`WorkspaceService.executions.dispatch` with mandatory execution attribution.
[[docs/workspace-lifecycle.md]] owns execution authority and admission.

## One file, two roles

Each Issue is `<workspace>/.alice/issues/<id>.md`. Without `when`, it is a
tracked work item; with `when`, the same file schedules a headless run in its
owning Workspace. There is no central Issue database or separate schedule
object. Alice scans registered Workspaces and validates files independently:
one malformed Issue cannot break other files or Workspaces.

The Markdown body is the prompt. Frontmatter declares schedule, assignee,
runtime/AI seed, timeout, and work-item state; the schema and live CLI own exact
fields. Direct edits, CLI, and API use the same canonical file. Autonomous
writes stay in the caller's Workspace; peer mutations require an attended,
human-approved path and a commit in the peer repository.

`assignee` is the sole execution-ownership contract:

- exact `@resumeId` continues one Session and serializes its turns;
- `@new-then-resume` recruits once and persists the concrete signature;
- `@new-each-run` recruits a fresh Session for every fire.

Issue creator/mutation provenance remains independent. An unavailable exact
owner blocks rather than silently replacing the worker. Once an exact owner
exists, frontmatter cannot override its runtime or AI binding.

## Schedule and admission semantics

`every` measures from the last accepted fire. `cron` is wall-clock time with an
explicit `local` or IANA timezone; omitted timezone retains machine-local legacy
behavior. Cron is not an exchange calendar. Business conditions such as trading
days or “notify only if X” belong in the What prompt.

The scanner interprets timing only and passes What unchanged. It persists the
last accepted fire and any held cron occurrence under launcher state. A cursor
advances only when a durable run is accepted. A later launch/runtime failure is
that occurrence's one attempt and requires explicit retry; the scanner does not
create a retry storm.

A missed admission before run creation stays due. Cron catches up by default;
`catchUp: false` consumes elapsed slots and waits for the next future slot.
Creating a cron Issue never dumps historical slots.

**Run now** starts an extra turn without moving the schedule cursor. **Retry
now** re-reads the live Issue for the latest failed/interrupted scheduled run,
preserves cadence, and records retry lineage. Both use ordinary dispatch and
reject active-run and start-race duplicates. CLI `issue run` and `issue retry`
use the same operations.

`automationHealth` is a read projection from markers, runs, owner availability,
and installed runtime—not another persisted Issue status. Success does not
require Inbox output: a condition may correctly exit silently. Interruption,
timeout, launch error, blocked owner/runtime, and inactive terminal Issue states
remain distinct. Read-side failure projection must not rewrite historical runs.

## Execution and concurrency

```text
Issue file -> ScheduleScanner -> due calculation -> execution admission
           -> new/exact product Session -> native headless Agent
           -> normalized run result -> optional Inbox delivery
```

All dispatch paths share resume leases and Session execution admission. Opening
an occupied Session for background work follows the interactive takeover
contract: the prior TUI/Web process exits before headless launch. Closing a
browser tab is not disconnect. Another background turn is never preempted.

One Issue cannot have concurrent runs. A small dispatch-start guard closes
schedule/manual/CLI races and is released after run registration. Different
Issues and Sessions may run concurrently, including in one checkout; Agents
must tolerate concurrent edits. The global headless capacity limit and serialized
registry persistence do not create a per-Workspace mutation lock.

Offboarding rejects new dispatch before directory movement and cannot proceed
with live headless work. A departed exact owner remains historically attributed
but cannot fire until restored or explicitly reassigned.

Scheduler timer ticks do not wait indefinitely for takeover decisions. Pending
fires retain per-Issue exclusion while other work continues; declined admission
uses the normal missed-occurrence policy. Shutdown cancels admissions and drains
pending bookkeeping. Admission blocks and cooldowns never become a scheduler
retry engine.

## Run records and structured output

`HeadlessTaskRegistry` is execution truth. Each run has its own `taskId`;
`parentTaskId` records turn lineage and `retryOfTaskId` records explicit retry.
Runs and bounded diagnostics are retained rather than silently pruned.

Adapters translate native streams into launcher-owned `assistantText`, ordered
text/tool/error blocks, tool status, and compact metrics. `.structured.json` is
a debounced live snapshot; product surfaces do not replay vendor logs. Native
transient events may be discarded before persistence, while final messages,
tool boundaries, errors, and lifecycle events remain. Normalized output and
stdout/stderr have independent bounds.

`processStarted` becomes true only after the OS child emits `spawn`. Pre-process
and spawn failures retain explicit launch diagnostics; structured terminal
errors take priority over stderr. Failed/interrupted reads expose concise error,
exit/signal, and process-start evidence. Successful turns do not promote
recovered warnings into failure.

`workspaces/state/agent-runtime.jsonl` is an append-only Office/activity
projection, not execution or dispatch authority. It excludes prompt and tool
payloads. The headless registry and structured snapshot remain the run control
plane.

## Delivery and safety

Structured output is the live control-plane result; Inbox is durable user
delivery. Meaningful results call `alice inbox push`; no-change checks exit
silently. Alice stamps run/Issue/Session origin out-of-band and publication-time
report revision. Legacy reads may join live registries, but native runtime ids
never cross the product protocol.

Issue Activity stores attributable field changes and structured comments; Git
owns exact-content rollback. Connector replies use the dispatch communication
snapshot, not trigger/inquiry fields, and terminal transport closes even if
comment persistence fails.

Scheduling never bypasses trading approval. Agents may research or stage, but
UTA and Trading-as-Git retain execution, approval, and decision authority.

## Load-bearing paths

- `src/workspaces/issues/declaration.ts` — schema, What parsing, validation.
- `src/workspaces/issues/{comments,mutate,board}.ts` — comment sidecars, safe
  mutation, and board/detail projections.
- `src/workspaces/issues/{auto-complete,automation-health,run-failure}.ts` —
  completion and read-side health/failure projections.
- `src/workspaces/schedule/{scanner,marker-store}.ts` — due calculation, dispatch,
  and atomic cursors.
- `src/workspaces/service.ts` — scanner composition and execution integration.
- `src/workspaces/headless-task.ts` and `headless-task-registry.ts` — process
  lifecycle, bounded diagnostics, durable runs, and capacity.
- `src/workspaces/headless-output.ts` and `adapters/` — neutral output and native
  stream translation.
- `src/workspaces/{resume-registry,session-registry,product-session-coordinator}.ts`
  — product identity and roster boundaries.
- `src/webui/routes/{headless,issues,schedule,inquiries}.ts` — run, Issue,
  schedule, and follow-up APIs.
- `src/tool/{issue-tools,inbox-push}.ts` — Workspace-scoped Agent entry points.
- `default/skills/self-scheduling/SKILL.md` — user/Agent authoring manual.

## Verification gates

Use [[docs/development-workflow.md]] for cumulative scope. Focused changes run
owning typechecks and the declaration, mutation/comments, board, scanner,
registry, output, headless process, and route specs that cover the changed
contract. Dynamic registry, dispatch, and child-process effects require explicit
suite selection beyond static changed imports.

Exercise the real path for behavioral changes: schedule acceptance, missed
admission, Run now/Retry cursor preservation, exact-owner continuation, and
normalized output as applicable. UI changes also verify Issue detail, Activity,
Runs, and linked Inbox in the browser. No fake scheduler result substitutes for
a real child-process smoke when process lifecycle changed.
