# Workspace Issues and Self-Scheduling

This guide owns the current work-item and automation model: self-describing
markdown issues inside each Workspace, the global Issue board, schedule
scanning, headless execution, and Inbox delivery.

Related guides: [[docs/project-structure.md]] and
[[docs/development-workflow.md]]. The agent-facing usage manual ships as
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
assignee: ws:research
when: { kind: cron, cron: "30 8 * * 1-5" }
what: >
  Pull pre-market movers and overnight news, write research/premarket.md,
  then push the report to Inbox.
agent: pi
---

Prepare a concise brief before the trading day.
```

The filename stem is the stable issue id. Frontmatter:

- `title` — required human title.
- `status` — `backlog | todo | in_progress | done | canceled`; default `todo`.
- `priority` — `urgent | high | medium | low | none`; default `none`.
- `assignee` — human/workspace display ownership.
- `when` — optional schedule:
  - `{ kind: at, at: <ISO timestamp> }`
  - `{ kind: every, every: <duration> }`
  - `{ kind: cron, cron: <5-field expression> }`
- `what` — optional standalone headless prompt; falls back to title + body.
- `agent` — optional CLI adapter id; otherwise Workspace/default resolution is
  used.

`done` and `canceled` are terminal and stop scheduled firing. There is no
separate `enabled` flag. A successful one-shot `at` issue is automatically
marked `done`; repeating schedules retain their status.

## Agent and Human Surfaces

Agents normally use:

```bash
alice-workspace issue list
alice-workspace issue show --id <id-or-title>
alice-workspace issue create --title "..."
alice-workspace issue update --id <id> --status done
alice-workspace issue comment --id <id> --text "..."
```

The CLI and MCP tools use the same implementation and write the same markdown
files. Direct file editing is also valid and is the clearest way to author the
body plus `when` / `what` / `agent` fields.

Reads such as list/show aggregate all workspaces. Writes from an autonomous or
headless run stay inside its own Workspace. Editing a peer Workspace requires
an attended, human-approved path and a commit in the peer repository.

## Execution Flow

```text
.alice/issues/<id>.md
  -> ScheduleScanner (~60s)
  -> due calculation from `when` + last-fired marker
  -> headless run of the owning Workspace
  -> native agent CLI
  -> normalized reply + message/tool blocks
  -> inbox_push when there is a user-visible result
  -> Inbox item linked to the run and issue
```

The scanner interprets timing only. It hands `what` (or title + body) to the
agent unchanged. Conditions belong in that prompt: for “notify only if X,” the
run checks X and exits silently when false.

The scanner persists only last-fired markers under the launcher state root.
Schedule semantics remain in the issue file. Markers are written after a
successful dispatch; capacity/transient rejection stays due for retry.

Headless runs may overlap with interactive sessions or other runs in the same
checkout. Agents must tolerate concurrent edits. The launcher currently admits
at most eight headless processes globally and serializes registry persistence,
but there is no per-Workspace exclusive lock.

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
identity. A no-change check should exit silently rather than generating Inbox
noise.

When a user opens an Inbox result, the frontend supplies its OpenAlice-owned
`resumeId`. The backend `ResumeRegistry` resolves that identity to the native
Claude/Codex/opencode/Pi session id and resumes the original conversation in an
interactive PTY. Later opens from Inbox, Automation, or the Workspace sidebar
reuse the Session indexed by `resumeId`; native ids never cross the product
protocol. `taskId` remains one execution, while `parentTaskId` records direct
turn lineage. Runs and their logs are retained rather than silently pruned.

Scheduling never bypasses trading approval. A headless agent may research or
stage a trade, but execution remains behind UTA/Trading-as-Git permission and
human approval boundaries.

## Load-Bearing Paths

| Path | Responsibility |
|---|---|
| `src/workspaces/issues/declaration.ts` | File schema, parsing, validation, prompt fallback |
| `src/workspaces/issues/mutate.ts` | Safe read-modify-write operations |
| `src/workspaces/issues/board.ts` | Global board/detail projections |
| `src/workspaces/issues/auto-complete.ts` | Successful one-shot → `done` transition |
| `src/workspaces/schedule/scanner.ts` | Workspace scan, due calculation, dispatch |
| `src/workspaces/schedule/marker-store.ts` | Atomic last-fired persistence |
| `src/workspaces/service.ts` | Scanner composition, agent resolution, headless registry |
| `src/workspaces/headless-task.ts` | Process lifecycle, bounded logs, live structured snapshots |
| `src/workspaces/headless-task-registry.ts` | Durable run records, resume lineage, and capacity projection |
| `src/workspaces/resume-registry.ts` | Product `resumeId` → backend-native runtime session mapping |
| `src/workspaces/headless-output.ts` | Vendor-neutral reply/tool block contract and accumulator |
| `src/workspaces/adapters/{claude,codex,opencode,pi}.ts` | Runtime-specific JSON event translation |
| `src/webui/routes/headless.ts` | Cross-workspace capacity, task, normalized output, and diagnostic-tail API |
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
  src/workspaces/issues/board.spec.ts \
  src/workspaces/issues/auto-complete.spec.ts \
  src/workspaces/schedule/scanner.spec.ts
pnpm test
```

For UI changes, run strict UI types and verify Issue board, issue detail,
schedule projection, run history, and linked Inbox reports in the real browser
surface.
