# Mechanical portfolio parameter neighborhood

Status: V1 implemented.

Related: [[docs/design/portfolio-construction-lab]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/research-selection-integrity]],
[[docs/design/portfolio-decision-explorer]],
[[docs/design/target-translation-robustness]], and
[[docs/design/session-decision-matrix]].

## Purpose

The fixed Portfolio Judge must answer a local stability question that one
headline backtest cannot:

> Does the same candidate factor retain useful mechanical portfolio behavior
> when nearby, economically interpretable entry/exit and rebalance thresholds
> are used?

This is not an optimizer. It is a predeclared context stress around the fixed
base policy. AutoQuant exposes every cell and never promotes, recommends, or
silently substitutes another cell.

## Fixed neighborhood

Signal profiles preserve the same percentile state machine, inverse-volatility
conviction sizing, request-bound mandate, covariance risk governor, and
next-bar accounting:

| Profile | Long entry | Long exit | Short exit | Short entry | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| `broad-entry` | 0.55 | 0.55 | 0.45 | 0.45 | Adjacent rank bucket enters; no persistence |
| `base` | 0.75 | 0.55 | 0.45 | 0.25 | Fixed production research policy |
| `selective-entry` | 0.95 | 0.55 | 0.45 | 0.05 | Only the extreme rank bucket enters |
| `fast-exit` | 0.75 | 0.75 | 0.25 | 0.25 | Base entry with no persistence |
| `selective-fast-exit` | 0.95 | 0.75 | 0.25 | 0.05 | Joint selective-entry / fast-exit stress |

Each profile is crossed with three deterministic one-way no-trade bands:
`0.00`, the exact Mandate base, and a bounded adverse local band
`min(1.00, max(0.10, 2 × base))`. Duplicate bands collapse. Configuration
identities and ordering remain fixed Judge authority; the dynamically named
`base__band-*` cell at the exact base must reproduce the ordinary Portfolio
Run exactly.

The six-asset construction fixture has discrete cross-sectional percentile
scores `0.0, 0.2, …, 1.0`. Threshold changes therefore cross the adjacent
attainable rank bucket rather than changing a decimal that maps to the same
positions. Production universes retain the same predeclared percentiles.

The neighborhood does not vary:

- candidate factor bytes or dataset;
- request-derived universe, position direction, cash, gross, cap, benchmark,
  or risk policy;
- cost, execution delay, split boundaries, or primary objective;
- causal covariance estimation or final executed-book compliance.

Those assumptions already have separate fixed stresses or authority contracts.
Temporal score-history stability is deliberately separate under
[[docs/design/target-translation-robustness]] and is not crossed with this
threshold/no-trade grid.

## Exact evidence

The immutable `portfolio-parameter-neighborhood.json` artifact contains one
daily row for every configuration, split, and eligible signal timestamp.
Rows carry:

- configuration and signal-profile identity;
- no-trade band, split, role, and timestamp;
- net and benchmark return;
- one-way turnover, cost, and rebalance state;
- signal decision rows, transitions, entries, exits, and reversals for that
  timestamp.

The RunResult carries the declared policy, every configuration's full net
performance, implementation summary, signal summary, delta from the base
configuration, and split-level aggregate ranges. The artifact preserves paths
so the public Explorer can independently reconstruct all aggregate claims.

## Aggregate interpretation

For validation and visible-test separately, AutoQuant reports:

- fraction of configurations with positive net Sharpe;
- fraction whose Sharpe sign agrees with the base;
- minimum, median, maximum, and population standard deviation of net Sharpe;
- worst and best Sharpe delta versus the base;
- annualized turnover, total cost, and signal-transition ranges.

The base configuration rank may not be used as a recommendation. No “best
configuration” field exists. A heatmap is a diagnostic surface, not an
optimization result.

## Selection and trading authority

The complete neighborhood declares:

```text
role = robustness-only
selection authority = context-only
trading authority = none
```

It never changes `validation_net_sharpe`, KEEP/REVERT, Session leadership,
Portfolio Mandate, or a report recommendation. Test remains visible audit
evidence and cannot select parameters. If a researcher edits the candidate or
the fixed policy after inspecting this surface, a fresh external holdout is
required for a new production-grade claim.

## Public verification

The Portfolio Explorer:

1. verifies the immutable Run and every declared artifact hash;
2. requires metric and artifact availability to agree;
3. derives and requires the exact Mandate-local configuration set and split
   date coverage;
4. rejects duplicate, missing, extra, unordered, or non-finite rows;
5. reconstructs performance, turnover, cost, rebalance, and signal summaries;
6. reconciles every configuration with RunResult metrics;
7. independently reconciles the base cell with ordinary Portfolio,
   implementation, and signal-policy metrics.

Legacy Runs with neither the metric nor artifact remain valid and disclose
that the neighborhood is unavailable. Partial or inconsistent evidence is
invalid.

## Studio presentation

Studio shows a five-row by three-column heatmap for validation or visible-test
audit. Each cell exposes net Sharpe and the base cell is explicitly outlined.
Adjacent statistics show sign agreement, positive-Sharpe coverage, worst
local degradation, and implementation ranges.

The surface must say “predeclared local neighborhood”, “context only”, and
“no parameter selection”. It must not visually crown a winner.

## Invariants

1. The neighborhood is fixed before candidate evaluation.
2. The base cell exactly reproduces ordinary Portfolio evidence.
3. Candidate code controls no neighborhood dimension or result aggregation.
4. Every cell uses the same mandate, data, risk, cost, delay, and split.
5. Validation and test are displayed separately; test never enters selection.
6. No downstream surface recommends or promotes a configuration.
7. Exact daily paths, not trusted aggregate JSON alone, support public claims.
8. The artifact and RunResult remain immutable research evidence with no
   Broker or account authority.
