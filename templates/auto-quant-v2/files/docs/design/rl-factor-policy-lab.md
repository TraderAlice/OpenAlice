# Governed RL factor-policy laboratory

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/rl-factor-opportunity-audit]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the first reinforcement-learning reference Project:
causal state, a content-locked candidate factor plus fixed reference actions,
chronological transitions, reward, training budget, seeds, folds, baselines,
model evidence, and the candidate authority boundary.

It does not own live orders, Broker/UTA state, an unconstrained RL framework,
distributed training, hyperparameter sweeps, or a claim that RL is preferable
to a simple policy.

## Research question

The falsifiable question is:

> Can a small policy use causal regime and expert-history features to choose
> among fixed factor mixtures, and improve validation portfolio evidence over
> policies that do not adapt?

RL is evaluated as one model family among baselines. It receives no privileged
acceptance rule.

## Candidate boundary

The Agent edits `models/candidate.py`, which exports:

```python
FEATURE_NAMES = [...]

def encode_state(state: dict[str, float]) -> list[float]:
    ...
```

The fixed Judge passes one timestamp's declared causal state as scalar values.
The encoder must be deterministic, pure, finite, length-preserving, and bounded.
It never receives a panel, future row, reward array, fold labels, test data,
action targets, or portfolio returns. Calling it twice on an unchanged state
must produce the same vector without mutating input.

The candidate may select, transform, and interact fixed causal inputs. It
cannot change:

- factor experts or mixture actions;
- target construction, drift, no-trade threshold, costs, or benchmark;
- Q-learning, exploration schedule, learning rate, discount, or episodes;
- reward timing or risk penalty;
- chronological folds, seeds, baselines, metrics, or objective.

This is a replaceable representation surface, not arbitrary training code.

The Study separately declares `factors/**` and
`strategies/portfolio-mandate.json` as fixed dependency closures. Their bytes
are included in Study/Run/Session identity but not in the editable model
source hash. The RL Judge imports the factor only after independently verifying
the pandas Series contract, input immutability, determinism, numeric alignment,
and prefix causality. It validates and applies the same exact mandate as the
Portfolio lane. A changed factor or mandate makes existing RL evidence stale.

## Fixed environment

The synthetic six-asset fixture alternates two persistent regimes. At close
`t`, both current-bar intraday strength and relative activity are observable.
The next close return is generated from the factor selected by the current
regime plus noise. A market-wide volume level exposes a causal but imperfect
regime feature. The fixture exists only to prove the Harness can distinguish a
state-aware policy; it is not market evidence.

Four factor experts are derived causally:

- `candidate`: the exact content-locked Factor Study candidate;
- `activity`: per-asset relative volume;
- `intraday`: current close relative to current open;
- `reversal`: negative prior close return.

The fixed discrete actions are `candidate`, `activity`, `intraday`, `reversal`,
and `balanced`. Each action becomes a complete causal signal sleeve: a factor
panel or equal blend enters the fixed percentile/hysteresis state machine and
is converted by the portfolio Core into request-permitted
inverse-volatility-conviction targets. Each sleeve maintains its own causal
intent history and shares the exact tradable/context assets, direction, cash,
gross/net, cap, benchmark, one-sided covariance volatility ceiling, base cost,
no-trade band, and reference NAV. RL
selects among those governed sleeves; it cannot alter entry/exit thresholds,
sizing, risk scale, constraints, or costs.
After drift and no-trade selection, the shared execution primitive rechecks
the selected final sleeve and applies only the proportional scale-down needed
for the same ceiling. This step runs during training, baselines, validation,
and test.
See
[[docs/design/signal-policy-and-attribution]] and
[[docs/design/portfolio-risk-governor]].

## State, transition, and reward

At decision close `t`, the raw state contains:

- causal market volume-regime level;
- trailing market return and realized volatility;
- trailing realized gross reward for each expert;
- the exact drifted pretrade book's gross/net/cash, maximum weight, and
  concentration summaries;
- one-way distance from that pretrade book to every governed sleeve target;
- one-hot previous action.

The action selected at close `t` proposes its fixed target weights. The prior
book is first drifted through the return ending at `t`; the no-trade rule and
trade cost are then applied. The selected book earns only close `t` to close
`t+1`.

```text
reward(t)
= net_portfolio_return(t→t+1)
- 0.10 × gross_portfolio_return(t→t+1)^2
```

Net return already includes full traded-notional cost at the Portfolio
Mandate's base cost. The quadratic term is a fixed local risk penalty;
candidate code cannot rescale or remove it. Rewards, targets, actions, and
next states are finite or the seed is recorded as failed.

## Training and evaluation

V1 uses a fixed linear Q approximator:

