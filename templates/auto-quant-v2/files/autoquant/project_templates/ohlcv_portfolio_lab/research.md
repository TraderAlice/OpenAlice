# OHLCV Portfolio Lab

## Research brief and clarification

Before downloading data, editing `factors/**`, or running an evaluation,
rewrite the incoming assignment in this file as a bounded English research
brief. Make the decision to support, question, motivation, universe, horizon
or cadence, evidence, material constraints, evaluation meaning, expected
deliverable, assumptions, open questions, and proposed route explicit.

Use researcher judgment for factor and portfolio research methods, but do not
invent caller-owned intent. If an ambiguity could materially change the
research, record it here and ask the delegating Agent or user. Repeat until the
question is falsifiable and safe to bind into fixed Study authority. The
caller may use any language; English is the internal working language of the
AutoQuant desk.

## Purpose

Research causal OHLCV factors and test whether their signal survives a fixed,
mechanical translation into constrained cross-asset target weights.

## Workflow

```bash
aq study inspect . --study ohlcv-portfolio-quality --json
aq session start . --study ohlcv-portfolio-quality --request request.json --json
```

Author the first caller-relevant candidate before Session start. With no exact
reusable baseline, Session start runs the fixed fast preflight first and leaves
no Run or Session on failure; a pass grants no selection authority and only
then permits the complete baseline. Use `session check` only after a later
worktree edit.

Work only inside the returned Session worktree and edit `factors/**`. State one
falsifiable factor hypothesis, evaluate it, and inspect all metric layers and
artifacts before accepting a KEEP.
Use `position-episodes.csv` when the question depends on how an executed
position opened, persisted, reversed, or closed. Treat complete episodes
separately from split-censored segments and remember that episode P&L is
additive portfolio contribution, not a standalone compounded trade return.
Use `portfolio-parameter-neighborhood.json` to test whether the fixed result
survives the predeclared local entry/exit and no-trade neighborhood. It is
context-only robustness evidence: never pick a better-looking cell or use it
to rewrite KEEP/REVERT.
For temporal or two-asset relative-value work, also inspect
`portfolio-translation-robustness.json`. It compares the same Factor and fixed
portfolio mechanics across 40/60/120 causal history windows. Do not select a
window; improve the causal Factor representation when the target path is
sensitive.

The fixed Judge owns timing, percentile entry/hold/exit state,
inverse-volatility conviction sizing, request-bound tradable/context assets,
direction, cash, long/short budgets, caps, drift, no-trade behavior,
transaction costs, benchmark, causal portfolio covariance, a one-sided
annualized volatility ceiling, dataset-fixed purged splits, attribution,
stress tests, and the verdict metric. Risk governance happens after raw
signal allocation and again after drift/no-trade chooses the actual book. The
final check may override no-trade only through the minimum proportional
scale-down; it can only move exposure into cash, never lever a weak signal up.
The fixed
`strategies/portfolio-mandate.json` is not candidate-editable.

The Judge also measures the exact executed trade path against a causal
20-observation trailing average of `close × volume`. It reports 1% and 5%
participation capacity, missing-history trade dates, reference-$1m breaches,
and binding assets. This is a contextual OHLCV envelope, not an impact or fill
model, and it cannot affect KEEP/REVERT.

Successful Runs include proposed and executed weights plus a long-form
per-asset decision ledger. Use it to trace factor → intent → raw target →
covariance forecast/scale → governed target → trade → return/risk/cost
contribution. Inspect activation rate, average active scale, maximum
pre/post-governor forecast, and the diagnostic ungoverned comparison before
claiming that a factor survives implementation. Also reconcile final-book
forecast coverage, pretrade breaches, risk-only overrides, executed breaches,
and exact execution reasons. Inspect validation capacity coverage, the
conservative 1% minimum/p10/median, and binding assets before claiming the
path can scale. AutoQuant produces
target-weight research only; it has no Broker or trading-account authority.
