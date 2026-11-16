# Governed RL Factor-Policy Lab

## Research brief and clarification

Before downloading data, editing `models/**`, training, or running an
evaluation, rewrite the incoming assignment in this file as a bounded English
research brief. Make the decision to support, question, motivation, universe,
horizon or cadence, evidence, material constraints, evaluation meaning,
expected deliverable, assumptions, open questions, and proposed route
explicit.

Use researcher judgment for representation and diagnostic methods, but do not
invent caller-owned intent. If an ambiguity could materially change the
research, record it here and ask the delegating Agent or user. Repeat until the
question is falsifiable and safe to bind into fixed Study authority. The
caller may use any language; English is the internal working language of the
AutoQuant desk.

## Purpose

Research causal state representations for a fixed factor-mixture policy and
test whether adaptation survives chronological folds, multiple seeds,
stateful signal-sleeve triggers, the actual drifted pretrade book, portfolio
constraints, costs, risk, and path-consistent simple baselines.

## Workflow

```bash
aq study inspect . --study ohlcv-rl-factor-policy --json
aq session start . --study ohlcv-rl-factor-policy --request request.json --json
aq orient . --json
```

Author the first caller-relevant representation before Session start. With no
exact reusable baseline, Session start runs the fixed fast preflight first and
leaves no Run or Session on failure; a pass grants no selection authority and
only then permits the complete baseline. Use `session check` only after a later
worktree edit.

Work only inside the returned Session worktree and edit `models/**`. State one
falsifiable representation hypothesis, evaluate it, and inspect seed/fold,
baseline, implementation, and model artifacts before accepting a KEEP.
Use the verified `researchAgenda` to choose the next bounded representation
hypothesis. It is validation-only prioritization, not an executable action:
it cannot add factor sleeves, alter learning rules, promote a candidate, or
use visible test/oracle evidence for selection.
Use the pretrade-book summaries and per-sleeve target distances when a
hypothesis concerns switching cost, stale holdings, or no-trade behavior;
`previous_action` alone does not identify the current portfolio.
`factors/**` is a fixed content-locked input to this Study; start a fresh RL
Session after promoting different factor bytes.
`strategies/factor-population.json` is the separate fixed Factor evaluation
contract. It decides which assets receive factor scores and has no Portfolio
or trading authority.
`strategies/portfolio-mandate.json` is the shared fixed position contract for
every RL action sleeve and is also not editable. Every sleeve receives the
same causal covariance forecast and one-sided volatility ceiling before the
policy may select it; editable state encoding cannot bypass position or risk
authority.
After selection, the shared accounting path also rechecks the actual
post-drift/no-trade book. Risk may override no-trade only through the minimum
proportional scale-down, identically to the Portfolio lane.

The fixed Judge owns all learning and evaluation authority. Test results are
audit evidence, not the promotion metric, and repeated inspection must be
reported as a limitation. Inspect the locked risk policy alongside action
constraints, baseline advantage, seed/fold dispersion, action frequency,
turnover, costs, final-book forecast coverage, risk-only overrides, and
executed breaches. Also inspect the one-step same-pretrade factor opportunity
audit: selected-versus-local-best rank/regret, candidate locally-best and
missed rates, and candidate-versus-balanced reward. The local best is ex-post
hindsight, not an oracle strategy or promotion input. AutoQuant has no
trading-account authority.

For the selected mechanical comparator, inspect the full-path active
attribution: gross edge, incremental cost, net active return, information
ratio, relative drawdown, regime buckets, action-pair buckets, and asset
contributions. State whether the adaptive loss comes from selecting worse
books, paying more to move, or a narrow market/asset segment. Do not treat
conditional validation diagnostics as new optimization objectives.
