# Session decision matrix

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/CLI]], [[docs/STUDIO]],
[[docs/design/research-session-loop]],
[[docs/design/research-selection-integrity]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/portfolio-risk-governor]],
[[docs/design/portfolio-liquidity-capacity]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the read-only projection that compares one verified
research Session's baseline and bounded candidate history across professional
metric layers. It defines metric descriptors, trial identity, bounded
selection, directional comparisons, validation-only non-dominance, CLI
discovery, and Studio presentation.

It does not own Experiment verdicts, source promotion, candidate evaluation,
branching/Pareto optimization, statistical acceptance, report authorship, or
trading authority.

## Authority flow

```text
verified Session + immutable Experiment chain
→ verified baseline/candidate Runs under one fixed Study/objective
→ recognized Factor / Portfolio / RL metric dictionary
→ bounded trials with baseline and current leader anchors
→ validation-only directional comparisons and non-dominated display set
→ aq session compare / Studio decision matrix
```

`load_session` and `load_experiment` remain the authority for the linear
leader chain. `load_run` verifies every candidate byte and RunResult before a
metric is read. A comparison cannot fabricate or reinterpret a verdict.

## Metric descriptors

Every displayed metric declares:

- stable key and human label;
- evidence group;
- split or scope;
- display unit;
- preference: `higher`, `lower`, or `context`;
- whether it is eligible for validation comparison;
- whether it is the fixed primary objective.

V1 recognizes the three reference evidence families:

- Factor: validation IC/inference/decay/quantiles/stability/style overlap and
  visible test IC;
- Portfolio: validation factor quality, net performance, drawdown/tail risk,
  risk-governor activation/scale/pre-post forecast context, turnover/cost,
  causal liquidity-capacity/coverage/reference-NAV breach context, cost/delay
  stress, executed-risk coverage/overrides/breaches, contribution
  concentration, mechanical transition context, and visible test performance;
- RL policy: validation mean/minimum/dispersion, advantage over the best fixed
  baseline, failure rate, validation turnover/cost, and visible test evidence.

Unknown Studies receive only their fixed primary metric. Missing metrics are
explicitly unavailable; Core never substitutes zero.

`context` fields such as signal state-change rate, risk-governor activation,
average risk scale, capacity, and executed-risk intervention are shown because
they explain mechanics but
have no universal favorable direction without a caller capital mandate.
Frequent risk reduction can indicate either
healthy protection or an over-risky raw signal; it therefore cannot dominate
another candidate. Test rows are always comparison-ineligible even when their
descriptor has a display preference.

## Bounded trial selection

The caller chooses a candidate-trial limit from 1 through 100. Core always
includes the Session baseline. It then selects the most recent candidates and
anchors the current leader candidate if it would otherwise be omitted.
Output discloses total, displayed, and omitted candidate counts.

All comparison claims are scoped to these displayed trials. The matrix does
not claim that a hidden older trial was dominated. Its accompanying
`selectionIntegrity` object separately covers the complete Project-wide
fixed-evaluation research family and selection adjustment; the bounded visual
row set never resets or substitutes that statistical history.

Failed candidate Runs remain rows with their immutable `CRASH` verdict,
structured errors, and unavailable metrics. They never enter non-dominance.

## Direction and non-dominance

For each successful displayed trial, Core compares every available descriptor
with baseline:

- `better` follows the descriptor preference;
- `worse` is the reverse;
- `same` uses a small deterministic floating tolerance;
- `context` and unavailable values remain `not-comparable`.

The descriptive non-dominated set uses only fields where
`selectionEligible=true`. Trial A dominates B only when A is no worse on
every comparable selection field and strictly better on at least one.
Visible-test and contextual rows cannot affect the set.

This is an observation aid, not multi-objective promotion. KEEP/REVERT remains
the fixed primary-objective decision recorded by the Experiment.

## Studio

Studio embeds a smaller bounded comparison for each verified Session. The
selected Session shows:

- columns for baseline and displayed candidates;
- verdict, leader, and failed-state identity;
- rows grouped by factor, portfolio, implementation, robustness, policy, RL,
  and audit evidence;
- values plus Core-projected baseline direction;
- leader gains/regressions and the displayed validation-only non-dominated
  set;
- an explicit test-audit exclusion warning.

The matrix may scroll horizontally. The browser formats and filters the Core
object but does not derive evidence, rank Runs, or mutate the Session.

## Public contract

```text
aq session compare <project-or-workspace> --session <id>
  [--trials 1..100] [--project <id>] [--json]
```

The result kind is `autoquant-session-decision-matrix`. The operation is
read-only and returns no source files or arbitrary artifact content.

## Invariants

1. No metric is read before Session, Experiment, and Run verification.
2. All trials share one fixed Study, objective, dataset, Judge, and Harness
   authority through the Session locks.
3. Baseline and current leader remain visible under bounded history.
4. Test and contextual evidence never affects comparison dominance.
5. A descriptive comparison never changes an immutable verdict.
6. Failed trials remain explicit and cannot become successful metric rows.
7. CLI and Studio use the same Core object.
8. The matrix has no live account, order, or authenticated host-provenance
   authority.

## Change checklist

- Add metric paths only with documented unit, preference, and split semantics.
- Prove missing/non-finite/rehashed history fails safely.
- Preserve baseline/leader anchors at every trial limit.
- Test Portfolio, RL, generic, and failed candidate behavior.
- Update schema, capabilities, CLI, Studio, docs, and package assets together.

## Known limits

- V1 compares one linear Session, not branches or different Study contracts.
- Non-dominance remains descriptive. Multiple-search adjustment is a separate
  Core diagnostic over the complete research family and does not alter the
  displayed Pareto relations or immutable verdicts.
- Metric dictionaries are fixed for current reference Judges rather than a
  universal metric DSL.
- Parameter surfaces and cross-Project comparison remain future work.
