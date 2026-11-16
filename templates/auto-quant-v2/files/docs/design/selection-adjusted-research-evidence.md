# Selection-adjusted research evidence

Status: implemented.

Related: [[docs/design/research-selection-integrity]],
[[docs/design/session-decision-matrix]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/program-research-dossiers]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the fixed Project-wide research-family identity and the
selection-adjusted statistics that Core may derive from verified immutable
Runs. It answers:

> After searching this fixed data and evaluator repeatedly, how surprising is
> the selected validation result?

It does not replace the immutable primary-objective verdict, prove production
performance, infer statistical independence, or authorize an order.

The equations follow Bailey and López de Prado, [The Deflated Sharpe Ratio:
Correcting for Selection Bias, Backtest Overfitting and
Non-Normality](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).
That method corrects Sharpe evidence for sample length, non-normal returns, and
multiple selection trials. PBO is not computed because it requires a complete
combinatorial in-sample/out-of-sample strategy matrix that current Runs do not
publish.

## Research family

Session lifetime is not the statistical boundary. Core derives a family id
from:

```text
Study id
+ program hash
+ Judge hash
+ dataset content hash
+ fixed dependency hash or null
+ objective metric, direction, and minimum improvement
→ content-derived research-family id
```

Every verified Project Run with that exact fixed contract and completed no
later than the projection cutoff belongs to the family. Harness source state
is not part of this identity: the copied Judge, program, data, and dependency
bytes are the evaluation authority. A changed fixed byte starts a new family.

Runs are grouped by editable `subject.sourceHash`:

- one source hash is one attempted strategy trial;
- rerunning identical source increments executions, not unique trials;
- a source with at least one successful Run contributes one objective value;
- mixed success/failure status or different successful values for the same
  source violate reproducibility;
- sources with no successful Run remain failed attempted trials.

The projection publishes a hash over the complete as-of family ledger, counts,
and a reproducibility flag without sending an unbounded trial list to Studio.
Unique source count is a conservative upper-bound proxy for independent trials,
not an estimate of effective independent strategies.

## As-of semantics

Live Session and comparison projections use every current matching Project
Run. Report publication freezes the family as of `publishedAt`. Report loading
recomputes all matching Runs completed by that timestamp and rejects an
omitted, altered, or invented family ledger. Later Runs change live
selection-risk evidence but do not invalidate an older immutable Report or
Dossier.

## Objective-family methods

All methods use validation evidence only.

### Factor: family-wise HAC inference

The selected Factor Run already reports the two-sided normal-approximation
Newey–West/Bartlett p-value for mean validation rank IC. For `N` unique source
trials:

```text
adjusted_p = min(1, raw_hac_p × N)
familywise_confidence = 1 - adjusted_p
passes_95 = adjusted_p <= 0.05
```

Bonferroni does not require independent trials. It may be conservative, which
is preferable to inventing dependence information.

### Portfolio: PSR and DSR

For validation net returns, the fixed Judge publishes:

- observation count `T`;
- annualization periods `A`;
- annualized and per-period Sharpe;
- population skewness `γ3`;
- population non-excess kurtosis `γ4`.

The Probabilistic Sharpe probability above threshold `SR*` is:

```text
z = ((SR - SR*) × sqrt(T - 1))
    / sqrt(1 - γ3×SR + ((γ4 - 1) / 4)×SR²)
PSR = Φ(z)
```

All Sharpe values inside this equation are per observation. Displayed annual
values multiply by `sqrt(A)`.

For `N > 1`, let `σ_SR` be the population standard deviation of successful
unique-trial per-period Sharpes and `γ ≈ 0.5772156649` the Euler–Mascheroni
constant:

```text
expected_max_SR =
  σ_SR × (
    (1 - γ) × Φ⁻¹(1 - 1/N)
    + γ × Φ⁻¹(1 - 1/(N×e))
  )
```

For one unique trial the threshold is zero. DSR is the PSR equation evaluated
against `expected_max_SR`. The projection includes PSR above zero, DSR,
expected maximum annual/per-period Sharpe, a 95% threshold, and whether the
selected record is long enough. Minimum track-record observations invert the
same equation; when selected Sharpe does not exceed the adjusted threshold,
the required length is unavailable and the evidence does not pass.

Failed source trials increase `N` but do not provide a Sharpe for estimating
`σ_SR`. A multiple-trial family with fewer than two successful Sharpe
observations fails closed as `insufficient-successful-sharpe-trials`. When two
or more successful strategies genuinely have identical Sharpe, zero dispersion
is disclosed rather than replaced with an arbitrary prior.

### Governed RL

The fixed RL objective is a mean across dependent expanding folds and repeated
training seeds. It is not one return series, and concatenating or duplicating
those paths would manufacture sample size. Core still publishes the
Project-wide family ledger, but selection adjustment is:

```text
status = unsupported
reason = aggregate-dependent-fold-seed-objective
```

The existing minimum fold/seed, failure-rate, and baseline-advantage evidence
remain authoritative diagnostics. A future RL evaluator may add a predeclared
single deployment-policy return path or a statistically valid resampling
contract.

### Generic and legacy evidence

Unknown objective families or historical Portfolio Runs without the required
moments publish `status=unsupported` with a stable reason. Core never
reconstructs higher moments from an unverified summary or invents zero.

## Projection

`selectionIntegrity` gains:

- `researchFamily`: id, ledger hash, cutoff, fixed boundary, total executions,
  unique/successful/failed source trials, duplicates, and reproducibility;
- `selectionAdjustment`: status, method, assumptions, confidence threshold,
  statistic inputs/results, pass state, and a concise interpretation;
- `verdictAuthority: diagnostic-only`.

The Session decision matrix, Report Markdown, Dossier lane summaries, and
Studio Session/Inspector surfaces use this exact Core object. Browser code may
format probabilities but cannot calculate them.

## Invariants

1. Session restart cannot erase Project-wide fixed-family trial history.
2. Fixed evaluator/data/dependency changes start a distinct family.
3. Identical source reruns do not inflate unique trial count.
4. A Report family is complete as of publication and immutable afterward.
5. Test returns never enter selection adjustment.
6. DSR uses period Sharpe, sample length, skewness, kurtosis, and disclosed
   trial dispersion; missing inputs fail closed.
7. RL does not receive a single-path statistic from dependent aggregate data.
8. Selection adjustment is professional decision support, not a trading or
   retrospective verdict authority.

## Change checklist

- Preserve historical Run and Report loading with explicit unsupported status.
- Unit-test Normal CDF/inverse-CDF fixtures and every unavailable boundary.
- Prove cross-Session family continuity, as-of Report freezing, duplicate
  deduplication, and reproducibility detection.
- Update Session, Report, Dossier, decision matrix, CLI/Studio, templates,
  docs, package assets, and bounded browser fixtures together.
