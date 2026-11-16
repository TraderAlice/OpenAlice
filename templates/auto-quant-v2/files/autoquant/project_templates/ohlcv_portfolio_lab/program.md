# OHLCV Portfolio Construction Study

## Question

Can one causal panel factor become a stable cross-asset portfolio after fixed
sizing, position caps, drift-aware turnover, costs, and chronological
out-of-sample evaluation?

## Editable closure

Edit only `factors/**`. Keep the API:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

The factor receives the complete Study universe as long-form OHLCV rows with
`asset` and `timestamp`. It may combine within-asset history and
contemporaneous cross-asset context, must return one numeric aligned Series,
and may not use any future timestamp.

Before choosing a hypothesis, inspect `candidateContract` from
`aq orient . --json` or `aq study inspect . --study
ohlcv-portfolio-quality --json`. It is the authority for this Project's actual
base interval, completed feature intervals, panel columns, component metadata
fields, and legal component roles. Conditional higher-interval branches in
reusable candidate code do not prove that this Project supplies those columns.
If components are declared, roles are exactly `cross-sectional-score` or
`timestamp-context`; the latter must be one shared value across assets at a
timestamp.

Before each edit, run `aq orient . --json` and read the current verified
`researchAgenda`. Its move must still target `factors/**`: sizing, caps,
Mandate, covariance risk, no-trade, and cost remain fixed evaluation pressure.
The agenda is a validation-only experiment brief, not an executable action or
permission to select from visible test audit.

## Fixed portfolio contract

- `strategies/factor-population.json` fixes which assets supply Factor target
  observations and scores; it grants no position authority;
- `strategies/portfolio-mandate.json` fixes tradable versus context assets,
  permitted direction, cash, gross/net, cap, and a structured benchmark;
- benchmark return uses only the Mandate's complete fixed weight vector; a
  context-only benchmark asset never gains position authority;
- factor rank becomes only a mandate-permitted percentile state;
- enter long/short at `0.75 / 0.25` and exit at `0.55 / 0.45`;
- size conviction by inverse trailing 20-bar volatility;
- directional requests allocate only their permitted side and retain unused
  gross budget in cash;
- long-short/relative-value require the Portfolio Mandate's exact gross and
  equal funded long/short sides;
- an explicit asset-role Mandate applies long-only, short-only, two-sided, or
  context-only signal state per asset, allocates each active side only up to
  its locked gross-side limit, and leaves unused side capacity cash;
- context-only assets remain flat with zero target;
- maximum absolute target weight comes from the Portfolio Mandate;
- the Portfolio Mandate's decision schedule uses its locked dataset-start or
  verified XNYS session-start anchor: signal state and governed targets may
  advance only on eligible base bars, and remain frozen between them;
- forecast portfolio volatility from up to 60 complete trailing return rows
  through decision close `t`, with at least 20 observations;
- uniformly scale raw targets down to the Portfolio Mandate's annualized
  volatility ceiling and never scale exposure up;
- retain the drifted book below the Portfolio Mandate's one-way no-trade
  threshold;
- recheck that chosen post-drift book against the same causal covariance
  ceiling; risk outranks no-trade and may apply only the minimum proportional
  scale-down;
- an ineligible decision bar forbids ordinary rebalancing, but the same
  every-bar risk check may still flatten or proportionally scale down an
  unsafe drifted book;
- cost every bought/sold dollar at the Portfolio Mandate's base cost;
- estimate causal ADV from 20 `close × volume` observations through decision
  close and invert exact trade weights at 1%/5% participation;
- signal at close `t` earns only close `t` to close `t+1`;
- dataset-fixed purged 60/20/20 train/validation/test;
- primary score is validation net Sharpe only;
- mandatory 0/10/25bps, one-extra-bar-delay, and no-hysteresis comparisons.
- mandatory five-profile × three-band mechanical parameter neighborhood;
  every cell is context only and cannot select a parameter or candidate.

The Judge owns every rule above. Do not edit `judges/**`,
`strategies/portfolio-mandate.json`, the Study, program, or dataset while
comparing candidates.

Test metrics are visible diagnostic evidence and never enter KEEP/REVERT.
Changing a candidate after inspecting them consumes their holdout value; use a
new external period or dataset before a production-grade claim.

## Evidence discipline

Inspect factor, signal-state, portfolio/risk, implementation, attribution,
constraint, and robustness layers. Read `portfolio-decisions.csv` when a
conclusion depends on one asset or date. Reconcile raw and governed targets,
forecast volatility, scale, and status. Then reconcile the actual executed
book's forecast coverage, pretrade breaches, risk-only no-trade overrides,
executed breaches, and execution reason; inspect how often the ceiling binds
and whether cash exposure is signal-driven or risk-driven. Reconcile capacity
to the exact trade weight, causal ADV, and binding asset; treat missing-history
dates as unavailable, not liquid. The 1% p10 envelope is contextual and cannot
select a candidate. Read `position-episodes.csv` to inspect contiguous
executed long/short states, exact entry/resize/exit/reversal costs, holding
bars, additive contribution, MFE/MAE, and intent mismatch. Keep left/right
censored segments out of complete-episode win/payoff interpretation. This
lifecycle evidence is contextual and cannot select a candidate. The
`portfolio-parameter-neighborhood.json` artifact preserves exact
validation/test return, turnover, cost, rebalance, and signal-transition paths.
Use it to detect a one-point result, not to choose the strongest cell. The
`portfolio-translation-robustness.json` artifact, when the Factor claim is
temporal or two-asset relative value, preserves the fixed 40/60/120 causal
history-window score, state, target, return, turnover, and cost paths. Use it
to detect translation sensitivity; never select a stress window or change the
ordinary 60/20 contract. Cross-sectional Runs correctly omit that artifact.
The
ungoverned comparison is diagnostic only and cannot
select a candidate. A higher primary score is not enough when coverage
collapses, hysteresis adds no value,
concentration rises, the risk governor constantly suppresses an unstable raw
book, turnover/costs dominate, the capacity envelope is too small or poorly
covered, delayed performance reverses, attribution fails to reconcile, or one
asset explains the result. Also inspect the complete
Project-family trial count, probabilistic/deflated Sharpe, expected maximum
Sharpe from strategy search, and minimum track record. Those diagnostics do
not rewrite KEEP/REVERT and cannot be reset by starting another Session.

This is a synthetic bar-target-weight simulation, not an L2 fill model, order
instruction, or live-trading recommendation.
