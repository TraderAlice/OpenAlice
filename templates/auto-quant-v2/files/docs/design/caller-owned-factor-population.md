# Caller-owned Factor population

Status: active pre-1.0 contract.

Related: [[docs/design/caller-owned-factor-outcomes]],
[[docs/design/ohlcv-factor-lab]],
[[docs/design/prediction-mode-target-weight-translation]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/cross-study-factor-dependencies]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/PROJECT_FORMAT]], and [[docs/CLI]].

## Purpose

Factor evaluation eligibility and Portfolio position eligibility are distinct
caller authorities. AutoQuant models them with distinct fixed contracts even
when one return-oriented request chooses the same assets for both.

```text
factorPolicy.predictionAssets
        ↓
strategies/factor-population.json ──► Factor evaluation only

assets[].positionRole + direction + Portfolio policy
        ↓
strategies/portfolio-mandate.json ──► historical target construction only
```

Neither contract grants Orders, Broker access, account authority, TPSL, or
live trading. A Factor Population also grants no Portfolio construction
authority. Portfolio and governed RL must bind their own Mandate and prove the
two contracts are compatible.

## Request contract

A new `decision-signal` request must explicitly name its prediction assets:

```json
{
  "factorPolicy": {
    "claim": "decision-signal",
    "knownStyle": null,
    "outcome": "forward-realized-volatility",
    "predictionAssets": ["NVDA"]
  }
}
```

Every symbol must appear exactly once in `request.assets`. Assets not selected
remain available as causal Factor context but never supply target observations
or fixed decision scores. Position roles are irrelevant to this Factor-only
partition and may be omitted when no Portfolio research is requested.

`novel-factor` and `known-style-validation` claims always evaluate the complete
Study research universe. They reject `predictionAssets`; narrowing such a
population would contradict the caller's factor-identity claim.

Core admits only:

- one decision-signal asset for temporal association;
- exactly two caller-ordered decision-signal assets with `direction:
  relative-value` and `outcome: forward-return`;
- four or more assets for cross-sectional association.

Three-asset baskets remain unsupported without caller-owned contrast weights.
A realized-volatility outcome has no two-asset relative-value meaning.

## Fixed manifest

Every new Factor Study binds:

```text
strategies/factor-population.json
```

The strict `autoquant-factor-population` records:

- source request/default identity and request hash;
- Factor claim and outcome;
- ordered research, prediction, and complementary context assets;
- `prediction` or `context-only` Factor role for every research asset;
- cross-sectional, single-asset temporal, or ordered two-asset evaluation
  mode and exact contrast when applicable;
- a content-derived id;
- `evaluationAuthority: factor-evaluation-only`;
- `portfolioAuthority: none` and `tradingAuthority: none`.

The manifest is not candidate-editable. Its bytes enter Study, Run, Session,
Report, and Explorer identity. New Run metrics retain one complete snake-case
projection under `metrics.prediction_universe`; read models independently
reconcile its universe, claim, outcome, roles, mode, and authority.

## Standalone Factor boundary

`ohlcv-factor-lab` writes and binds the Factor Claim, Factor Population, and
Horizon Mandate. It does not write `portfolio-mandate.json`. This remains true
for forward return: choosing a prediction population is not permission to
construct a book.

Observed-only V5/V6 intake obtains its exact temporal target and target clock
from `factorPolicy.predictionAssets`, not `assets[].positionRole`. It therefore
supports a risk-only Factor request with no fictional position permission.

## Portfolio and governed-RL compatibility

Portfolio and governed RL bind both contracts and require a forward-return
Factor outcome.

- A `decision-signal` Mandate's ordered `tradableAssets` must equal the Factor
  prediction assets.
- A complete-universe novel/known-style Factor may feed a Mandate whose
  tradable assets are a subset of that prediction universe.
- A two-asset relative-value population additionally requires a symmetric
  two-sided, zero-net dollar-neutral Mandate before target construction.
- Context-only Mandate assets remain flat even if a complete-universe factor
  evaluated them as prediction targets.

Factor qualification may gate whether downstream research is worth doing. It
does not mutate either fixed authority or automatically create a position.

## Historical evidence

Immutable Runs produced before this contract retain their original
`asset_position_roles` projection and Mandate-derived authority. Strict read
models may label that evidence as historical, but they never rewrite its
stored files or claim it used the current Factor Population. New Study
construction has no fallback from position roles to prediction assets.

## Invariants

1. Candidate code cannot choose, widen, or narrow its evaluation population.
2. Research-universe membership alone grants neither target nor position
   eligibility.
3. Factor context never contributes target observations or fixed decision
   scores.
4. Factor roles never encode long, short, leverage, cash, or benchmark meaning.
5. A Factor Population grants no Portfolio or trading authority.
6. Portfolio/RL position authority remains solely in the compatible Mandate.
7. Unsupported population meaning fails before Project construction.
8. CLI, schema discovery, Studio, Reports, and immutable Runs project the same
   contract.
