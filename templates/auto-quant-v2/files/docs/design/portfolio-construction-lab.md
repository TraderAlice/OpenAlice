# Causal signal-to-portfolio laboratory

Status: V2 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/study-run-evidence]], [[docs/design/ohlcv-factor-lab]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/caller-owned-benchmark-reference]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/portfolio-liquidity-capacity]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the first fixed portfolio Judge and reference Project:
causal signal timing, target-weight construction, portfolio accounting,
transaction-cost and capacity proxies, professional metric layers, stress
tests, artifacts, and candidate authority.

Portfolio Studies use a 180-second bounded Judge budget. The reference engine
precomputes fixed-window covariance with NumPy, reuses validated Mandate state
inside repeated simulations, stores per-bar accounting in arrays before
materializing artifacts, and deduplicates signal profiles that are equivalent
on the attainable percentile grid. These are execution optimizations only;
the fixed 15-cell robustness surface and all accounting semantics remain
unchanged.

It does not own live orders, Broker/UTA state, L2 fills, intrabar TPSL, capital
allocation across OpenAlice users, or a universal portfolio optimizer.

## Candidate and Judge boundary

The Agent edits one ordinary pandas function:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

It receives the complete Study universe as one long-form OHLCV panel and
returns an aligned numeric Series. It may use within-asset history and
same-timestamp cross-asset context. It may create NaNs during warmup but may
not mutate input, return infinity, change alignment, or depend on future
timestamps. Whole-panel prefix re-evaluation at multiple timestamp cuts audits
causality. See [[docs/design/panel-native-factor-api]].

The fixed Judge owns:

- next-bar close-to-close targets and returns;
- cross-sectional percentile entry/hold/exit/reversal state;
- conviction and trailing inverse-volatility risk sizing;
- causal trailing-covariance portfolio-volatility scale-down;
- the fixed request-derived tradable/context universe, permitted direction,
  cash, gross/net rules, caller/default structured benchmark, and
  caller/default per-asset cap;
- caller/default no-trade tolerance, base cost, reference NAV, drift,
  turnover, and volume participation;
- dataset-fixed purged chronological splits, benchmark, metrics, contribution
  attribution, stresses, and primary score.

The candidate cannot improve by changing portfolio machinery.

## Timing and target construction

For decision date `t`:

```text
OHLCV known through close t
→ candidate factor(t) and cross-sectional percentile
→ request-permitted entry/hold/exit signal intent
→ conviction divided by trailing 20-bar realized volatility known at t
→ allocate long/cash, short/cash, or equal-sided dollar-neutral budget
→ cap each absolute target at the Mandate cap; unused budget is cash
→ forecast annualized portfolio volatility from at most 60 return rows through t
→ scale the complete target down to the Mandate ceiling; never scale up
→ context-only assets remain flat with zero target
→ compare with the prior book drifted through return t
→ retain the drifted book below the Mandate no-trade band
→ otherwise rebalance at close t
→ recheck the chosen final book under the same causal covariance ceiling
→ if excessive, bypass no-trade with minimum proportional scale-down
→ earn close(t)→close(t+1) return
```

This is a `bar-target-weight simulation`. It does not claim a particular
intraday fill, queue priority, spread path, or order type.

The request-derived Portfolio Mandate decides which assets and signs may
become positions. Directional families water-fill permitted active strength
up to the gross limit and retain unused budget in cash. Dollar-neutral
families treat positive and negative scores separately and require both
equal gross sides to fund exactly; otherwise the target is flat rather than
silently changing net exposure. Exact state, threshold, conviction,
risk-strength, and allocation semantics are
[[docs/design/signal-policy-and-attribution]].

The immutable decision ledger deliberately stores every primitive needed to
audit that allocator: percentile score, conviction, trailing volatility,
risk strength, raw target, governor scale, governed target, executed weight,
and covariance component contribution. The bounded `sizingAnatomy` projection
reconstructs the same-side proportional allocation and cap redistribution
from those primitives. It is a read model of the fixed Judge—not a second
optimizer—and is defined in [[docs/design/portfolio-decision-explorer]].
The same immutable ledger supports a separate current/split diversification
read model: component-risk concentration, effective risk bets, and a fixed
25% / 50% / 100% covariance blend toward perfect position-aligned correlation.
It is defined in [[docs/design/portfolio-diversification-stress]] and never
changes allocation.

The same read model reconstructs `strategyViability` from daily gross return,
traded notional, cost, net return, and benchmark. It reconciles the fixed cost
stress and separates absent factor edge, failed gross monetization, and
cost-fragile implementation before suggesting a bounded research layer to
inspect. The diagnosis never changes this Judge's objective or verdict.

## Drift, turnover, costs, and participation

Before choosing the target at close `t`, the prior target is drifted by the
asset returns realized from `t-1` to `t` and normalized by portfolio gross
return. The trade vector is proposed or retained target minus that drifted
book.

- `one_way_turnover = 0.5 * sum(abs(trade_weight))`;
- `traded_notional = sum(abs(trade_weight))`;
- cost is `traded_notional * one_way_cost_bps / 10_000`;
- participation is absolute trade dollars divided by close times volume under
  the Mandate's research reference NAV.

The factor-of-two distinction is explicit: turnover reports portfolio
replacement fraction, while cost applies to every bought or sold dollar.
OHLCV volume supports only a coarse participation proxy, not a market-impact
or capacity guarantee.

## Evidence layers

### Factor

- coverage;
- chronological rank IC mean, ICIR, hit rate, and observations;
- top-minus-bottom forward-return spread.

### Portfolio and risk

- total return, annualized return and volatility;
- Sharpe, Sortino, maximum drawdown, Calmar;
- 95% expected shortfall and positive-period rate;
- benchmark beta, active annualized return, tracking error, and information
  ratio.

