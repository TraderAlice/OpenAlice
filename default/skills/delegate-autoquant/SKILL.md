---
name: delegate-autoquant
description: >
  Delegate reproducible quantitative research from a general Chat Workspace to
  the durable AutoQuant desk and consume its evidence-bound handoff. Use when a
  request needs a quantitative Project, historical data ingestion, factor or
  portfolio research, backtesting, Train/Validation/Holdout evaluation, or an
  AutoQuant follow-up. Do not use for ordinary market commentary, broker state,
  order execution, or a question Chat can answer directly.
---

# Delegate quantitative research to AutoQuant

Treat AutoQuant as a specialist coworker, not a function call. OpenAlice owns
the conversation and routing; the AutoQuant Agent owns Project selection,
Python/pandas research code, dependencies, Train/Val/Holdout splits, immutable
Runs, local Git history, and Studio artifacts.

## Bound the assignment

Before dispatch, preserve the caller-owned parts of the question:

- the decision the research should support;
- assets or universe, direction, horizon, and cadence when the caller knows them;
- available data and its provenance;
- benchmark, transaction costs, constraints, risk limits, and requested deliverable;
- material unknowns that must be clarified rather than invented.

Do not translate the request into AutoQuant CLI steps, choose a Project on its
behalf, promise a positive result, or grant trading authority. A negative
result, inconclusive signal, or request for clarification can be a correct
handoff.

## Recruit the default desk

Use the `alice` collaboration surface:

```bash
alice conversation create --harness autoquant --prompt '
Research question: <question>
Decision this supports: <decision>
Caller-owned scope and constraints: <assets, direction, horizon, cadence, benchmark, costs, limits>
Available evidence or data: <paths and provenance, or say what is missing>
Expected handoff: answer in plain language; name the Project ID (`project_id`), its absolute Project path, and every relevant immutable `runId` under `runs/`; end with `Primary deliverable directory: <absolute path>` pointing to the Project directory (containing `research.md`) or specific `runs/<runId>` directory containing the primary deliverable and artifacts; clearly separate Validation metrics from Holdout metrics and report `holdout_audit.unlock_count` honestly; state assumptions, limitations, and `tradingAuthority: none`.
Ask before proceeding if a missing caller-owned fact would materially change the study.
'
```

Quantitative research takes minutes, so dispatch is asynchronous by default:
`alice conversation create --harness autoquant --prompt ...` dispatches the
assignment in the background and returns `taskId` and `resumeId` immediately.

- Once dispatched, **end your current turn** and tell the user that AutoQuant
  (`@<resumeId>`) is working on the assignment in the background. If you used
  `--await` and it returned `status: "running"` after its bounded quick-reply
  window, end your turn the same way.
- Do not poll in a loop, and do not spawn duplicate AutoQuant sessions while a
  task is still running.
- When the AutoQuant turn finishes, OpenAlice automatically wakes your Session
  with a notification (`You have N completed peer task(s). Run
  `alice conversation check`...`). Run `alice conversation check` (or
  `alice conversation read --task-id <taskId>`) to consume the result and
  report back to the user.
- Keep `--await` only for quick follow-up questions
  (`alice conversation ask --resume-id <resumeId> --await ...`) where an
  immediate short answer is expected.

AutoQuant assignments deliberately have no default runtime deadline; add
`--timeout-ms` only when the caller has chosen a real hard stop for that
particular study.

If AutoQuant is not initialized, report that boundary and direct the user to
initialize the Quant desk. Do not silently perform the research in Chat or
guess another Workspace.

## Understand the returned state

The universal result is the Agent's ordinary `assistantText` handoff, backed by
plain files on disk:

| Research outcome | Applicable durable evidence |
|---|---|
| Factor evaluation (`kind: "factor"`) | `projects/<id>/research.md` plus immutable `runs/<runId>/` (`run.json`, `series/ic.csv`, `series/quantiles.json`, `series/equity.csv`) |
| Portfolio backtest (`kind: "backtest"`) | `projects/<id>/research.md` plus immutable `runs/<runId>/` (`run.json`, `series/equity.csv`, optional custom `artifacts/*`) |
| Custom / statistical / ML study (`kind: "custom"`) | `projects/<id>/research.md` plus immutable `runs/<runId>/` (`run.json`, custom `artifacts/*.json`, `.svg`, or `.md`) |
| Blocked, ambiguous, or negative finding | Plain-language boundary or negative evidence plus `research.md` and whatever `runId`s were recorded |

Each Project maintains a living `research.md` brief and immutable `runs/<runId>/`
records (`run.json`, `series/*`, and optional `artifacts/*`), while
`project.json` tracks `splits` and `holdout_audit.unlock_count`. AutoQuant
does not automatically publish either artifact to the OpenAlice Inbox.

## Consume and continue

1. Read the direct handoff first. Require the Project ID and absolute Project
   path, `Primary deliverable directory: <absolute path>`, relevant immutable
   `runId`s, Validation vs Holdout metrics (including
   `holdout_audit.unlock_count`), assumptions, limitations, and
   `tradingAuthority: none`.
2. If the absolute deliverable path is missing, continue the returned Session
   immediately instead of searching the desk or recruiting another worker:

   ```bash
   alice conversation ask --resume-id <resumeId> --await \
     --prompt 'Please provide the absolute Project path, Primary deliverable directory, and immutable runIds from your completed assignment. Do not rerun the research.'
   ```

3. Use native Read/Search/Git capabilities directly on the returned directory
   (`research.md`, `project.json`, or `runs/<runId>/run.json`) when deeper
   inspection is needed. Use `alice peer path --id <workspaceId>` only as an
   addressing fallback when the reported absolute path is unavailable.
4. If the answer needs substantive clarification or a follow-up experiment,
   continue that same `resumeId`; do not recruit a new AutoQuant Session and
   discard its context.
5. Translate the evidence for the user, separating AutoQuant's empirical
   findings (and whether Holdout remained untouched or was unlocked) from your
   judgment. Any live account or execution decision returns to `alice-uta` and
   its approval flow.

A normal attended Chat reply already reaches the user. Ask AutoQuant to commit
and push an exact file to Inbox only when the user explicitly wants a durable
human-facing delivery or asynchronous notification; do not use Inbox as the
ordinary peer reply channel.
