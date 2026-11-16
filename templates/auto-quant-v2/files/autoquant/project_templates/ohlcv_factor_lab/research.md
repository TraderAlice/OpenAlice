# OHLCV Factor Lab

## Research brief and clarification

Before downloading data, editing `factors/candidate.py`, or running an
evaluation, rewrite the incoming assignment in this file as a bounded English
research brief. Make the decision to support, question, motivation, universe,
horizon, evidence, material constraints, evaluation meaning, expected
deliverable, assumptions, open questions, and proposed route explicit.

Use researcher judgment for factor design and diagnostics, but do not invent
caller-owned intent. If an ambiguity could materially change the research,
record it here and ask the delegating Agent or user. Repeat until the question
is falsifiable and safe to bind into fixed Study authority. The caller may use
any language; English is the internal working language of the AutoQuant desk.

This Project is a self-contained construction site for causal, vectorized
factor research on local OHLCV data. The checked-in construction recipe
generates a small deterministic synthetic fixture; it is a Harness benchmark,
not evidence about real markets.

## Workbench contract

- The Agent edits only `factors/candidate.py`.
- The fixed Study is `ohlcv-factor-quality`.
- `strategies/factor-claim.json` binds the prediction outcome. New delegated
  requests should state `factorPolicy.outcome` as `forward-return` or
  `forward-realized-volatility`; historical omission means forward return.
- `strategies/factor-population.json` fixes prediction versus context assets
  and grants Factor evaluation only. This standalone Lab does not create a
  Portfolio Mandate or position-construction authority.
- The fixed Judge reads the immutable Horizon Mandate and computes
  purge-aware primary/diagnostic outcome panels, chronological splits,
  HAC/decay/tertile/style/stability diagnostics, a train-selected
  style-neutral qualification funnel, optional candidate-declared component
  quality/redundancy/fixed-blend ablation, and the causality audit.
- Dataset bytes under `data/ohlcv/**` participate in Study and Run identity.
- A V4 intake may supply an observed-only ragged daily panel. Missing and
  pre-listing asset/timestamp rows remain absent; the Run and Factor Explorer
  expose input, finite-factor, and forward-target-pair availability.
- A V5 intake may supply one close-time-aware observed base-bar panel through
  `1d`, potentially with mixed asset classes, and with
  exactly one `factorPolicy.predictionAssets` temporal target. Market closures stay absent;
  target horizons and purge boundaries advance only on that asset's observed
  completed bars. Context-only assets never contribute target observations.
  Candidate code must explicitly backward-as-of any asynchronous context and
  may use only rows whose close timestamp is no later than the target close.
- A `known-style-validation` intake seeds `factors/candidate.py` from the exact
  requested style before Study identity is created. Inspect it, but do not
  replace it with the generic exploratory baseline.
- A `decision-signal` intake is appropriate for an allocation, ranking, or
  timing question that needs robust raw predictive evidence without claiming
  novelty. Style overlap remains required disclosure.
- `forward-realized-volatility` means the unannualized square root of summed
  squared close-to-close log returns over the next fixed `h` observed base
  bars. A higher factor predicts higher future risk. It is Factor-only and
  grants no expected-return, target-weight, Portfolio, RL, or trading meaning.
- Every candidate is evaluated through `aq experiment evaluate`; never call the
  Judge directly or optimize against the test target outside that contract.
- Quantitative evidence describes historical behavior. It is not an order,
  Broker integration, or live-trading instruction.

Successful declaring Runs include a complete JSON tear sheet plus exact daily
IC/regime, quantile-outcome, observed-input availability,
candidate/style/residual/blend qualification, and candidate-declared component
artifacts.
Use `aq run factor --run <id> --json` and Studio for the verified summary; read
artifacts when a conclusion depends on a specific date or slice.

## First commands

For a real incoming assignment, this scaffold candidate only demonstrates the
API. Do not execute it as the caller's baseline. Complete this brief and
intake, inspect the contract, author the first predeclared caller-relevant
candidate before any evaluation, and let `session start` create or reuse its
baseline Run. On a fresh candidate it runs the fixed fast preflight first; a
failure creates no Run or Session, while a pass only permits the complete
baseline and grants no selection authority. Do not run `session check` until a
later worktree edit. Once any Run's test audit is visible, a later source edit
cannot be described as test-blind and requires fresh external holdout evidence
for a new production-grade claim.

```bash
aq orient . --json
aq study inspect . --study ohlcv-factor-quality --json
aq session start . --study ohlcv-factor-quality --request request.json --json
```
