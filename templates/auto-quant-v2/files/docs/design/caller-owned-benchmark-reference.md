# Caller-owned benchmark reference

Status: implemented.

Related: [[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/portfolio-decision-explorer]], and
[[docs/design/program-research-dossiers]].

## Purpose

The collaborating workbench owns the opportunity-cost question; AutoQuant
owns reproducible evaluation against it.

```text
Research Request.benchmarkPolicy
→ complete content-addressed Portfolio Mandate benchmark contract
→ shared Portfolio / governed-RL daily benchmark path
→ beta, active return, tracking error, information ratio, Report, and Dossier
```

Candidate factor and encoder code cannot edit this chain.

Portfolio, governed RL, and fixed Allocation accept the same caller forms
below. A fixed-weight basket extends only evaluation/reference authority; it
does not extend candidate position authority.

## Request contract

`benchmarkPolicy` is optional. When supplied it is exactly one of:

```json
{"kind": "cash", "symbol": null}
```

```json
{"kind": "asset", "symbol": "SPY"}
```

For `asset`, `symbol` must be a non-empty dataset-universe symbol. It may be
one of the requested tradable assets or a context-only asset. For `cash`,
`symbol` must be null. The third form is:

```json
{
  "kind": "fixed-weights",
  "weights": {"SPY": 0.6, "TLT": 0.4}
}
```

Every fixed-weight leg must be requested, strictly positive, no greater than
one, and the basket must sum to one. Core fills zero for every other research-
universe asset. A context-only leg belongs only to the reference; it remains
zero in candidate targets, executed weights, and risk contributions.

When omitted, Core records `direction-default`. Requests without explicit
asset roles retain the direction-derived reference:

- long: equal-weight long tradable;
- short: equal-weight short tradable;
- long-short and relative-value: cash;
- research-only: equal-weight long research universe.

An explicit asset-role request instead filters the default reference by sign
permission: long uses equal-weight long-capable assets, short uses
equal-weight short-capable assets, long-short/relative-value uses cash, and
research-only prefers long-capable assets (or short-capable when no long role
exists). A short-only hedge therefore never enters an implicit long reference.

## Mandate contract

`construction.benchmark` is a strict structured object:

```json
{
  "source": "caller-supplied",
  "kind": "single-asset-long",
  "asset": "SPY",
  "weights": {
    "AAPL": 0.0,
    "MSFT": 0.0,
    "SPY": 1.0
  }
}
```

`weights` is complete over the exact research universe. Cash has all-zero
weights. A single-asset reference has exactly one `1.0`. Direction defaults
materialize their exact equal weights. A caller fixed-weight reference
materializes its positive requested legs and zero-fills the remaining
research universe with `kind: fixed-weights`, `asset: null`, and
`source: caller-supplied`. The benchmark object, request hash, Mandate id,
fixed dependency hash, Study input, Session, and Run identity all change
together.

## Accounting

For each decision bar `t`, benchmark return is:

```text
benchmark_return(t→t+1) = Σ benchmark_weight_i × asset_return_i(t→t+1)
```

For Portfolio and governed RL, the vector is fixed for the Run and does not
drift or rebalance through a Broker model. It is an evaluation index used by
the existing chronological performance equations.

Portfolio and every governed-RL action sleeve receive the same Mandate and
therefore the same benchmark path. Gross/net returns, costs, and positions do
not depend on benchmark choice. Benchmark beta, active annualized return,
tracking error, information ratio, relative growth, and handoff interpretation
do.

Allocation simulates the same fixed-weight request form as a separately funded
portfolio on the caller's decision schedule, with its own drift, no-trade
decisions, turnover, and linear costs. Portfolio/RL instead use the fixed
vector dot product above. Candidate caps and volatility control never apply
to either reference.

## Authority and roles

A benchmark asset:

- may contribute OHLCV and cross-sectional research context;
- contributes only to benchmark-return evaluation through fixed weights;
- does not enter `tradableAssets`;
- receives no signal state, target, executed weight, position cap, or order
  authority unless it was independently requested as tradable;
- remains `quantitative-decision-support` with `tradingAuthority: none`.

## Invariants

1. Caller benchmark symbols must exist in the locked dataset universe.
2. Benchmark membership never expands position authority.
3. Cash weights are all zero; a named asset is exactly unlevered long one; a
   fixed basket is non-negative, funded to one, and zero-filled over the
   remaining universe.
4. Direction-default weights are fully materialized and content-derived.
5. Portfolio and all RL sleeves use one identical benchmark vector.
6. Candidate source cannot select, edit, or infer a different benchmark.
7. Every consumer distinguishes caller-supplied from direction-default
   reference semantics.
8. Changing a benchmark changes Mandate and Run identity, not historical
   evidence in place.

## Known limits

- Portfolio, governed RL, and Allocation support only one caller-funded
  non-negative fixed-weight basket; leverage, short benchmarks, factor
  benchmarks, dynamic benchmark optimization, and authenticated cash yield
  remain unsupported.
- The benchmark is a fixed research index, not a live investable product,
  financing model, or order instruction.
