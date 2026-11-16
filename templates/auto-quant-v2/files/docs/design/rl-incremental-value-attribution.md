# RL incremental value attribution

Status: implemented.

Related: [[docs/design/causal-rl-policy-state-and-baseline]],
[[docs/design/rl-policy-behavior-rationale]], and
[[docs/design/rl-factor-opportunity-audit]].

## Research question

Standalone Sharpe does not establish adaptive value. The relevant comparison
is the RL portfolio path against the simpler policy selected by the fixed
validation protocol. A negative Sharpe advantage alone does not say whether
the adaptive policy chose worse books, paid more to move between them, failed
only in one market state, or concentrated the loss in a small set of assets.

## Comparison path

For each fold:

1. Select the mechanical comparator using validation exactly as the Judge
   already specifies.
2. Freeze that baseline name.
3. Roll the baseline and every seeded RL policy independently through the
   complete validation path.
4. Roll the same frozen policies independently through test without making a
   new selection.
5. Pair rows only by fold, seed, split, and timestamp.

This is a full-path comparison. It does not replace one action on the RL path
or propagate an ex-post oracle. Each policy carries its own holdings, drift,
no-trade decisions, risk repair, turnover, and costs.

## Exact additive identities

For timestamp `t`:

```text
active gross return
  = RL gross return - baseline gross return
  = Σ_asset ((RL weight - baseline weight) × next return)

incremental cost
  = RL cost - baseline cost

active net return
  = active gross return - incremental cost
```

The immutable evidence reconciles both identities before publication. Reward
difference is shown separately because it also contains the fixed quadratic
risk penalty and is not the portfolio performance objective.

## Trader readout

The primary validation readout includes:

- mean-trial annualized active return, tracking error, and information ratio;
- mean-trial-path and exact reconciliation totals for gross edge,
  incremental cost, and net active return;
- active-day frequency, conditional active-day win rate, fifth-percentile
  active day, and mean relative-path drawdown;
- results by causal volume regime, five-bar market trend, and a train-frozen
  volatility threshold;
- policy-versus-baseline action pairs and switch/hold behavior;
- exact per-asset active gross contribution.

Regime and conditional tables are descriptive diagnostics, not additional
selection objectives. Test retains the visible-audit role and repeated
inspection consumes its holdout value.

## Authority

The Judge owns baseline selection, portfolio accounting, attribution, and
aggregation. Candidate code cannot alter the comparison path or labels. The
artifact carries no Broker, account, capital, position, order, or trading
authority.

## Bounded fixture finding

The causal volume-regime candidate completed the six-path fixture in `30.732`
seconds and still trailed the validation-selected contextual baseline by
`6.032028` Sharpe. Full-path attribution located the loss:

- mean-trial-path gross edge was `-0.062631`, incremental cost was `0.001730`,
  and net active return was `-0.064362`;
- extra cost explained only about `2.7%` of the net deficit; book selection,
  not fees, dominated;
- the policy differed materially on `30.56%` of days and won `37.27%` of those
  active days;
- below-trend volume rows contributed essentially the entire aggregate loss,
  while above-trend volume rows were slightly positive;
- the largest action-pair losses occurred when RL chose `activity` or
  `balanced` while the baseline chose `intraday`;
- `policy-switch / baseline-hold` rows accounted for nearly the complete net
  deficit, concentrated in fold 1 seeds 11 and 29; fold 2 and fold 1 seed 47
  were slightly positive.

The next learning experiment should target low-volume switch stability and
seed dispersion. Adding generic model complexity is not supported by this
evidence.
