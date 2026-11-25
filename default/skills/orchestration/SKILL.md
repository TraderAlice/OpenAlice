---
name: orchestration
description: >
  Dispatch and coordinate background worker Sessions through `alice orchestration`
  with structured ask/reply decision gates, explicit `worker-done` handoffs,
  escalation recovery, and automatic wake delivery. Use when delegating
  non-trivial work to another Workspace, Harness (`autoquant`, `prediction`,
  `chat`), or specialist worker Session, or when you are a dispatched worker
  with an `[Orchestration Worker Contract]`.
---

# Worker Orchestration — `alice orchestration`

OpenAlice orchestration runs background worker Sessions under a strict contract:
workers either ask a structured question (`ask`) or report completion
(`worker-done`). OpenAlice automatically wakes the coordinator on questions,
escalations, and completions — **never `sleep` or poll in a loop**.

## Coordinator workflow

### 1. Dispatch a worker

```bash
alice orchestration worker-start \
  --harness autoquant \
  --spec '<complete assignment, acceptance criteria, and required deliverable paths>'
```

- Target a Harness (`--harness chat|autoquant|prediction`), an explicit
  Workspace (`--ws-id <workspaceId>`), or omit both to spawn in your current
  Workspace.
- Optional runtime overrides: `--agent <id>`, `--model <id>`, `--effort <level>`,
  `--credential <slug>` or `--credential-source native`, and `--max-idle-ms <ms>`
  (stall watchdog budget).
- **Inline cross-workspace context**: a worker in another Workspace cannot read
  your session history and may not know your local paths. Inline key excerpts or
  provide exact absolute paths inside `--spec` (or use `--spec-file <path>`).
- **End your turn immediately** after dispatching. Tell the user the worker is
  running and let OpenAlice wake you when it needs input or finishes.

### 2. Handle wake notifications

OpenAlice wakes your Session inline (or with a compact pointer in a live PTY):

| Wake kind | What it means | Action |
|---|---|---|
| `question` | Worker called `ask` and is paused (`waiting_parent`) | Answer with `alice orchestration reply --id <messageId> --body "<answer>"`, then end your turn |
| `worker_done` | Worker reported `completed`, `failed`, or `inconclusive` | Review `summary`, `evidence`, and `deliverables`; acknowledge with `alice orchestration check` if prompted, or continue with `send` |
| `escalation` | Worker exited without `worker-done`/`ask` (`stopped_without_done`), stalled, failed, or was lost on restart | Inspect preview/error and steer or resume with `alice orchestration send --to dispatch:<dispatchId> --body "<instructions>"` |

If woken with a compact pointer (`You have N pending orchestration message(s)...`),
run `alice orchestration check` to read and acknowledge pending messages.

### 3. Follow up, inspect, and stop

```bash
# Steer a running worker (queues until turn settles) or resume any idle/done/failed/stopped worker:
alice orchestration send --to dispatch:<dispatchId> --body "<follow-up instructions>"

# Inspect your dispatched workers, live status, and pending questions:
alice orchestration worker-list [--status running|waiting_parent|done|failed|stopped] [--dispatch <dispatchId>]

# Read full read-only audit history (including already-acknowledged messages):
alice orchestration inbox [--dispatch <dispatchId>] [--limit 50]

# Stop a worker cleanly without triggering a failure escalation:
alice orchestration worker-stop --dispatch <dispatchId> [--reason "<reason>"]
```

Do not spawn duplicate workers for an active assignment — continue the existing
dispatch via `send`.

## Worker obligations

If your prompt begins with `[Orchestration Worker Contract]` (carrying a
`Task ID` and `Dispatch ID`), you **must** end every turn with one of these two
commands:

1. **Need a decision, approval, or clarification from your coordinator:**
   ```bash
   alice orchestration ask --dispatch <dispatchId> --body "<concise question and options>"
   ```
   End your turn immediately. OpenAlice wakes you automatically when your
   coordinator replies.

2. **Finished (or blocked / inconclusive):**
   ```bash
   alice orchestration worker-done \
     --dispatch <dispatchId> \
     --outcome completed|failed|inconclusive \
     --summary "<concise result summary>" \
     [--evidence "<verification output, metrics, or run IDs>"] \
     [--deliverable "<path>"]
   ```
   You can pass `--deliverable` multiple times (paths or JSON objects
   `{"path":"...","summary":"..."}`) or `--deliverables '<json-array>'`.
   End your turn immediately.

**Never exit with plain text without calling `ask` or `worker-done`.** Exiting
silently triggers a `stopped_without_done` escalation to your coordinator.