```text
Q(state, action) = weight[action] · encoded_state
```

It trains chronologically with epsilon-greedy Q-learning for 12 episodes,
learning rate `0.02`, discount `0.30`, and epsilon `0.15 → 0.01`. These
Harness-owned values were selected once from five predeclared configurations
using only a 70/30 blocked tail inside each reference outer-train interval.
The lexicographic development criterion maximized worst-seed and mean
advantage versus a train-fit contextual ridge, then minimized within-fold seed
dispersion and pairwise action mismatch. The configuration was frozen before
outer validation; each Study Run does not retune it.

Three declared seeds are always run. No seed is dropped because it performs
poorly; any failed declared fold/seed trial fails the Run with structured trial
evidence.

The fixed learner and train-only baselines pre-extract the immutable panel,
targets, decision schedule, mandate constraints, and covariance cache into an
exact array accounting path. This path preserves chronological drift,
schedule eligibility, mandate repair, risk-only override, cost, reward, and
pretrade state while avoiding pandas evidence objects that training never
publishes. Fixed-policy training Sharpe and contextual-ridge labels use the
same train-only primitive. Validation and test continue through the complete
governed rollout and immutable evidence path. Regression tests require exact
actions, states, returns, rewards, and opportunity labels between both paths.

Two expanding folds are fixed:

```text
fold 1: train → validation → test
fold 2: expanded train → validation → final test
```

Training updates occur only inside each fold's train interval. Validation and
test rollouts are deterministic and update no parameter. The Study objective,
`validation_mean_net_sharpe`, aggregates every declared seed and validation
fold. A Run with any failed trial cannot publish a successful objective. Test
metrics never enter promotion.

Test values are nevertheless visible evidence. Repeatedly changing a candidate
after inspecting them turns those dates into de facto validation data. Reports
must disclose this limitation; a production claim requires a new externally
held-out period or dataset. V1 enforces algorithmic split isolation, not
organizational blindness.

## Baselines

Every fold evaluates:

- each fixed factor expert;
- the equal factor blend;
- the best fixed expert selected using training dates only;
- a deterministic contextual ridge policy trained on the same training dates.
  It starts from the balanced train path, labels every action from the same
  timestamp/pretrade book, rolls out the fitted policy to regenerate its
  behavior path, and repeats for four fixed train-only iterations.

RL evidence reports validation/test advantage against both the best declared
baseline and the candidate factor by itself, plus candidate-action frequency.
Positive RL score alone is not evidence that RL added value.

## Evidence and artifacts

Run metrics contain:

- every fold and seed, including failures;
- validation/test net performance, implementation, action frequency, and
  cumulative reward;
- mean, standard deviation, minimum, and failure rate across seeds/folds;
- every baseline, RL-minus-best-baseline, RL-minus-candidate-factor, and
  candidate-action-frequency comparison;
- reward, timing, action, fold, seed, and training-budget configuration.
- the complete fixed Portfolio Mandate and a constraint audit for every action
  sleeve, including its per-asset sign roles and long/short gross-side limits.

Successful Runs declare:

- `rl-report.json`: complete assumptions, aggregate evidence, and warnings;
- `policy-models.json`: exact feature names and learned weights by fold/seed;
- `training-history.json`: episode reward histories for every trained model;
- `policy-actions.csv`: timestamped validation/test actions and accounting.
  Each row also records pretrade/final risk forecasts, ceiling, coverage,
  risk-only override, and execution reason.
- `policy-rationales.json`: exact validation/test causal state, encoded
  features, all frozen Q scores, deterministic runner-up, chosen margin, and
  exact per-feature chosen-minus-runner linear contribution.
- `policy-opportunities.json`: every validation/test action sleeve evaluated
  for one bar from the selected policy path's exact shared pretrade book,
  including proposed/executed weights, trades, next returns, reward, local
  oracle rank/regret, and candidate-factor opportunity. On a date when the
  caller's decision schedule forbids an ordinary rebalance, all actions share
  one executed book by definition: the artifact stores that execution once
  beside each sleeve's distinct proposed target. Decision-eligible dates retain
  every complete counterfactual execution. The Explorer reconstructs and
  reconciles the same full action evidence before projection.
- `policy-incremental-attribution.json`: the RL path paired with each fold's
  validation-selected mechanical baseline, including exact gross edge,
  incremental cost, net active return, market-state/action buckets, and
  per-asset gross contribution.

NumPy and pandas versions are recorded. Artifacts are immutable Run evidence.

Core joins these separately verified artifacts into a versioned
`factorFusionDiagnosis` projection. The projection preserves two different
counterfactual scopes:

