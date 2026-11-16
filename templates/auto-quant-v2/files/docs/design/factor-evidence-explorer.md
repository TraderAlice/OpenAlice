# Factor evidence explorer

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/CLI]], [[docs/STUDIO]],
[[docs/design/factor-diagnostics]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/factor-component-attribution]],
[[docs/design/factor-qualification-funnel]],
[[docs/design/research-selection-integrity]],
[[docs/design/session-decision-matrix]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the read-only projection from one immutable fixed Factor Lab
Run into a bounded professional tear sheet for Agents and Studio. It defines
artifact verification, reconciliation, sampling, split roles, response schema,
CLI discovery, and browser presentation.

It does not own factor computation, targets, Judge statistics, candidate
selection, Experiment verdicts, portfolio sizing, report authorship, or trading
authority.

## Authority flow

```text
verified successful Factor Run
→ verified factor-report + daily IC + quantile + availability artifacts
→ full-history reconciliation with immutable Run metrics
→ bounded deterministic IC and quantile paths
→ fixed horizon/stability/style summaries
→ aq run factor / Studio Factor evidence explorer
```

The Run manifest hash-verifies every byte before this projection opens an
artifact. Core then checks the fixed artifact set, schema, row bounds,
chronology, split membership, horizon identity, and aggregate reconciliation.
Sampling happens last.

## Public contract

```text
aq run factor <project-or-workspace> --run <id>
  [--points 40..400] [--project <id>] [--json]
```

The result kind is `autoquant-factor-diagnostics`. The operation is read-only,
has no arbitrary file route, and returns no candidate source.

## Evidence model

### Identity and protocol

The projection preserves Run, Study, objective, dataset, Harness, artifact
hashes, the fixed Horizon Mandate, derived `factorOutcome`, target semantics,
style dictionary, and
split roles:

- train — construction/training evidence;
- validation — the only selection split;
- test — visible audit evidence that never enters selection.

### Summary

Decision-useful summary fields include:

- validation and test-audit rank/Pearson IC, ICIR, hit rate, HAC t/p, and
  observations;
- weakest validation chronological fold;
- maximum absolute validation style correlation;
- mean factor coverage and mean cross-sectional rank turnover.

Positive values are evidence, not automatic approval. The browser must not
colour significance, stability, or monotonicity as “passed” without a fixed
threshold.

### Input availability

New Runs publish `factor-availability.csv` together with
`metrics.input_availability` and the matching Factor report object. Core
reconciles every timestamp's observed input assets, finite factor assets, and
forward-target-paired assets for each declared horizon. It also verifies
observed/possible rows, complete timestamps, eligible timestamps, per-asset
observed start/end/coverage, and the explicit
`observed-only-no-fill-v1` method.

The availability artifact owns the complete source-panel union and is not
required to share the prediction clock used by daily IC evidence. This matters
for asynchronous cross-market research: context closes remain visible as
source evidence even when no target closes at the same instant. The Explorer
exposes the reconciled union as `inputAvailability`; its bounded path retains
only source rows that coincide with deterministic IC anchors, without claiming
that the two complete timelines are identical. Historical Runs without the
paired metric/artifact remain readable as
`available=false, reason=legacy-run`; partial or mismatched new evidence fails
closed.

### IC path and horizon profile

The complete daily artifact is checked for strict dates, declared split,
causal regime, and nullable finite rank/Pearson IC at the exact Horizon
Mandate bars. For every split/horizon, Core recomputes observation counts and
means and reconciles them to Run metrics.

The response then samples one shared timestamp index. It preserves first/last,
split boundaries, regime transitions, and the maximum absolute
primary-horizon IC. Every point retains split, role, regime, and both IC
statistics for every declared diagnostic bar so chart tabs never change the
evidence population.

### Quantiles

Cross-sectional evaluation declares `quantileEvidence.status=available`. Its
complete quantile artifact must contain one unique
`timestamp × split × horizon` row with finite low/middle/high and
high-minus-low outcomes. Core recomputes mean group outcomes, spread,
monotonicity, and observation count for every split/horizon and reconciles
them to the immutable metric tree.

Quantile path points use the same sampled date anchors where available.
Studio may switch horizon and split, but it cannot re-bin assets.

Single-asset temporal and two-asset relative-value evaluation have no
cross-sectional prediction population to divide at one timestamp. Their
immutable protocol therefore declares
`unavailable-for-temporal-evaluation-v1`, publishes a reconciled empty
quantile artifact, and projects
`quantileEvidence.status=protocol-unavailable` with reason code
`temporal-tertiles-not-defined`. The null quantile summaries are
protocol-not-applicable, not missing data or failed evidence. CLI states that
reason directly; Studio labels and disables the Quantiles tab rather than
showing an unexplained empty chart.

### Stability and style overlap

Core projects the fixed summary dictionaries as normalized rows:

- two chronological folds per split;
- causal `up/down × calm/stressed` regimes;
- per-asset time-series rank correlation;
- momentum, reversal, realized-volatility, and relative-volume style overlap.

Rows retain observations, sufficiency flags where declared, and null values.
Sparse evidence must remain visible rather than being pooled away.

### Factor qualification

New Runs bind a request-derived Factor claim and add a claim-aware one-style
artifact. A novel claim selects its comparison on train; a known-style claim
uses the caller-predeclared style. Core reconstructs candidate, style,
style-neutral residual, equal-rank blend, and candidate/residual chronological
fold evidence for every fixed split and horizon. Validation applies the
claim-specific funnel. Test is a separate visible audit.

### Candidate-declared components

New declaring Runs add `factor-components.json`. Core requires the artifact and
`metrics.factor_components` to appear together, verifies immutable identity,
requires exact metric reconciliation, then validates component count,
declarations, coverage, fixed horizons/splits, pair identities, residual peer,
fixed-blend ablation deltas, diagnosis, and authority.

The bounded projection separates predictive score components from timestamp
context and declares its evaluation mode. Cross-sectional scores show
per-date validation rank IC; single-asset and two-asset relative-value scores
show within-split temporal rank-correlation contribution. Both modes expose
association with the final factor, train-selected nearest-peer redundancy,
matching residual evidence, fixed equal-rank blend removal delta, and visible-
test audit. Context shows train-fixed state occupancy, transitions, and
evaluation-mode-correct conditional contribution. Historical incompatible
Runs project `factorComponents.available=false`; pre-1.0 mutable Workspaces are
not silently adapted. The UI explicitly says the declaration is a candidate
claim and the ablation target is not the arbitrary final factor.

## HCI

The Factor Explorer answers five questions in one reading order:

1. Is validation evidence economically and statistically non-trivial?
2. Does it persist through time and across the request-bound forward horizons?
3. Is the high-minus-low behavior monotonic rather than one lucky aggregate?
4. Is the signal stable across assets/regimes/folds and distinct from fixed
   OHLCV styles?
5. Which explicitly declared source components add validation information,
   duplicate a peer, or degrade the fixed diagnostic blend?

Studio uses a compact summary followed by:

- IC path / quantile-path tabs;
- Horizon-Mandate diagnostic-bar controls with the primary marked;
- validation / test-audit controls;
- horizon profile and fold/regime/asset/style stability tables.

Test controls and cells carry an explicit audit label. The page remains
read-only and copy-only for CLI commands.

## Bounds

- artifact size: 32 MiB each;
- daily rows: 100,000;
- quantile rows: 300,000;
- universe: 256 assets;
- response points: 40–400;
- one to five request-bound horizons, each between 1 and 252 decision bars;
- component artifact: 8 MiB; materialized components: 1–12.

Full artifacts are reconciled before these response bounds apply.

## Invariants

1. No artifact is read before immutable Run verification.
2. Exactly one fixed Factor artifact set is accepted; availability evidence is
   optional only for legacy Runs and otherwise must appear as a reconciled
   metric/artifact pair.
3. Full daily/quantile evidence reconciles before deterministic sampling;
   temporal empty quantile evidence is accepted only with the exact immutable
   protocol-unavailable declaration.
4. Validation primary-horizon mean rank IC remains the only selection
   objective.
5. Test, non-primary horizon, quantile, stability, and style evidence are
   diagnostic only.
6. Missing/sparse values remain null with observations; zero is never
   substituted.
7. CLI and Studio consume the same Core object.
8. The projection has no Project mutation, Broker, order, or account authority.
9. Qualification style selection uses train overlap only; validation/test
   cannot change it or authorize Factor promotion or RL admission.
10. Component declarations are explicit, never source-inferred; their
    diagnostics do not change final-factor selection or downstream authority.

## Change checklist

- Add an evidence field only with fixed timing, split, unit, and selection
  semantics.
- Preserve full-file reconciliation and response bounds.
- Update schema, capability, CLI, Studio, docs, tests, and package assets
  together.
- Exercise negative/tampered evidence and a real-data Factor Run.

## Known limits

- V1 supports the fixed OHLCV Factor Lab across cross-sectional,
  single-asset-temporal, and two-asset-relative-value evaluation modes.
- HAC and style evidence are Judge-authored summaries; Core reconciles the
  underlying mean paths but does not reimplement every statistical estimator.
- The explorer does not estimate capacity or portfolio performance.
- The fixed single-Run HAC threshold is diagnostic only; Project-family
  selection-adjusted significance remains a separate Session-level surface.
- Cross-Run comparison remains owned by the Session Decision Matrix.
