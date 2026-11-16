# Research selection and visible-test integrity

Status: V2 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/research-session-loop]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/selection-adjusted-research-evidence]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/quant-research-lifecycle]], and
[[docs/design/session-decision-matrix]].

## Scope

This document owns candidate-selection versus test-evidence semantics across
reference Runs, Sessions, Studio, and Research Reports. It defines what Core
can prove from immutable history and what must remain an explicit warning.

It does not make visible data secret or infer whether a human actually looked
at a metric. Project-wide family identity and statistically justified
selection adjustment are owned by
[[docs/design/selection-adjusted-research-evidence]].

## Run contract

Every successful reference Judge publishes:

```json
{
  "research_integrity": {
    "selection_split": "validation",
    "test_role": "visible-diagnostic",
    "test_enters_selection": false,
    "external_holdout_rule": "required-after-visible-test-and-candidate-iteration"
  }
}
```

The objective metric name is validation-specific:

- factor: `validation_mean_ic`;
- portfolio: `validation_net_sharpe`;
- RL: `validation_mean_net_sharpe`.

Test metrics remain in Run evidence. They are useful for audit and debugging,
but cannot affect KEEP/REVERT. A reference Judge may not describe them as
permanently untouched once exposed through normal Run output.

Generic user-authored Studies that do not publish this contract project
`selection_split=unspecified`, `test_role=unspecified`, and do not receive
invented claims about their evaluator.

## Session projection

Core derives selection integrity only from verified state:

- selection metric and declared split from the current leader Run;
- candidate trials from immutable Experiment count;
- KEEP, REVERT, and CRASH counts from immutable verdicts;
- evaluated Runs as baseline plus candidate trials;
- test visibility and objective use from the Run contract;
- `testExposureState=baseline-test-visible` before a candidate trial,
  `first-candidate-audit-visible` after exactly one trial, and
  `post-audit-candidate-iteration` after a later Experiment proves another
  source iteration followed the first completed candidate audit;
- `postAuditCandidateIterations`, derived as immutable candidate trials after
  the first one rather than from conversation or process telemetry;
- `externalHoldoutRequired=true` when at least one candidate trial exists and
  test evidence is visible.

Core cannot know whether a person or Agent read a particular field. It uses a
conservative rule: after visible test evidence and candidate iteration, the
same test range no longer supports a fresh holdout claim. It therefore records
`testGuidanceObservability=not-observable`: a later source iteration proves
timing and opportunity to use prior evidence, not actual psychological or
causal guidance.

The first candidate is fixed before its own test audit becomes visible, so its
state does not claim a later post-audit edit. Baseline test evidence was already
visible, however, so this distinction does not restore production-grade
holdout authority or weaken the external-evidence requirement.

For a new caller assignment, the generated Factor candidate is an API
demonstrator rather than a meaningful baseline. The Agent writes the first
predeclared caller-relevant source before evaluation and starts the Session
from that source; it does not run the generic scaffold, inspect its test
audit, and then author the real candidate. When visible test evidence does
precede a source edit, handoff language preserves the Core-derived timing and
`not-observable` guidance state rather than asserting that the evidence was
unused.

Already published Runs may retain the historical declared rule
`required-after-test-guided-iteration`. Current projections preserve that raw
value as `declaredExternalHoldoutRule` but expose the truthful effective
`externalHoldoutRule`; historical Reports without V2 fields continue to verify
against their original projection and Markdown.

## Report evidence

Research Reports freeze the exact Session selection-integrity projection beside
Runs, Experiments, and Campaigns. Report loading recomputes it from the frozen
Experiment prefix and leader Run, then rejects any mismatch even if all report
files were rehashed.

Core renders a Markdown section containing:

- selection metric and split;
- candidate/evaluated Run count and verdict counts;
- test role and whether it enters selection;
- test-exposure state, post-audit candidate count, and the explicit
  non-observability of actual guidance;
- whether a new external holdout is required;
- the fixed warning.

Agent analysis may add interpretation but cannot omit or overwrite this
Core-authored disclosure.

## Studio projection

Studio receives the same Session projection. It shows Project-family trial
count, selection adjustment, test-exposure state, post-audit iteration count,
and holdout status beside the leader, and labels
test values on Run cards as audit evidence. It never computes the correction
in browser code, decides that a holdout is fresh, or resets history.

The Session Decision Matrix follows the same boundary. Only declared
validation metrics can enter baseline comparison and non-dominance. Test rows
use a distinct audit relation, full-scope diagnostics remain display-only, and
context values have no preference direction. Showing those rows cannot change
the immutable KEEP/REVERT/CRASH chain.

## Invariants

1. Reference KEEP/REVERT objectives use validation only.
2. Visible test metrics never enter a reference objective.
3. Trial and verdict counts come from verified immutable Experiments.
4. A candidate trial after visible test evidence triggers the conservative
   external-holdout requirement.
5. Report and Studio projections share Core-derived values.
6. Generic Studies receive explicit unknowns, not inferred evaluator claims.
7. Historical test visibility cannot be undone by deleting or reverting a
   candidate.

## Change checklist

- Name the selection split in every new reference objective.
- Keep diagnostic test fields separate from objective fields.
- Update Session, Report, Studio, template docs, and tests together.
- Never describe exposed test evidence as untouched.
- Add a statistical adjustment only with a dedicated design that fixes inputs,
  assumptions, and interpretation.

## Known gaps

- The frozen external challenge enforces one Core result over a caller-supplied
  later Project, but there is still no blind/encrypted dataset or secret
  one-time reveal service.
- External data governance remains an OpenAlice/organization responsibility.
