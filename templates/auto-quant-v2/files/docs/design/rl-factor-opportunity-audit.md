# Governed RL factor opportunity audit

Status: V1 implemented.

Related: [[docs/design/rl-factor-policy-lab]],
[[docs/design/rl-policy-behavior-rationale]],
[[docs/design/rl-policy-evidence-explorer]],
[[docs/design/request-bound-portfolio-mandates]], and
[[docs/design/quant-research-lifecycle]].

## Research question

For each frozen validation/test policy decision:

> Starting from the exact book the selected policy actually carried into this
> timestamp, what would each already-governed factor sleeve have earned over
> the same next bar after the same no-trade, risk, and cost rules?

This is local action-opportunity evidence. It complements two existing but
different views:

- Q rationale explains why the frozen model scored one sleeve above another.
- Fixed-sleeve baselines show complete multi-step paths that continuously hold
  one sleeve.

Neither answers the local question because selected-action outcome conditioning
is endogenous and fixed-sleeve paths arrive with different pretrade books.

## Counterfactual unit

At each validation/test timestamp `t`, the Judge reconstructs the policy's
actual pretrade book:

```text
actual executed book at t-1
  → drift through return ending at t
  → actual pretrade book at t
```

From that one shared pretrade book, it evaluates every fixed action:

```text
candidate | activity | intraday | reversal | balanced
  → action's already-fixed proposed target at t
  → identical post-drift no-trade and volatility-risk compliance
  → exact executed counterfactual book and trade
  → close t to close t+1 gross return
  → identical Portfolio Mandate base cost and fixed reward
```

Each alternative ends after that next bar. It does not replace the policy book
at `t`, change the next state, or propagate an alternate path. The next
timestamp again starts from the actual selected policy history. Consequently,
the evidence isolates one local sleeve decision while preserving realistic
turnover and execution context.

## Preserved evidence

`policy-opportunities.json` is an immutable successful-Run artifact. Its
identity binds the Run input hash, fixed method, actions, assets, reward, and
authority policy. Every fold/seed/split/timestamp row preserves:

- selected action, ex-post one-step oracle action, selected rank, oracle hit,
  selected reward, oracle reward, and non-negative realized regret;
- the shared actual pretrade weights and known next-bar asset returns;
- for every action: proposed weights, executed weights, exact trade vector,
  gross/net return, reward, turnover, cost, gross/net exposure, execution
  reason, risk status, and risk-only override;
- candidate-minus-selected and candidate-minus-balanced reward differences.

When the caller's fixed schedule marks a timestamp ineligible for ordinary
rebalancing, all proposed sleeves necessarily share the same held executed
book, trades, cost, risk status, return, and reward. The immutable artifact
stores that execution object once as `sharedExecution` while preserving each
action's distinct `proposedWeights`. On decision-eligible timestamps,
`sharedExecution` is null and every action retains its complete execution
object. Public reconstruction expands both forms into the same five-action
evidence and verifies all vector, accounting, rank, and selected-path
identities.

The selected action's executed weights, trades, return, reward, turnover, cost,
and execution state exactly match `policy-actions.csv` and the actual rollout.
Public reconstruction verifies vector and accounting identities rather than
trusting the summary.

## Summary semantics

Validation and test are summarized independently across every declared
fold/seed path:

- decisions and trial paths;
- selected oracle-hit rate and mean selected rank;
- total/mean/median/p90 and positive-regret rate;
- mean oracle and selected reward;
- oracle-action frequency;
- candidate selected frequency, oracle frequency, missed-opportunity rate, and
  mean candidate-minus-selected reward;
- candidate-versus-balanced win rate and mean reward difference;
- action-level selected count, oracle count, mean local reward, turnover, cost,
  and risk-repair rate;
- exact reconciliation errors and pass/fail status.

Ranks use deterministic fixed action order for exact reward ties. Regret is
`oracleReward - selectedReward` and may be zero. Metrics are aggregated
descriptive evidence over dependent fold/seed paths; they are not statistical
confidence intervals or causal effects.

## Authority boundary

The artifact declares:

```text
method              = actual-pretrade-one-step-governed-action-audit-v1
path propagation    = selected-policy-only
oracle role         = ex-post-audit-upper-bound
selection authority = context-only
trading authority   = none
```

Opportunity evidence:

- from validation/test cannot enter training, state, reward, Q values,
  baselines, or policy action;
- cannot change validation objective, KEEP/REVERT, Session dominance, or
  report disposition;
- cannot recommend deploying the oracle or claim the oracle return was
  attainable without hindsight;
- keeps visible-diagnostic test separate and retains the external-holdout rule;
- remains target-weight research with no Broker, UTA, or order authority.

The fixed contextual baseline may use the same same-pretrade execution
primitive on the fold's train dates. Those train-only labels are regenerated
from its declared behavior path and are not the immutable validation/test
opportunity artifact described here.

The separate [[docs/design/rl-incremental-value-attribution]] compares the
selected RL and mechanical policies as independent full paths. It is the
correct evidence for cumulative active return, cost, regime, action-pair, and
asset contribution questions; this one-step audit remains the correct
evidence for local action rank and regret.

## Public surfaces

The strict RL Explorer is the canonical reader. It rehashes the artifact,
checks exact identity and chronology, verifies every vector/accounting
identity, reconciles the selected action ledger, reconstructs summaries, and
returns bounded representative decisions.

CLI, Reports, Dossiers, the Session decision matrix, and Studio consume that
projection. Studio should show:

- selected versus oracle one-step reward and regret;
- selected/oracle action mix;
- candidate selected, locally best, and missed-opportunity rates;
- candidate-versus-balanced local edge;
- representative high-regret decisions with all five governed alternatives.

All copy must use “one-step”, “local”, and “ex-post audit”. A generic “AI
confidence”, “optimal factor”, or “oracle strategy” label violates this
contract.

## Invariants

1. Every action at one timestamp starts from byte-for-byte equivalent actual
   pretrade weights.
2. The selected alternative exactly reproduces the actual rollout.
3. All alternatives use the same fixed action targets, next-bar returns,
   costs, no-trade rule, mandate, and execution-risk primitive.
4. No alternate book affects a later timestamp.
5. Every declared action is present exactly once per decision.
6. Validation and test chronology never cross fold/seed/split boundaries.
7. Oracle ties are deterministic and regret is finite and non-negative within
   numeric tolerance.
8. Candidate opportunity is descriptive local evidence, not causal factor
   importance or promotion authority.
9. The complete audit is deterministic, bounded, immutable, and readable by a
   fresh installed AutoQuant package.

## Known limitations

- One-step reward does not measure the value of committing to a sleeve for
  multiple bars or the effect of alternate holdings on later turnover.
- The best action is known only after the next bar and is therefore not
  executable information at decision time.
- Five fixed sleeves do not span every possible factor combination.
- The reward remains a local quadratic-risk approximation and the OHLCV
  execution model excludes nonlinear impact, borrow, and funding.
- Fold/seed observations are dependent; high oracle headroom does not prove a
  learnable policy can capture it.