- candidate and local-opportunity evidence starts from the actual policy
  pretrade book, evaluates only the next bar, and is an ex-post audit;
- adaptive transmission compares independently rolled complete policy and
  validation-selected baseline paths, including their own holdings, drift,
  no-trade decisions, risk repair, turnover, and costs.

The validation projection diagnoses the first demonstrated failure across
candidate sleeve quality, local candidate capture, adaptive gross selection,
implementation cost, risk-adjusted advantage, and fold/seed breadth. Test is
rendered beside it as visible audit only and never changes the stage or next
research focus. Report and Project Dossier freeze the exact projection and
hash from the immutable leader Run.

The reference Study keeps a 120-second hard Judge timeout. The clean AutoQuant
`0.8.6` release replay of a real nine-asset, 4,922-session calendar-month Study
with two folds, three seeds, 12 episodes, all baselines, and complete
validation/test evidence finishes in 88.9 seconds on the reference development
host. Its schedule-aware opportunity artifact is 25 MiB rather than 92 MiB and
passes the unchanged 32 MiB bounded-reader limit. The scientific workload and
evidence rows are unchanged; this bound is not permission for a longer
training job.

## Studio projection

Studio may project validation score, test mean, seed/fold dispersion, baseline
advantage, candidate-factor advantage, candidate usage, failure rate, and the
factor-fusion diagnosis from verified Run metrics. The diagnosis must show
candidate sleeve, local capture, full-path gross selection, incremental cost,
stable net value, validation loss locators, and separately labelled test audit.
Studio must preserve the full Run as authority. It cannot train, select a seed,
promote a policy, hide a failed seed, or turn a local oracle into a strategy.

## Invariants

1. State at `t` contains nothing learned after close `t`.
2. Reward for action `t` begins after close `t`.
3. Candidate model code never owns actions, reward, portfolio accounting,
   factor dependency, seeds, folds, budgets, baselines, or acceptance.
4. Every declared seed and fold is represented in success or failure evidence.
5. Validation alone determines the Study objective.
6. Test inspection is disclosed and never described as a permanently untouched
   result after iterative use.
7. Every action sleeve obeys the exact fixed Portfolio Mandate.
8. RL target weights are research evidence and have no trading authority.
9. Every final post-drift book is checked by the shared execution-risk
   primitive; a risk-only repair may override the no-trade band but may never
   scale exposure up.
10. The complete fixture and training campaign remain deterministic and bounded.
11. Every training, baseline, validation, and test action path enforces risk on
    the post-drift final book through the shared Portfolio Core primitive.
12. Action runs are bounded by fold, seed, and split; rationale rows exactly
    reconcile action chronology and frozen model weights.
13. Q margin is uncalibrated, linear contribution is not causal importance,
    action-conditioned outcomes are endogenous, and none has trading authority.
14. One-step opportunity rows share the actual policy pretrade book, never
    propagate alternate paths, and treat ex-post oracle reward only as a
    context-only audit upper bound.
15. The policy state includes the actual drifted pretrade execution context;
    Q next state is built from the executed current book, not only the action
    name.
16. Contextual-baseline action labels share one train-only pretrade path per
    iteration; validation/test opportunity evidence never enters fitting.
17. Full-path incremental attribution compares independently rolled books;
    gross edge minus incremental cost equals net active return and per-asset
    active contribution equals gross edge at every timestamp.
18. Factor-fusion diagnosis is validation-only research prioritization. It
    preserves local one-step and independent full-path semantics, exposes test
    only as visible audit, and grants no selection, KEEP/REVERT, promotion,
    order, account, or trading authority.
19. Schedule-held dates preserve one actual executed book and reward across
    all proposed actions; compact storage may share that execution only after
    exact equality is established, while decision-eligible counterfactuals
    remain complete.

## Change checklist

- State the timestamp of every new feature.
- Prove encoder purity and finite bounds.
- Keep reward and accounting in the fixed Judge closure.
- Preserve all seeds, folds, failures, and baseline comparisons.
- Save exact models/configuration, not only aggregate metrics.
- Update template discovery, CLI next actions, Studio, docs, wheel checks, and
  known-improvement/failure tests together.

## Known gaps

- V1 uses one fixed discrete-action linear Q learner, not continuous actions or
  deep RL.
- The synthetic regime is intentionally learnable and not financial evidence.
- Test visibility cannot enforce organizational blindness.
- Reward has a local quadratic risk penalty but no path-dependent drawdown,
  borrow, funding, or nonlinear impact term.
- Statistical confidence remains limited by two small folds and three seeds.
  Core records the complete research-family trial count but deliberately marks
  single-path DSR unsupported because the objective aggregates dependent
  fold/seed paths.
