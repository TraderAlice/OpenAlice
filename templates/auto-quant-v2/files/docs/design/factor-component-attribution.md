# Factor-component attribution

Status: Implemented.

Related: [[docs/design/causal-multi-interval-factor-inputs]],
[[docs/design/factor-diagnostics]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/factor-evidence-explorer]],
[[docs/design/research-selection-integrity]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Purpose

A final factor Series is necessary for ranking assets, but it is not enough for
research iteration. When an Agent combines 1h momentum, completed 4h reversal,
12h activity, and daily trend, the next useful questions are:

1. Which declared component has validation predictive evidence?
2. Which component mostly repeats another declared component?
3. Does a component retain information after its closest declared peer is
   removed?
4. Does removing it help or hurt one fixed, target-independent diagnostic
   blend?

AutoQuant answers those questions only when the candidate explicitly declares
components. Core never parses Python source or guesses column provenance.

## Candidate contract

The only required API remains:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

A candidate may additionally export:

```python
FACTOR_COMPONENTS = {
    "momentum_1h_10": {
        "label": "10-hour momentum",
        "role": "cross-sectional-score",
        "intervals": ["base"],
        "hypothesis": "Recent relative strength persists over the next bar.",
    },
    "market_stress": {
        "label": "Market stress",
        "role": "timestamp-context",
        "intervals": ["base"],
        "hypothesis": "The final factor behaves differently in stressed markets.",
    },
}

def compute_factor_components(panel: pandas.DataFrame) -> pandas.DataFrame:
    ...
```

The DataFrame contains one to twelve candidate-declared numeric Series on the
same complete-universe panel index. Its ordered columns must be unique safe
identifiers and
must be entries in `FACTOR_COMPONENTS`. Metadata may describe more components
than one dataset materializes so one source file can remain compatible with a
daily V1 Project and a multi-interval V2 Project. Evidence records only the
columns actually returned for the Run.

Each materialized component declares:

- a concise human label;
- one semantic role: `cross-sectional-score` or `timestamp-context`;
- the supplied intervals it claims to use (`base` resolves to the current
  decision interval);
- one falsifiable hypothesis sentence.

`cross-sectional-score` values may vary by asset at the same timestamp.
`timestamp-context` values must be identical across all finite assets at that
timestamp. A market-wide regime repeated down the panel is therefore explicit
context, rather than a zero-variance cross-sectional score that silently
produces useless IC.

The declaration is research metadata, not proof of runtime column access.
Candidate source and metadata are already content-locked in the Run subject.

If the function and metadata are both absent, the Run is a valid legacy
candidate and component evidence is unavailable. Supplying only one of them is
an API error.

## Fixed validation

Preflight uses at most two assets and 256 base rows. The complete Judge uses
the locked Study population. Both require:

- no input mutation;
- an exactly aligned DataFrame;
- numeric values, with warm-up `NaN` allowed and infinity forbidden;
- at least one finite observation per materialized component;
- identical columns and values for repeated fixed input;
- prefix stability when future rows are withheld;
- safe, bounded names and metadata;
- declared intervals drawn from the Run's supplied interval surface.

The complete Judge repeats prefix causality for every component. Component
failure is candidate failure because downstream evidence would otherwise
misdescribe the code.

## Fixed evidence

All predictive outcomes and split masks are the same purged request-bound
decision-bar contract used by the final factor.

For every materialized score component, the Judge records coverage and
train, validation, and test-audit evidence at every request-bound diagnostic
horizon. The statistical operation is fixed by the Factor prediction mode:

| Evaluation mode | Score measure | Association / residualization | Fixed blend |
| --- | --- | --- | --- |
| `cross-sectional` | per-date cross-sectional rank IC | same-date rank association and centered-rank OLS | equal mean of same-date percentile ranks |
| `single-asset-temporal` | within-split temporal rank-correlation contribution | within-split temporal rank association and centered-rank OLS | equal mean of within-split percentile ranks on common availability |
| `two-asset-relative-value` | within-split temporal rank-correlation contribution on first-minus-second score and forward-return contrasts | within-split temporal rank association and centered-rank OLS | equal mean of within-split percentile ranks on common availability |

In all three modes the closest other component is selected only by maximum
absolute train rank association. The Judge then records predictive evidence
after that fixed peer is removed and the effect of removing the component from
the fixed diagnostic blend. Every pair records mean and mean-absolute rank
association by split. Pairwise, residual, blend, and leave-one-out evidence is
score-only. Ties are deterministic by component name. Sparse cells retain
observations and null statistics. Temporal summaries use the same bounded HAC
contract as the final temporal Factor evidence.

For every timestamp context, train target-free tertiles define fixed
`low` / `middle` / `high` states. The Judge records each split's distribution,
state occupancy, transition rate, and final-factor contribution conditional on
state at every request-bound horizon. Cross-sectional Runs use conditional
per-date factor IC; temporal Runs use conditional within-split temporal rank-
correlation contribution. Validation may guide a regime hypothesis; test
remains visible audit and never selects thresholds or a candidate.

The fixed blend is an evaluation-mode-specific diagnostic reference:

```text
each score component
→ per-date cross-sectional rank or within-split temporal rank
→ common component availability
→ equal mean
```

Leave-one-out compares this all-component reference with the same reference
excluding one component. It is never labeled as an ablation of
`compute_factor`, because arbitrary candidate composition is not known.

## Diagnosis and selection integrity

Validation may determine a bounded research-prioritization diagnosis such as:

- preserve a component with positive raw, residual, and blend evidence;
- diversify a component that predicts but is highly redundant;
- simplify a component whose removal improves the fixed blend;
- gather more evidence for sparse or unstable components.

This diagnosis has no acceptance or trading authority. The only Factor
promotion objective remains final-factor validation primary-horizon mean
rank IC.
Test evidence is visible audit only. The number of materialized components and
pairwise comparisons is disclosed because a larger declared surface increases
researcher degrees of freedom; Project-family candidate trial adjustment
remains separately authoritative.

## Evidence flow

```text
candidate.py declaration + component DataFrame
→ fixed preflight contract
→ fixed Factor Judge
→ RunResult metrics + factor-components.json
→ hash verification and semantic reconciliation
→ Factor Explorer / Studio
→ frozen Factor Report
→ frozen Project Dossier for later review
```

The artifact is bounded structured evidence, not executable source. Historical
Runs without it project `available: false`; no evidence is invented.

## Downstream boundary

Portfolio and governed RL continue to consume only the final factor Series from
the content-locked dependency. Component evidence can guide the next Factor
experiment or a human handoff, but it cannot:

- create positions;
- alter the request-bound mandate;
- bypass covariance, execution, cost, or capacity rules;
- create dynamic RL experts or actions;
- promote a candidate;
- publish through an optional host Inbox.

If a future design wants components to become governed RL sleeves, it must
predeclare that action authority independently and compare against the same
fixed baselines. This contract does not grant it implicitly.

## Bounds

- materialized components: 1–12, partitioned into score and context roles;
- metadata entries: 1–24;
- interval claims per component: 1–6;
- component artifact: 8 MiB;
- universe: inherited Factor bound of 256 assets;
- horizons: fixed 1, 5, and 10 base bars.

## Invariants

1. Component disclosure is explicit and optional; source inference is absent.
2. Every materialized component is deterministic, aligned, immutable, numeric,
   and prefix causal.
3. Component targets, purges, splits, and final-factor population are fixed by
   the Judge.
4. Nearest-peer selection is train-only and target-free.
5. Timestamp-context states use train-only, target-free thresholds.
6. Fixed-blend ablation is not candidate-factor attribution.
7. Validation diagnoses; test only audits.
8. Final-factor `validation_mean_ic` remains the sole promotion objective.
9. RunResult, artifact, Explorer, agenda, CLI, Studio, Report, and Dossier
   consume one verified bounded Core object and disclose its evaluation mode.
10. Portfolio, RL, host, Broker, order, and account authority remain unchanged.

## Known limits

- Metadata is a candidate claim, not instrumented proof of column access.
- Pairwise residualization does not solve multivariate collinearity.
- A component can be economically meaningful even when its standalone
  evaluation-mode-correct predictive association is weak.
- Equal-rank leave-one-out describes one fixed reference blend, not every
  nonlinear or regime-dependent composition.
- Small universes can make daily cross-sectional correlations coarse.
- Temporal contribution is an association diagnostic, not causal economic
  attribution and not permission to inspect validation or test while forming
  many undisclosed candidates.
