# Cross-Study factor dependencies

Status: active design.

Related: [[docs/design/study-run-evidence]],
[[docs/design/research-program-orchestration]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-factor-population]],
[[docs/design/factor-qualification-funnel]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/portfolio-risk-governor]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/research-selection-integrity]].

## Purpose

A Study may evaluate an editable subject while consuming another research
source as fixed input. AutoQuant must distinguish three authorities:

```text
editable source      Agent may change during this Session
fixed Judge source   defines evaluation and acceptance
fixed dependency     research input consumed but not editable in this Session
```

The first use is the governed RL Study:

```text
factors/** source closure ───────── read-only dependency ──► RL Judge
strategies/factor-population.json ─ read-only dependency ──► Factor + Portfolio + RL
strategies/portfolio-mandate.json ─ read-only dependency ──► Portfolio + RL
models/candidate.py ─────────────── editable encoder ──────► RL Judge
judges/** ───────────────────────── fixed authority ───────► result
```

## Study contract

An optional manifest field declares Project-relative source paths:

```json
{
  "dependencies": {
    "paths": [
      "factors/**",
      "strategies/factor-population.json",
      "strategies/portfolio-mandate.json"
    ]
  }
}
```

Dependencies:

- are confined to Project strategy, factor, or model source directories;
- may not overlap Judge or editable files;
- are hashed independently from editable source;
- enter `studyInputHash`;
- are copied into the isolated Judge workspace;
- are frozen in immutable Run inputs and projected in RunResult;
- are copied into Session worktrees but remain outside `editablePaths`;
- enter Session fixed locks and stale-authority checks.

Existing Study manifests may omit the field. Their identity formula remains
unchanged.

## Factor-to-RL semantics

The current cross-Study bridge accepts only a `forward-return` Factor Claim.
A fixed `forward-realized-volatility` Factor is valid standalone risk-model
evidence but has no inherited expected-return sign, Portfolio target-weight
meaning, or RL action meaning; intake and the downstream Judges reject it.

The fixed RL Judge imports the dependency's ordinary pandas API:

```python
def compute_factor(panel: pd.DataFrame) -> pd.Series:
    ...
```

The Judge independently verifies:

- complete-universe input panel is not mutated;
- output is an aligned numeric Series;
- infinity is rejected and warm-up NaN is allowed;
- repeated calls are deterministic;
- historical values remain identical when future timestamps are withheld from
  the whole panel.

The resulting cross-sectional panel becomes a `candidate` sleeve under the
same mechanical signal-state, sizing, constraint, drift, and cost contract as
every reference expert.

The Factor Population is an independent fixed dependency shared by all three
lanes. It owns prediction/context membership, evaluation mode, and explicit
evaluation-only authority. The Portfolio Mandate is another fixed dependency
shared only by Portfolio and RL. Every RL action sleeve uses its exact
tradable/context partition,
permitted sign, cash, gross/net, cap, benchmark, and final executed-book risk
semantics. Downstream Judges verify the two authorities are compatible rather
than deriving either from the other.

## Evidence

Every RL Run records:

- dependency paths, per-file hashes, and aggregate dependency hash;
- candidate factor as a declared action and fixed baseline;
- candidate-only validation and visible-test performance by fold;
- RL-minus-candidate validation and visible-test advantage;
- candidate action frequency across every declared fold and seed;
- whether RL beats the best declared baseline, which may itself be candidate;
- the complete fixed Portfolio Mandate and constraint audit for every action;
- the complete fixed Factor Population and its no-Portfolio/no-trading
  authority;
- final-book forecast coverage, pretrade breaches, risk-only no-trade
  overrides, executed breaches, and the exact execution reason.

The adaptive value-add claim is positive only when validation evidence beats
the best baseline. “RL used the candidate” and “RL beat the candidate” are
separate facts.

The upstream Factor Report separately freezes the request-bound claim,
request-fixed or train-selected comparison style, raw/style-neutral/blend
evidence, HAC evidence, and claim-specific qualification diagnosis. This
evidence explains whether the source deserves further research;
it does not mutate the dependency closure or automatically grant RL admission.
The Project Dossier preserves both factor qualification and RL factor-fusion
diagnosis so any later reviewer or collaborating Agent can identify the first
failed layer.

## Research Program behavior

The canonical desk verifies that the `factors/**` subset of the RL dependency
closure equals the current Factor Study source identity. It separately
verifies that all three lanes bind the same Factor Population. It separately
verifies that Portfolio and RL bind the same request-derived position and risk
mandate, including the exact covariance window, volatility ceiling, and
scale-up prohibition. A changed factor, population, or mandate makes prior RL
Runs stale.

Factor/Portfolio Sessions write `factors/**`; an RL Session reads the same
surface as fixed dependency. Simultaneous activity is a coordination conflict
because a Factor promotion would invalidate RL authority. The program reports
the conflict and recommends sequential work; it does not merge or stop either
Session.

## Invariants

1. Dependency source never enters the RL editable closure.
2. Dependency bytes are available in isolated execution only after hashing.
3. A dependency change cannot reuse an earlier `studyInputHash`.
4. Candidate factor timing is audited independently inside the consuming
   Judge.
5. Validation selects; test remains visible audit evidence.
6. Factor and RL evidence remain distinct and never collapse into one score.
7. Targets and actions remain research evidence with no trading authority.
8. Every RL action sleeve inherits the mandate risk governor before selection;
   editable encoder code cannot alter or bypass it.
9. Every selected post-drift sleeve is rechecked against the same ceiling, and
   any necessary repair is a scale-down-only execution decision.
10. Factor qualification is frozen research context; it cannot silently admit,
    reject, edit, or reweight the RL dependency.
