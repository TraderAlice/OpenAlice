# Request-bound Portfolio Mandates

Status: V3 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]], [[docs/CLI]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/caller-owned-factor-population]],
[[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/caller-owned-asset-position-roles]],
[[docs/design/caller-owned-benchmark-reference]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Scope

This document owns the fixed position contract that connects a delegated
Research Request to Portfolio and governed-RL evidence. It separates the
assets a caller authorized AutoQuant to model as positions from the wider
research universe used for cross-sectional context.

It does not grant live-trading authority, infer hedges, choose leverage,
optimize arbitrary constraints, place orders, or mutate OpenAlice UTA state.
It also does not choose the Factor evaluation population. That independent
caller authority is frozen in `strategies/factor-population.json`; Portfolio
and governed RL must bind and reconcile both contracts.

## Project contract

Every newly constructed Portfolio or governed-RL Project contains:

```text
strategies/
└── portfolio-mandate.json
```

The strict `autoquant-portfolio-mandate` records:

- a content-derived mandate id;
- whether it came from a normalized Research Request or a synthetic template;
- the exact request hash and requested direction;
- research, tradable, and context-only asset sets;
- construction family, complete per-asset position-role vector, long/short
  gross-side limits, gross limit, net rule, per-asset cap, cash permission,
  short permission, and a complete structured benchmark contract;
- fixed trailing-covariance method, annualized volatility ceiling, lookback,
  minimum history, annualization, and no-scale-up rule;
- fixed linear base cost, one-way no-trade band, research reference NAV, and
  named accounting/capacity models;
- `quantitative-decision-support` authority and `tradingAuthority: none`.

The file is a fixed Study dependency, not candidate-editable source and not
Judge source. Its bytes enter Study, Run, and Session identity. Portfolio and
RL Studies in one canonical Research Desk depend on the same exact file.

Historical Projects whose copied Studies predate this dependency remain
loadable. Their verified evidence is explicitly projected as legacy implicit
research-neutral behavior; it is never reinterpreted as request-bound.

## Request mapping

Core derives one deterministic position contract from the normalized request.
When `request.benchmarkPolicy` is omitted, it also derives this explicit
default benchmark:

| Request direction | Tradable assets | Family | Net rule | Benchmark |
| --- | --- | --- | --- | --- |
| `long` | requested assets only | `long-cash` | long-only | equal-weight long requested assets |
| `short` | requested assets only | `short-cash` | short-only | equal-weight short requested assets |
| `long-short` | requested assets only | dollar-neutral | zero | cash |
| `relative-value` | requested assets only | dollar-neutral | zero | cash |
| `research-only` | complete research universe | dollar-neutral | zero | equal-weight long research universe |

Synthetic templates have no caller request. They declare a
`template-default` `research-only` mandate over the complete fixture universe
so the historical reference benchmark remains explicit.

Requested assets are intentionally conservative authorization. Other dataset
assets may improve ranking, regime, style, or benchmark context, but they
cannot become positions or implicit hedges without caller intent.

If every requested asset supplies `positionRole`, Core normally uses the
explicit `asset-role` family rather than applying one sign permission to every
name. Roles are `long-only`, `short-only`, `two-sided`, and `context-only`.
One narrow identity-preserving exception applies: a `relative-value` request
with exactly two `two-sided` assets and any number of named `context-only`
assets remains the ordinary `dollar-neutral` / zero-net pair family. This lets
the caller name causal context without disabling the two-asset Factor
contrast. When both long- and short-capable assets exist, each side may use up
to half the gross limit; a single capable side may use the full gross limit.
Side limits are maximums, not forced allocations, and unused capacity remains
cash. Direction still describes the research question and must be compatible
with the explicit capabilities.

Direction-default benchmarks remain unchanged for requests without roles.
Explicit long/short requests use an equal-weight reference over only the
corresponding role-capable assets; two-sided/relative-value requests default
to cash. A caller benchmark continues to override only evaluation.

Optional strict `request.benchmarkPolicy` replaces only the evaluation
reference with cash, one named dataset-universe asset, or one funded
non-negative fixed-weight basket over requested assets. A benchmark leg may
be context-only; it does not change `tradableAssets`, position caps, signal
states, or construction family. The Mandate materializes source, kind, asset,
and one complete fixed weight vector. See
[[docs/design/caller-owned-benchmark-reference]].

The optional complete `request.portfolioPolicy` owns the numeric gross,
global fallback and named per-asset caps, volatility, cost, rebalance, and
reference-NAV assumptions, including the every-N-base-bars ordinary decision
cadence. If omitted, Core records `reference-default` and
values `1.0`, `0.30`, no named overrides, `0.15`, `10bps`, `0.05`, and
`1,000,000`, with an every-bar cadence. Candidate Agents cannot edit either
source. See
[[docs/design/caller-owned-portfolio-research-policy]] and
[[docs/design/caller-owned-asset-position-caps]], and
[[docs/design/caller-owned-decision-cadence]].

## Mechanical construction

All families share the same causal percentile, hysteresis, conviction,
inverse-volatility strength, caller-owned per-asset cap, one-sided covariance target risk
governor, drift, no-trade band, final executed-book risk compliance, and
next-bar accounting.

Directional families modify only permitted position state and budget:

- `long-cash` can enter, hold, and exit long intent; it never enters short;
- `short-cash` can enter, hold, and exit short intent; it never enters long;
- unused gross budget remains cash when signals or the per-asset cap cannot
  use it;
- context-only assets always have flat intent, zero target, and
  `allocation_status=context_only`.

The `asset-role` family selects that same state machine independently per
asset. Each active side is capped-water-filled only up to its fixed gross-side
limit. A missing or under-capacity hedge side does not flatten or resize the
other side and does not create a neutrality claim.

Dollar-neutral families require exact funded long and short sides under the
fixed gross/net/cap rules. Insufficient requested breadth remains flat and
fails the active-target audit visibly rather than changing exposure.

The daily accounting path records `cash_weight = 1 - gross_exposure`. This is
the unused research gross budget, not a Broker cash-balance claim.

## Governed RL

Every fixed factor action and factor mixture is first converted into a
complete stateful sleeve under the same Portfolio Mandate. RL selects among
those sleeves; it cannot:

- trade a context-only asset;
- take a sign forbidden by the request;
- change cash, gross, net, or cap semantics;
- substitute a different benchmark or benchmark weight;
- learn around a failed mandate constraint.

After RL selects a sleeve, the common accounting path drifts the prior book,
applies the ordinary no-trade decision, and then rechecks the actual chosen
book. A minimum proportional repair may override no-trade only to meet the
same ceiling. Portfolio and RL therefore make identical final-book decisions
for identical inputs.

The RL Study separately depends on `factors/**`, the Factor Population, and the
mandate. Program and Dossier compatibility compare the Factor subset of the
dependency closure to the Factor lane source, require one shared Factor
Population, and separately require Portfolio and RL mandate ids to match.

## Evidence projection

Successful Portfolio and RL Runs freeze the complete normalized mandate under
`metrics.portfolio_mandate`. Portfolio reports and decision ledgers also
record its identity and per-asset tradability.

Core projections expose:

- direction and construction family;
- role source, complete asset-role vector, and long/short gross-side limits;
- authorized and context-only assets;
- gross limit, per-asset cap, cash, short, and structured benchmark semantics;
- caller/default policy source, base cost, no-trade band, reference NAV, and
  accounting/capacity model identities;
- constraint errors for gross, net rule, opposite-sign exposure,
  context-only exposure, and maximum weight;
- current gross, net, and unused cash budget;
- final-book forecast coverage, pretrade breaches, risk-only rebalance
  overrides, executed breaches, and current execution reason;
- the exact fixed dependency hash.

CLI, Studio, lane Reports, and Project Dossiers consume those verified
objects. Studio may format the mandate and dim context-only rows, but it
cannot infer or alter a position permission.

## Identity and tamper behavior

For a request-driven Project, intake reconstructs the expected mandate from
the canonical request plus dataset universe on every load. A changed request,
asset partition, construction field, or derived id is invalid evidence.

The mandate's content-derived id is a readable join key, not a substitute for
the Study dependency file hash. Runs and Sessions retain the complete hash
inventory.

## Invariants

1. Research-universe membership does not imply position authorization.
2. Directional mandates never take the opposite sign and may retain cash.
3. Context-only assets always have zero target and executed exposure.
4. Relative-value and long-short evidence cannot silently relax zero net.
5. Portfolio and governed RL use the same exact mandate in one Project.
6. Candidate factor/model code cannot edit or choose the mandate.
7. Benchmarks follow the declared opportunity-cost question and never grant
   position authority.
8. Every surface discloses that weights are historical research evidence with
   no trading authority.
9. Historical implicit-neutral evidence remains loadable and labelled legacy.
10. Risk compliance has priority over the no-trade band and cannot increase
    exposure.
11. Portfolio and governed RL consume the same implementation policy.

## Known limits

- Named assets may be authorized for a hedge sign, but AutoQuant does not
  infer or guarantee beta, factor, sector, currency, duration, or delta
  neutrality.
- The request does not express borrow availability, futures margin, financing,
  group bounds, forced positions, or nonlinear impact.
- Cash is an unused-gross-budget field, not financing or collateral
  accounting.
- Position permissions are Project-local and do not represent OpenAlice
  account authorization.
