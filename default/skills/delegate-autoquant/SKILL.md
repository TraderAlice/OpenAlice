---
name: delegate-autoquant
description: >
  Delegate reproducible quantitative research from a general Chat Workspace to
  the durable AutoQuant desk and consume its evidence-bound handoff. Use when a
  request needs a quantitative Project, historical data intake, factor or
  portfolio research, backtesting, governed experiments, robustness evidence,
  or an AutoQuant follow-up. Do not use for ordinary market commentary, broker
  state, order execution, or a question Chat can answer directly.
---

# Delegate quantitative research to AutoQuant

Treat AutoQuant as a specialist coworker, not a function call. OpenAlice owns
the conversation and routing; the AutoQuant Agent owns Project selection,
research method, dependencies, experiments, Git history, and evidence.

## Bound the assignment

Before dispatch, preserve the caller-owned parts of the question:

- the decision the research should support;
- assets or universe, direction, horizon, and cadence when the caller knows them;
- available data and its provenance;
- benchmark, costs, constraints, risk limits, and requested deliverable;
- material unknowns that must be clarified rather than invented.

Do not translate the request into AutoQuant CLI steps, choose a Project or
Study on its behalf, promise a positive result, or grant trading authority. A
negative result, unsupported route, or request for clarification can be a
correct handoff.

## Recruit the default desk

Use the `alice-workspace` collaboration surface:

```bash
alice-workspace conversation ask --harness autoquant --await --prompt '
Research question: <question>
Decision this supports: <decision>
Caller-owned scope and constraints: <assets, direction, horizon, cadence, benchmark, costs, limits>
Available evidence or data: <paths and provenance, or say what is missing>
Expected handoff: answer in plain language; name the Project and every applicable immutable Run, Experiment, Report, or Dossier id; give the absolute Project root and end with `Primary deliverable directory: <absolute path>` pointing to the Dossier bundle, Report bundle, or Project directory that contains the named evidence; distinguish validation, visible-test, and external-holdout evidence; state assumptions, unsupported claims, and that trading authority is none.
Ask before proceeding if a missing caller-owned fact would materially change the study. Do not manufacture a Report or Dossier solely for transport.
'
```

Add `--await` when the current turn needs the answer. For longer delegation,
omit it, retain the returned `taskId`, and use `conversation await`, `read`, or
`collect` as described by the `alice-workspace` skill. There is no unsolicited
Agent-to-Agent completion notification bus. AutoQuant assignments deliberately
have no default runtime deadline; add `--timeout-ms` only when the caller has
chosen a real hard stop for that particular study.

If AutoQuant is not initialized, report that boundary and direct the user to
initialize the Quant desk. Do not silently perform the research in Chat or
guess another Workspace.

## Understand the returned state

The universal result is the Agent's ordinary `assistantText` handoff, not one
mandatory file type:

| Research route | Applicable durable evidence |
|---|---|
| Fixed or descriptive Study | Usually an immutable Run and Explorer; no Session Report is required |
| Editable single lane | Runs/Experiments and often one immutable lane Report |
| Multi-lane research program | Current lane Reports and, when applicable, one Project Dossier |
| Blocked, rejected, or unsupported study | Plain-language boundary plus whatever exact evidence ids exist |

A Report is an immutable Markdown/JSON deliverable for one research lane. A
Dossier synthesizes compatible current lane Reports into a Project-level
deliverable. Their absence is not failure when the route does not support or
need them. AutoQuant does not automatically publish either artifact to the
OpenAlice Inbox.

## Consume and continue

1. Read the direct handoff first. Require the Project identity and absolute
   root, the primary deliverable's absolute directory, applicable evidence ids,
   assumptions, limitations, and no-trading boundary.
2. If the absolute deliverable directory is missing, continue the returned
   Session immediately instead of searching the desk or recruiting another
   worker:

   ```bash
   alice-workspace conversation ask --resume-id <resumeId> --await \
     --prompt 'Please provide the absolute directory path of the primary Report, Dossier, or Project evidence from your completed assignment. Do not rerun the research.'
   ```

3. Use native Read/Search/Git capabilities directly on the returned directory
   and only the named artifacts. Use
   `alice-workspace peer path --id <workspaceId>` only as an addressing fallback
   when the reported absolute path is unavailable.
4. If the answer needs substantive clarification, continue that same
   `resumeId`; do not recruit a new AutoQuant Session and discard its context.
5. Translate the evidence for the user, separating AutoQuant's findings from
   your judgment. Any live account or execution decision returns to
   `alice-uta` and its approval flow.

A normal attended Chat reply already reaches the user. Ask AutoQuant to commit
and push an exact file to Inbox only when the user explicitly wants a durable
human-facing delivery or asynchronous notification; do not use Inbox as the
ordinary peer reply channel.
