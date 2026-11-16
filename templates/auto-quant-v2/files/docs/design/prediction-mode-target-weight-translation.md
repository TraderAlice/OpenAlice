# Prediction-mode target-weight translation

Status: revised by the caller-owned Factor Population contract.

Related: [[docs/design/ohlcv-factor-lab]],
[[docs/design/caller-owned-factor-population]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/target-translation-robustness]], and
`plans/prediction-mode-target-weight-translation`.

## Decision

Factor, Portfolio, and governed RL resolve one prediction population from the
fixed Factor Claim and Factor Population. The latter grants evaluation only;
the separately fixed Portfolio Mandate alone grants historical target-weight
construction. Portfolio and governed RL bind both contracts and reject an
incompatible pair. Factor-only work binds no Mandate.

Factor-context assets may inform Agent-authored source, but the fixed Harness
never uses them as target observations or decision scores. Mandate-context
assets remain flat even when a complete-universe novel/known-style Factor
evaluated them as prediction targets.

The translation stops at historical target weights. It is not an Order,
Broker fill, TPSL plan, account instruction, probability, or live forecast.

## Modes

| Evaluation mode | Decision score | Availability | Context behavior |
| --- | --- | --- | --- |
| cross-sectional | same-timestamp percentile across prediction assets | at least four finite prediction assets and two distinct values | unavailable and flat |
| single-asset-temporal | target factor's causal empirical percentile | latest 60 observed target values, minimum 20 | unavailable and flat |
| two-asset-relative-value | causal percentile of caller-ordered `left - right` factor spread; right score is `1 - p` | latest 60 observed paired spreads, minimum 20 | unavailable and flat |

Portfolio then applies the existing fixed direction, hysteresis, inverse-risk
sizing, caps, cash, cadence, risk governor, drift, turnover, and cost rules.
The relative-value mode admits only the fixed symmetric two-sided
dollar-neutral pair; active pre-governor targets are opposite-sided, while
unused gross remains cash when per-asset caps prevent full funding.

## Evidence contract

Every new Portfolio and RL Study binds `strategies/factor-claim.json`,
`strategies/factor-population.json`, and
`strategies/portfolio-mandate.json` in addition to its other fixed
dependencies. RunResult and report artifacts carry the exact Factor claim,
prediction population, and signal-translation method.
Portfolio decision rows retain the raw factor, translation value, causal
observation count, translation score, evaluation mode, and final score after
risk availability.

The strict Explorers independently derive the prediction population and
translation contract. Portfolio additionally reconstructs the complete score
surface from the immutable decision ledger and rejects rehashed score, method,
population, pair-order, or context-role tampering. Studio renders the same
mode-specific semantics instead of describing every decision as a peer rank.

## Data boundary

This design does not introduce a reusable market-data inventory. The research
question still determines its complete task-specific snapshot under
[[docs/design/agent-native-market-data-acquisition]]. Repeated Project-local
bytes are acceptable when they preserve coherent source, interval, market
clock, adjustment, and content identity.

## Deliberate limits

- The ordinary 60/20 temporal window is fixed and is not tuned on validation
  or test. Its predeclared 40/60/120 context stress is defined in
  [[docs/design/target-translation-robustness]] and cannot select a window.
- Three-asset relative baskets remain unsupported without explicit
  caller-owned contrast weights.
- Context influence inside editable factor source must be diagnosed as factor
  construction; it cannot be smuggled into fixed target translation.
- Old immutable Runs retain their original Harness semantics and identity.
