# Bounded external Researcher driver

Status: V1 implemented.

Related: [[docs/design/research-session-loop]], [[docs/CLI]], and
[[docs/PROJECT_FORMAT]].

## Scope

This document owns provider-neutral external Researcher invocation, turn
budgets, proposal/stop responses, automatic Experiment repetition, failure
restoration, and immutable Campaign evidence.

It does not own one model vendor, credentials, OS sandboxing, Judge semantics,
verdicts, promotion, or Studio presentation.

## Connector contract

`aq research run` receives one explicit `--agent-command`. AutoQuant invokes it
through the platform shell with:

- current working directory set to the Session worktree;
- one versioned Research brief JSON on stdin;
- `AUTOQUANT_RESEARCH_INPUT` naming the frozen turn input file;
- `AUTOQUANT_WORKTREE` naming the candidate Project;
- `AUTOQUANT_SESSION_ID` and `AUTOQUANT_CAMPAIGN_ID`.

The command may edit only the Session's declared editable closure. It returns
exactly one JSON object on stdout.

Proposal:

```json
{
  "schema_version": 1,
  "action": "propose",
  "strategy": "volatility-normalization",
  "hypothesis": "Normalize the signal by trailing realized volatility.",
  "expected_effect": "Improve the locked score without changing the Judge."
}
```

Stop:

```json
{
  "schema_version": 1,
  "action": "stop",
  "reason": "The remaining ideas repeat rejected candidates."
}
```

Objects are strict. The Researcher never returns a metric, verdict, source
target, or promotion request. For `propose`, Core validates the actual
worktree diff and evaluates the hypothesis through the ordinary
Session/Experiment contract. For `stop`, the worktree must still equal the
leader.

The command is explicit host-code execution, not a security sandbox. OpenAlice
or another host may provide a stronger process sandbox without changing this
protocol.

## Turn brief

Every turn receives fresh:

- the verified delegated request and derived Research Brief when the Session
  was started with `--request`;
- Campaign and turn ids;
- complete Study program text and hash;
- worktree and editable paths;
- objective and fixed identity locks;
- current leader Run/source/metric/value;
- compact immutable Experiment history with hypotheses, strategies, verdicts,
  values, improvements, Run ids, and errors;
- maximum and remaining turn/wall-clock budgets;
- the exact response contract.

The Researcher therefore does not need to scrape CLI prose or infer current
best state from mutable files.

Delegated context has research-prioritization authority only. It cannot change
the objective, locks, budgets, Judge, verdict, or editable closure.

## Campaign evidence

Campaigns live inside their Session:

```text
campaigns/
└── campaign-<UTC timestamp>-<identity>/
    ├── turns/
    │   └── turn-0001/
    │       ├── input.json
    │       ├── stdout.txt
    │       ├── stderr.txt
    │       ├── response.json
    │       └── result.json
    ├── progress.json
    ├── result.json
    └── manifest.json
```

The terminal Campaign result records command identity, budgets, timestamps,
status, stopping reason, completed turns, Experiment ids, verdict counts,
initial/final leader, and structured errors. The manifest is written last and
pins every other file. Hidden staging Campaigns are ignored.

During execution, the hidden staging Campaign has a strict mutable
`progress.json`. It exposes current phase/turn/budget and completed Experiment
references for [[docs/design/studio-observation-surface]] without claiming
terminal evidence. Publication changes it to the terminal status and includes
its hash in the Campaign manifest.

Campaign terminal statuses are:

- `stopped`: the Researcher returned a valid STOP;
- `budget_exhausted`: every allowed proposal turn completed;
- `failed`: command exit/timeout, malformed response, illegal or unchanged
  source.

Completed Experiments remain independently valid when their Campaign later
fails.

## Failure and restoration

On a command or response failure, AutoQuant reconstructs the Session worktree
from the canonical fixed Study/Judge bytes and the verified immutable leader
Run. This removes illegal editable and non-editable changes before publishing
the failed Campaign.

A failed candidate Judge is an ordinary `CRASH` Experiment, not a Campaign
protocol failure. The existing Experiment transaction restores the leader and
the Campaign may continue to the next turn.

## Budgets

V1 requires:

- `max_turns`: positive integer, capped at 100;
- `max_wall_seconds`: positive integer, capped at 86400;
- `turn_timeout_seconds`: positive integer, capped at 3600.

Each command timeout is the smaller of the per-turn limit and remaining
Campaign wall time. Judge time consumes the aggregate wall budget. Reaching
`max_turns` after valid turns is `budget_exhausted`, not failure.

## Invariants

1. A Campaign operates on one existing active Session.
2. Every turn brief is frozen before the command starts.
3. The Researcher controls only candidate source and proposal prose.
4. Session authority, immutable history, Judge, verdict, restoration, and
   promotion remain Core-owned.
5. Command/protocol failure is terminal and restores the leader worktree.
6. CRASH Experiment evidence does not disappear or impersonate command failure.
7. Campaign files are immutable and manifest-last after publication.

## Known gaps

- The shell command is not host-sandboxed.
- There is no streaming progress envelope while a command is running.
- Token/cost budgets are not standardized.
- Campaigns are linear and single-process.
- Progress polling does not prove the Campaign process remains alive.
