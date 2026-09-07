---
name: delegate-prediction
description: >
  Delegate prediction-market contract and evidence research from a general
  Chat Workspace to the durable Auto Prediction desk. Use for cross-venue
  settlement comparison, semantic relationship hypotheses, anonymous venue
  evidence, deterministic replay, simulation, shadow qualification, or an
  Auto Prediction follow-up. Do not use for general news commentary, broker
  orders, live execution, or a question Chat can answer directly.
---

# Delegate prediction research to Auto Prediction

Treat Auto Prediction as a specialist coworker, not a probability oracle or a
function call. OpenAlice owns conversation and routing. The Auto Prediction
Agent owns repository orientation, campaign selection, evidence retention,
semantic review, exact payout logic, simulation, and shadow-only qualification.

## Bound the assignment

Preserve the caller-owned parts of the question before dispatch:

- the decision or research question the answer should support;
- named venues, contracts, outcomes, dates, and settlement language when known;
- the proposed relationship, or permission to search an open semantic neighborhood;
- available evidence with source and freshness, including known gaps;
- scope, time or model budget, and the requested handoff.

Do not convert a quote directly into a world probability, assume differently
worded contracts settle identically, prescribe Auto Prediction's internal CLI
steps, or promise that a hypothesis will survive review. Negative evidence,
falsification, an unsupported venue, or a request for missing contract terms can
be a correct result.

## Recruit the default desk

Use the `alice-workspace` collaboration surface:

```bash
alice-workspace conversation ask --harness prediction --await --prompt '
Research question: <question>
Decision this supports: <decision>
Caller-owned scope: <venues, contracts, outcomes, dates, settlement language, relationship hypothesis>
Available evidence: <sources, receive times, protocol identities, hashes, or say what is missing>
Budget and stopping condition: <scope, time/model budget, or explicit bound>
Expected handoff: answer in plain language; separate world proposition, venue settlement contract, and traded state; name every applicable campaign, finding, review, replay, simulation, or certificate id; give the absolute Workspace root and end with `Primary evidence directory: <absolute path>` for the retained evidence; report counterexamples, freshness, assumptions, unsupported claims, and the exact no-live-trading boundary.
Ask before proceeding if a missing caller-owned fact would materially change the research. Do not create an artifact solely for transport.
'
```

Add `--await` when the current turn needs the answer. For longer delegation,
omit it, retain the returned `taskId`, and use `conversation await`, `read`, or
`collect` as described by the `alice-workspace` skill. There is no unsolicited
Agent-to-Agent completion notification bus. Add `--timeout-ms` only when the
caller chose a real execution watchdog for this assignment.

If Auto Prediction is not initialized, report that boundary and direct the user
to initialize the Prediction desk. Do not silently substitute Chat research or
guess another Workspace.

## Consume and continue

1. Read the returned `assistantText` first. A useful answer may be a retained
   hypothesis, falsification, venue boundary, campaign result, review state, or
   shadow-only qualification; no single artifact type is mandatory.
2. Require an absolute Workspace root, the primary evidence directory when one
   exists, applicable durable ids, evidence provenance and freshness, material
   assumptions, counterexamples, and the no-live-trading boundary.
3. If the path or evidence identity is missing, continue the returned Session:

   ```bash
   alice-workspace conversation ask --resume-id <resumeId> --await \
     --prompt 'Provide the absolute primary evidence directory and exact durable ids from the completed assignment. Do not rerun the research.'
   ```

4. Use native Read/Search/Git capabilities on only the returned paths and named
   artifacts. Use `alice-workspace peer path --id <workspaceId>` only when the
   reported absolute root is unavailable.
5. Continue the same `resumeId` for substantive clarification. Do not recruit a
   new Prediction Session and discard the context.
6. Present retained evidence separately from your judgment. A normal attended
   reply already reaches the user; use Inbox only when durable human-facing
   delivery or asynchronous notification was explicitly requested.

Auto Prediction has no authority to place a live order, sign a transaction,
approve a token, request production-trading credentials, or move funds. Do not
reinterpret research or shadow evidence as permission to cross that boundary.
