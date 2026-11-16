# RL policy behavior and decision rationale

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/cross-study-factor-dependencies]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns exact governed-RL action persistence and the linear
chosen-versus-runner-up decision decomposition. It does not own the candidate
encoder, factor sleeves, Q-learning algorithm, reward, folds, seeds, portfolio
accounting, or candidate selection.

## Decision rationale

For each validation/test timestamp inside one fold and seed, the fixed Judge
reconstructs the same causal state and encoded vector used by the trained
policy. With action weight vector `w_a` and encoded feature vector `x`:

```text
Q(a) = w_a · x
chosen = stable argmax_a Q(a)
runner_up = stable second-highest action
margin = Q(chosen) - Q(runner_up)
feature_margin_i = (w_chosen_i - w_runner_up_i) * x_i
margin = sum_i feature_margin_i
```

Stable ties follow the declared action order. The dominant margin feature is
the first declared feature with maximum absolute contribution.

The artifact also records the fixed raw causal state and previous action. Raw
state is context for human interpretation; encoded features and model weights
are the authority for the exact Q decomposition.

Q values and margins are uncalibrated linear model scores. They are not
probabilities, expected returns, uncertainty intervals, or causal importance.
Feature contributions explain one chosen-versus-runner comparison inside one
frozen model only.

## Action-run behavior

An action run is one contiguous selected action inside one fixed
fold/seed/split rollout. Rollout boundaries reset prior position and previous
action, so runs never cross them.

Aggregate evidence reports:

- action transitions, transition rate, and consecutive-action retention;
- action-run count, mean/median/maximum length, and single-bar-run rate;
- Q-margin distribution and exact tie rate;
- per-action decisions, frequency, runs, run length, mean margin, realized
  reward/net return, turnover, and total cost;
- per-feature dominant-driver frequency plus mean signed/absolute margin
  contribution;
- every fold/seed/split path separately before aggregation.

Action-conditioned realized returns are descriptive. The chosen action is
endogenous to the policy state, so these summaries do not estimate the causal
effect of selecting one sleeve.

## Immutable evidence

New Runs add `policy-rationales.json` with:

- schema/input identity and the fixed method;
- declared actions, raw-state fields, and encoded feature names;
- one ordered row per `policy-actions.csv` decision;
- fold, seed, split, timestamp, previous/chosen/runner-up action;
- raw state, encoded features, every action Q value;
- action margin, per-feature margin contributions, and dominant feature.

Run metrics add `policy_rationale` with the fixed context-only policy and
validation/test aggregate behavior. The public explorer validates the artifact
against `policy-models.json` and `policy-actions.csv`, recomputes every Q score,
margin, contribution, action run, and aggregate, then projects a bounded read
model. Older Runs without both metric and artifact remain readable with
`policyBehavior.available=false`.

## Selection and authority

Behavior/rationale evidence uses `selection_authority=context-only` and
`trading_authority=none`. It cannot alter validation mean net Sharpe, baseline
choice, KEEP/REVERT, non-dominance, or external live execution.

## Invariants

1. Every rationale row has one exact matching action row.
2. Encoded features and frozen weights reproduce all declared Q values.
3. Stable argmax and runner-up reproduce the selected action and margin.
4. Feature margin contributions sum exactly to the chosen Q margin.
5. Action runs never cross fold, seed, or split boundaries.
6. Aggregate behavior exactly reconciles action and rationale artifacts.
7. Test remains visible audit and never enters selection.
8. Q margin is uncalibrated and all evidence has no trading authority.

## Change checklist

- Preserve feature/action declaration order for deterministic ties.
- Keep rationale generation in the fixed Judge closure.
- Reject rehashed action/model/rationale inconsistencies.
- Preserve legacy RL diagnostics.
- Update CLI, Reports, Dossiers, matrix, Studio, docs, templates, schemas, and
  wheel assets together.
- Run focused/full/package/browser verification.
