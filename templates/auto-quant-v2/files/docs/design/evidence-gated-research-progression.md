# Evidence-gated research progression

Status: implemented.

Related: [[docs/design/research-program-orchestration]],
[[docs/design/factor-qualification-funnel]],
[[docs/design/portfolio-decision-explorer]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/program-research-dossiers]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

The research program has two different state machines:

- coordination state: whether a Study has a current Run, Session, or Report;
- scientific progression: whether the current evidence supports spending
  complexity on the next research question.

`reported` proves that an immutable handoff exists. It does not mean the factor
predicts, the portfolio survives implementation, or RL is warranted. AutoQuant
therefore uses verified upstream evidence to prioritize the next lane:

```text
request
→ current Factor evidence
→ positive factor qualification
→ current frozen Factor Report
→ current Portfolio evidence
→ positive post-cost viability
→ current frozen Portfolio Report
→ required research complete
→ governed RL admitted as optional challenge
```

## Fixed gates

### Factor to Portfolio

Core reconstructs the current successful Factor Run through the strict Factor
Explorer. Portfolio is admitted only when:

1. qualification evidence is available;
2. the request-bound validation diagnosis is claim-positive
   (`decision-signal-positive`, `factor-qualification-positive`, or
   `known-style-validation-positive`);
3. the frozen Report's Project-family selection adjustment is available and
   passes at 95%; and
4. the current lane has an immutable Report freezing that exact leader Run.

Missing, legacy, stale, weak, redundant, non-incremental, or unstable Factor
evidence keeps the program focused on Factor.

### Portfolio to optional RL

Core reconstructs the current successful Portfolio Run through the strict
Portfolio Explorer. Governed RL is admitted only when:

1. Factor→Portfolio admission already passed;
2. validation strategy-viability diagnosis is `post-cost-edge-positive`; and
3. the current Portfolio lane has an immutable Report freezing that exact
   leader Run.

Factor prediction without gross monetization, cost-fragile evidence, negative
post-cost evidence, legacy/unavailable evidence, or a missing current Report
keeps research in Portfolio. After both required gates pass, a local reviewer
or collaborating Agent can receive the Factor+Portfolio Dossier without
running RL. RL is a separately chosen optional challenge against the simpler
policy.

## Program projection

The verified program status exposes:

- a gate state for Factor→Portfolio and Portfolio→RL;
- exact current Run and Report identities;
- upstream diagnosis stage, iteration focus, and explanation;
- one program-level focus lane and progression stage;
- whether governed RL is admitted but optional;
- fixed research-prioritization and no-trading authority.

The CLI and Studio consume this object directly. The browser may format it but
cannot infer readiness from metric signs or lane phases.

## Repeat research

A terminal Session is history, not a permanent lane lock. When the first
unsupported lane has a completed or promoted latest Session, program commands
include a fresh `aq session start` action using the preserved Project request.
Active Sessions remain inspect/complete/promote workflows and are never
silently replaced.

## Invariants

1. Every scientific gate starts from a current successful Run whose immutable
   bytes verify.
2. Factor and Portfolio diagnoses are reconstructed by their strict Core
   explorers; headline metric signs are insufficient.
3. The Report must freeze the exact current leader Run.
4. Validation alone determines the diagnostic stage; test remains visible
   audit.
5. A failed gate prioritizes research but never mutates a Run, Report,
   Experiment verdict, or source.
6. Optional RL is never required to publish a valid required-lane Dossier.
7. Progression grants no selection, promotion, Broker, order, account, capital,
   or trading authority.
