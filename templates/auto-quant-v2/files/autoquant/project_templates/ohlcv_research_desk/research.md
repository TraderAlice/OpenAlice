# Multi-Study Quantitative Research Desk

## Research brief and clarification

Before downloading data, editing research code, or running an evaluation,
rewrite the incoming assignment in this file as a bounded English research
brief. Make the decision to support, question, motivation, universe, horizon
or cadence, evidence, material constraints, evaluation meaning, expected
deliverable, assumptions, open questions, and proposed route explicit.

Use researcher judgment to choose and sequence Factor, Portfolio, and governed
RL work, but do not invent caller-owned intent. If an ambiguity could
materially change the research, record it here and ask the delegating Agent or
user. Repeat until the question is falsifiable and safe to bind into fixed
Study authority. The caller may use any language; English is the internal
working language of the AutoQuant desk.

## Purpose

Research one investment question through three distinct evidence lanes without
changing Project, request, universe, or dataset:

1. **Factor quality** — test whether a causal signal predicts forward returns
   across horizons, folds, regimes, assets, and style overlap.
2. **Portfolio quality** — test whether the same `factors/candidate.py`
   survives the request-bound tradable/context universe, direction, cash,
   mechanical signal state, sizing, causal covariance ceiling, constraints,
   drift, costs, risk, attribution, and a causal OHLCV liquidity-capacity
   envelope over the exact trade path.
3. **Governed RL policy** — bind the current candidate factor as a read-only
   sleeve and test whether a bounded adaptive state encoder adds value beyond
   that factor and fixed/contextual policies across every declared fold and
   seed.

Before selecting factor or Portfolio hypotheses, read the focused Study's
`candidateContract` from orientation or Study inspection. It states the
actual Project base interval, completed feature intervals, observation
semantics, and causal context visibility; do not infer column availability or
same-date cross-market availability from reusable template code.

## Working order

```bash
aq project program . --json
aq session start . --study ohlcv-factor-quality --request request.json --json
aq session start . --study ohlcv-portfolio-quality --request request.json --json
aq session start . --study ohlcv-rl-factor-policy --request request.json --json
```

For each lane, author its first caller-relevant candidate before Session start.
With no exact reusable baseline, Session start runs the fixed fast preflight
first and leaves no Run or Session on failure; a pass grants no selection
authority and only then permits the complete baseline. Use `session check` only
after a later worktree edit.

Factor and Portfolio Sessions edit the same source closure and must be
sequenced. Promote or stop one line of research before starting the other.

## Evidence boundary

The three lanes do not collapse into one score. A factor can predict but fail
after costs; a portfolio can be mechanically sound without proving a raw
factor claim; an RL policy can have high absolute Sharpe yet add no value over
a simple baseline.

All three lanes bind the same fixed
`strategies/factor-population.json`; Portfolio and governed RL separately bind
`strategies/portfolio-mandate.json`. For a request-bound `decision-signal`,
Factor uses caller-owned `factorPolicy.predictionAssets` as its evaluation
population while the complete research universe remains available as causal
input context. The Mandate independently owns position construction.
Novel-factor and known-style validation claims retain complete-universe
evaluation. Exactly one tradable asset selects temporal evaluation; exactly
two symmetric, two-sided, dollar-neutral assets select temporal
first-minus-second factor/return contrast evaluation; four or more select
cross-sectional evaluation. Three assets require explicit caller-owned
relative-basket contrast weights. Portfolio and RL may never turn context
assets into implicit positions, learn around the requested direction, or bypass the shared
scale-down-only target and final executed-book portfolio-volatility ceiling.
Risk may override no-trade only by reducing the chosen book; the same
primitive governs both lanes. The RL lane also content-locks the current
`factors/candidate.py` bytes. Promoting a different factor makes prior RL
evidence stale; create fresh RL evidence or start a new RL Session. Factor
writers and active RL readers are surfaced as a concurrency conflict.

AutoQuant produces quantitative decision support only. Target weights,
historical actions, and Reports are not Broker orders, account state, or
OpenAlice trading approval.

When the RL lane is present, inspect whether action sleeves persist coherently
or churn one bar at a time, then inspect exact chosen-versus-runner-up linear-Q
rationales. Q margins are uncalibrated and feature contributions are not causal
importance. This behavior evidence is contextual only and cannot override the
validation objective or promote an encoder.
