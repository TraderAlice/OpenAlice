# Order-native portfolio decisions

Status: active design.

Related: [[docs/design/quant-research-lifecycle]],
[[docs/design/agent-native-quant-workbench]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Product question

When a local operator or collaborating Agent asks the quantitative workbench
for help, AutoQuant must answer more than “this factor predicts returns.”

It must show:

1. what causal evidence supports or contradicts the thesis;
2. what target weight each asset should receive inside the whole portfolio;
3. why that size fits conviction, volatility, correlation, concentration,
   liquidity, and loss-at-stop budgets;
4. how an Agent that wakes only once per hour could leave the intended entry
   and protective exits working between decisions;
5. what a later live-trading authority must recheck before acting.

The answer is quantitative decision support. A standalone reviewer may stop at
the research artifact. When OpenAlice is the host, it remains the owner of
authenticated account state, human approval, and live execution through UTA.

## Continuous but separable layers

```text
rule / statistical / ML / RL factor representation
→ FactorState
→ mechanical / optimized / RL portfolio policy
→ TargetPortfolio
→ DecisionPlan
→ fixed bar Order/TPSL execution
→ ActualPortfolio + ExecutionEvidence
→ Report / Dossier
→ local or collaborating-Agent review
→ optional external stage → approval → execution
```

“Separable” does not mean breaking the economic chain. Factor state must flow
into target weights, because target weights answer how much portfolio capital
the thesis deserves. The boundary exists so evidence can identify whether a
result came from prediction, portfolio construction, order realization, or
protective-exit behavior.

## FactorState

FactorState is information available at one decision timestamp:

- value, direction, rank, strength, and coverage;
- forecast or holding horizon;
- causal market/regime context;
- uncertainty and explicit invalidation diagnostics;
- exact factor/model identity and input timestamp.

Hand-written factors, statistical estimates, supervised models, and RL-learned
representations may all produce FactorState. They face the same chronological,
holdout, stability, and attribution burden.

RL is not removed or demoted. It may:

- learn a compressed causal market representation that is evaluated as a
  factor/model;
- learn a constrained portfolio/decision policy over FactorState;
- select or mix governed factor sleeves as the current reference lane does.

RL may not alter data timing, order fills, fees, Mandate permissions, or the
evaluation split from inside candidate code.

## TargetPortfolio

TargetPortfolio is the desired post-decision portfolio, not an order:

- complete per-asset target weights and target cash;
- target gross/net exposure;
- current-to-target weight deltas;
- per-asset cap and position-role evidence;
- causal own volatility and portfolio covariance contribution;
- concentration, liquidity, and risk-governor scale;
- stop distance and loss-at-stop contribution when protection is proposed.

A useful position-size explanation is:

```text
factor conviction
→ volatility/correlation-aware raw allocation
→ per-asset/gross/side/concentration constraints
→ stop/invalidation distance and loss-at-stop budget
→ final target weight
```

Neither volatility sizing alone nor a stop distance alone owns the answer.
The fixed policy must disclose every binding transform.

## DecisionPlan

DecisionPlan binds one decision timestamp to:

- the exact FactorState and Portfolio Mandate;
- the observed or simulated pre-decision portfolio;
- the complete TargetPortfolio;
- one or more research `OrderIntent` objects that attempt to realize its
  deltas;
- protection and expiry rules;
- plan horizon and next required review timestamp;
- assumptions, unresolved ambiguities, and `tradingAuthority: none`.

Research sizing is expressed in target weights and reference NAV. A later
execution authority may resolve an approved plan against current equity,
positions, quotes, contract increments, buying power, and venue capabilities.
An OpenAlice/UTA adapter may represent the result as decimal-string
`totalQuantity` or `cashQty`. AutoQuant never claims that translation or
staging already happened.

## OrderIntent

The semantic vocabulary uses common order concepts and deliberately remains
compatible with OpenAlice UTA where practical:

- side: buy or sell;
- type: market, limit, stop, or stop-limit;
- requested weight/notional and resulting target weight;
- limit and/or stop trigger;
- activation time, time in force, and expiry;
- parent id and OCO group;
- reduce-only protection;
- optional take-profit and stop-loss child specifications.

The first kernel does not need trailing, MOC, OPG, FOK, routing, or
venue-specific extensions before the core lifecycle is correct.

OpenAlice currently exposes MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, and
MOC plus DAY/GTC/IOC/FOK/OPG/GTD and attached TP/SL. Attached bracket support
is venue-dependent and UTA loudly refuses unsupported mappings rather than
silently dropping protection:
<https://www.openalice.ai/docs/trading/orders-and-execution>.

AutoQuant should preserve this refusal principle. A deliverable can say which
semantics were researched; any live authority must revalidate whether its
selected venue can realize them.

## Fixed bar execution

Decisions formed at close `t` become active no earlier than the next eligible
bar. The kernel processes complete OHLCV bars and publishes every state
transition:

```text
planned → working → triggered → filled
                     ↘ expired / cancelled / rejected
```

For a fully working order:

- market fills at the next eligible open;
- a buy limit gapped below its price receives the open, otherwise fills at the
  limit when the low reaches it;
- a sell limit gapped above its price receives the open, otherwise fills at
  the limit when the high reaches it;
- a sell stop gapped below its trigger receives the open, otherwise becomes a
  market fill at the trigger when the low reaches it;
- a buy stop is symmetric;
- stop-limit records trigger and limit-fill state separately and may remain
  working after a gap through the limit.

These are explicit research assumptions, not exchange fill claims.

## Bracket TPSL

Protective children are sized from the parent's actual filled quantity, never
its requested quantity. A TP/SL child cannot create or reverse a position.

- parent fill activates its children;
- take profit is a reduce-only limit;
- stop loss is a reduce-only stop-market or stop-limit;
- TP and SL share OCO: one fill cancels the sibling;
- partial parent fills protect only the filled portion;
- expiry/cancellation and every unprotected interval remain explicit.

Gap-through-stop fills at the first eligible open rather than the stale stop
price. This is essential for session markets.

## Intrabar ambiguity

One OHLC bar does not reveal whether high or low occurred first. Ambiguity
appears when:

- both TP and SL are reachable in one bar;
- an intrabar parent entry and one or both children are reachable;
- a stop-limit trigger and fill depend on an unknown path;
- multiple working orders compete for the same reducible position.

Candidate code may never choose the favorable path. The first kernel will
evaluate deterministic canonical paths consistent with the bar and make a
fixed conservative path authoritative. It also records an optimistic
diagnostic bound and the ambiguity rate. Promotion uses the conservative
result only.

## Portfolio feedback loop

The actual filled portfolio, not the old target, is the next decision's state.

```text
pretrade actual weights
→ target weights
→ working orders
→ fills and protected quantity
→ returns, costs, exits, and drift
→ next actual weights
```

Unfilled target delta remains intent, not exposure. If a parent fills only
half, portfolio accounting and protection both use only that half.

## Evidence expected by a working quant researcher

### Prediction and portfolio

- existing IC, decay, quantile, stability, return, drawdown, beta, tracking,
  turnover, concentration, capacity, and selection-risk evidence;
- target-weight attribution by factor conviction, volatility, covariance,
  caps, side limits, and stop-risk budget.

### Trade and protection

- fill rate, expiry/cancel rate, bars-to-fill, and unfilled opportunity cost;
- TP, SL, signal, time, and rebalance exit shares;
- hit rate, payoff ratio, expectancy, profit factor, holding bars, MFE/MAE;
- gap-through-stop count and loss beyond planned stop;
- same-bar ambiguity rate and conservative/optimistic outcome spread;
- requested, filled, protected, and unprotected quantity reconciliation.

### Portfolio risk

- risk-at-stop by asset and total portfolio;
- maximum simultaneous stop loss under the declared reference NAV;
- actual versus target weight tracking error;
- post-fill gross/net/cash, covariance forecast, and risk repair;
- behavior by asset, direction, regime, fold, and decision policy.

### RL

- the existing fold/seed/baseline and causal state evidence;
- representation value versus simple factor baselines;
- decision-policy value versus the same mechanical target/order policy;
- action stability, target churn, order churn, fill behavior, and protection
  outcomes;
- no claim of RL value unless it survives cost, execution, risk, and
  validation breadth.

## Caller context and delivery

A useful future request can optionally carry a caller-observed portfolio
context:

- as-of timestamp and reference currency;
- current position weights, cash, and relevant pending-order summaries;
- risk budget and decision cadence;
- optional venue/order capabilities supplied by a caller;
- requested deliverables and decision deadline.

This context is caller-supplied and content-locked, not authenticated by
AutoQuant.

The durable DecisionPlan, Report, or Dossier should contain:

- evidence-backed target portfolio;
- exact sizing explanation and binding constraints;
- conditional order template and TPSL/invalidation tree;
- expected loss-at-stop and portfolio impact;
- historical fill/protection/ambiguity evidence;
- conditions requiring a fresh quote, UTA snapshot, or human review;
- `tradingAuthority: none`.

A live-trading system remains responsible for resolving quantities, validating
venue support, obtaining approval, submitting, reconciling fills, and
monitoring orders. In an OpenAlice-hosted desk those responsibilities map to
its stage → commit → approval → push workflow and UTA.

## Breaking-change policy

AutoQuant V2 is pre-alpha. The order-native contract replaces implicit
close-target execution rather than preserving a parallel compatibility path.
Existing source history remains in Git; current schemas and evidence describe
only the new truth after migration.

## Invariants

1. Factor → target weight remains explicit and causally reproducible.
2. Target weight is desired portfolio state; a fill is actual portfolio state.
3. Protective quantity never exceeds actual open quantity.
4. Same-bar ambiguity never selects a candidate-favorable path for promotion.
5. Every RL and mechanical policy uses the same fixed execution semantics.
6. Order evidence never claims external staging, approval, submission, or live
   fill.
7. Any live authority revalidates account, quote, contract, and venue
   capability before action.
