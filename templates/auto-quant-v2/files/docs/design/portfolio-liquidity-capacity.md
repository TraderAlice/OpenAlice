# Portfolio liquidity-capacity envelope

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/portfolio-decision-explorer]],
[[docs/design/session-decision-matrix]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the fixed OHLCV-only capacity diagnostic for the Portfolio
Judge and its verified read surfaces. It covers causal trailing dollar volume,
participation ceilings, exact trade-weight inversion, unavailable evidence,
split distributions, binding assets, and interpretation.

It does not own order execution, spread or impact estimation, live capital,
Broker/UTA state, liquidity-constrained optimization, or candidate selection.

## Fixed estimation policy

At decision close `t`, for asset `i`:

```text
dollar_volume(i,t) = close(i,t) × volume(i,t)
ADV20(i,t) = mean of the latest 20 dollar-volume observations through t
capacity(i,t,p) = p × ADV20(i,t) / abs(executed_trade_weight(i,t))
portfolio_capacity(t,p) = min over active asset trades
```

`p` is one of the fixed one-way participation ceilings `1%` and `5%`.
The `1%` envelope is the conservative headline; `5%` is an upper diagnostic,
not an execution recommendation. Trade weights are the exact post-drift,
post-no-trade-band trades used by accounting. A zero-trade date has no
capacity observation rather than infinite capacity.

All 20 observations, including the current close and volume, are known at the
decision close. An active trade with fewer than 20 observations makes that
date unavailable. Core must not silently drop its binding asset and calculate
capacity from the remaining trades.

## Split evidence

For train, validation, and visible-test dates, the Judge publishes:

- total trade dates, available dates, and unavailable dates;
- conservative/upper minimum, 10th-percentile, and median capital capacity;
- breach rate of the Portfolio Mandate's caller/default reference NAV;
- binding-asset counts at the conservative ceiling.

Percentiles operate over per-date portfolio capacity, so one busy rebalance
with several assets contributes one observation. The minimum is a worst
observed point, while the 10th percentile is the less brittle operating
summary. Neither is a guarantee: OHLCV volume has no spread, depth, queue,
impact, or intraday path.

## Evidence and authority

Every new `portfolio-decisions.csv` row records the causal ADV, reference-NAV
participation, both implied asset capacities, capacity status, and whether the
asset binds the per-date conservative envelope. The RunResult and
`portfolio-report.json` publish the aggregate policy and split metrics.

The Portfolio Explorer verifies ledger formulas and aggregate metrics before
projecting:

- validation/test envelope summaries;
- current/recent rebalance capacity and binding assets;
- policy limitations and selection authority.

CLI, Reports, Dossiers, and Studio consume the same Core evidence. Capacity is
historical research evidence only. A local reviewer or collaborating Agent may
use it to frame a later capital or execution review, but AutoQuant cannot infer
authenticated account size or place live orders.

## Selection role

Capacity descriptors use preference `context`,
`selectionEligible=false`. An inactive strategy may appear highly scalable,
and no request-bound capital threshold currently exists. Capacity therefore
cannot change KEEP/REVERT or Session non-dominance. Portfolio performance,
turnover, and contribution evidence remain separately visible.

## Legacy evidence

Older immutable Portfolio Runs without capacity columns remain readable.
Their Explorer capacity field is explicitly unavailable and makes no inferred
claim from the old single-day participation metric.

## Invariants

1. ADV at `t` uses no close or volume after `t`.
2. Every active trade must have eligible ADV before a date-level capacity is
   available.
3. Capacity scales linearly with the participation ceiling and inversely with
   absolute trade weight.
4. The binding asset exactly attains the per-date minimum.
5. Aggregate metrics reconcile the complete ledger before bounded display.
6. No-trade dates never create infinite or fabricated capacity.
7. Capacity never affects targets, performance, selection, or live authority.

## Change checklist

- Prove prefix causality and per-date formula reconciliation.
- Test no-trade, partial-history, zero/invalid input, and binding-asset cases.
- Preserve legacy Explorer behavior.
- Update Portfolio/RL wording, matrix descriptors, CLI, Reports, Dossiers,
  Studio, schemas, templates, and wheel assets together.
- Run repository-required documentation and full test suites.