### Implementation

- mean/annualized one-way turnover and traded notional;
- total cost drag and rebalance/no-trade rates;
- average/max gross and net exposure;
- average/max absolute asset weight and concentration HHI;
- mean/max volume participation at the fixed reference NAV.
- causal 20-observation dollar-volume capacity at 1%/5% participation,
  trade-date coverage, reference-NAV breach rate, and binding assets.
- final-book forecast coverage, pretrade breaches, risk-only no-trade
  overrides, and zero available executed breaches.

### Robustness

- dataset-fixed, one-bar-purged 60/20/20 train, validation, and visible
  diagnostic test splits;
- net results under 0, 10, and 25 basis-point cost assumptions;
- one additional bar of signal delay;
- governed hysteresis versus a fixed no-hysteresis state baseline;
- a predeclared five-profile by three-band local parameter neighborhood with
  exact validation/test paths and no selection authority;
- annualized per-asset gross contribution;
- attribution by asset, signal intent, and causal regime;
- complete deterministic daily returns, proposed/executed weights, and
  per-asset decision artifacts.

The primary `validation_net_sharpe` is validation net Sharpe under the base
10 basis-point cost assumption. Test and stress metrics remain mandatory
visible evidence but never enter KEEP/REVERT. Candidate iteration after
inspecting them requires a new external holdout for a fresh production-grade
claim. See [[docs/design/research-selection-integrity]].

## Benchmark

The fixed benchmark follows the Portfolio Mandate. If the caller supplies
`benchmarkPolicy`, it is cash, one unlevered long dataset asset such as SPY,
or one funded non-negative `fixed-weights` basket over requested assets.
Otherwise Core records the direction-derived default:

- long: equal-weight long requested/tradable assets;
- short: equal-weight short requested/tradable assets;
- long-short and relative-value: cash;
- synthetic research-only: equal-weight long research universe.

The Mandate materializes one complete full-universe weight vector, and every
bar uses its dot product with next-bar asset returns. A context-only benchmark
never becomes a position. It is not a tradable recommendation. Beta, active
return, tracking error, and information ratio use the exact same chronological
dates as the evaluated portfolio. See
[[docs/design/caller-owned-benchmark-reference]].

## Artifacts

Every successful Run declares:

- `portfolio-report.json`: assumptions, split metrics, stresses, per-asset
  contribution, constraint audit, and causality cuts;
- `daily-portfolio.csv`: gross/net/benchmark returns, turnover, cost,
  exposures, unused cash budget, rebalance state, and participation;
- `proposed-target-weights.csv`: exact state-policy targets;
- `executed-weights.csv`: exact post-band per-date asset weights;
- `portfolio-decisions.csv`: exact mandate id, tradability, permitted
  direction, signal intent, raw/governed sizing, covariance forecast and
  scale, execution, return, cost, regime, component-risk, causal ADV,
  participation-capacity, and binding-asset ledger.
- `portfolio-parameter-neighborhood.json`: exact validation/test net return,
  turnover, cost, rebalance, and signal-transition paths for every predeclared
  signal-profile and no-trade-band cell.

RunResult remains the immutable authority for artifact identities.

`aq run portfolio` and Studio's latest-Run Portfolio Decision Explorer consume
these artifacts through the strict bounded projection defined in
[[docs/design/portfolio-decision-explorer]]. Full chronology is verified and
reconciled before display sampling; the browser never reads artifact paths.

## Invariants

1. Factor and portfolio values at date `t` use no data after close `t`.
2. Returns credited to a target begin strictly after its decision timestamp.
3. Candidate code never controls targets, costs, benchmark, splits, metrics, or
   score.
4. Every asset/date has an explicit signal event and allocation status.
5. Tradable/context assets, direction, cash, gross/net exposure, benchmark,
   and caps are explicit and audited.
6. Turnover and cost conventions are reported separately.
7. Aggregate performance retains split, per-asset, implementation, attribution,
   and stress
   evidence.
8. Contribution, cost, trade, and component-risk evidence reconciles daily.
9. Validation alone owns candidate selection; test is visible diagnostic
   evidence.
10. The simulation emits target weights only and has no trading authority.
11. OHLCV capacity is a contextual participation envelope, not an impact or
    fill guarantee, and never enters selection.
12. Routine tests use a small deterministic OHLCV fixture.
13. Final post-drift weights, not only targets, obey the request-bound risk
    ceiling whenever its causal forecast is available.

## Change checklist

- State decision and return timestamps for every accounting change.
- Prove allocator constraints and drift/turnover/cost identities with focused
  deterministic tests.
- Keep all portfolio mechanics in the fixed Judge closure.
- Update template discovery, Study/Run docs, Studio interpretation, package
  assets, and known-improvement/lookahead tests together.
- Do not add a metric without defining its annualization, sign, benchmark, and
  finite-value behavior.

## Known gaps

- V2 has fixed request-mapped long/cash, short/cash, dollar-neutral, and
  explicit per-asset-role families, not arbitrary optimizer constraints or a
  strategy DSL.
- Costs are linear and the capacity envelope is a trailing-dollar-volume
  participation proxy; spread, impact, borrow, funding, and futures margin are
  absent.
- Corporate actions, calendar metadata, and production price adjustments
  remain outside the synthetic fixture.
- The implemented parameter neighborhood is deliberately local and
  context-only. Correlated-grid effective trial count, PBO, and automatic
  optimization remain absent.
- The V1 risk governor uses sample covariance and a fixed ceiling. Shrinkage,
  stress covariance, risk-parity solving, and caller-approved risk budgets are
  separate work.
