# Reported-book historical path stress

Status: fixed Study, strict Explorer, CLI, and Studio projection implemented for `0.9.15`.

Related: [[docs/design/reported-position-book-risk]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/study-run-evidence]], and
`plans/reported-book-path-stress-field-trial`.

## Purpose

The Path Stress Lab answers one narrow historical question: given a caller's
exact funded weights, which fixed-horizon historical paths produced the worst
terminal book losses, what happened inside each path, and which holdings
caused the loss?

It is deliberately separate from Book Risk. Book Risk describes covariance,
constant-weight rolling risk, drawdown, supplied reallocation scenarios, and
bounded sizing. Path Stress initializes the reported book once at every
historical window start and then holds fixed opening units. The resulting
weights drift. Neither method may be relabelled as the other.

## Request authority

`ohlcv-book-path-stress-lab` requires both:

- `positionSnapshot`: one fully funded reported or hypothetical weight book;
- `pathStressPolicy`: `fixed-unit-worst-terminal-loss-episodes`, a fixed
  `holdingBars`, fixed `episodeCount`, and
  `greedy-worst-terminal-loss-non-overlapping`.

The Lab accepts no position scenarios, position sizing, factor, horizon,
portfolio, benchmark, event, or allocation policy. The caller chooses the
book, horizon, episode count, assets, history, calendar, and price meaning
before results are visible. The Project binds immutable
`strategies/position-snapshot.json` and
`strategies/book-path-stress.json`; there is no editable candidate or Session.

Strict intake requires a task-complete V1 daily package with
`priceAdjustment=split-adjusted`. Existing Workspace inventory never selects
or completes the package. Provider claims remain unauthenticated, and a second
suitable route is coverage evidence rather than permission to mix price
contracts.

## Fixed path arithmetic

Let the aligned completed-session closes for asset `i` be `P[i,t]`, opening
weight `w[i]`, flat cash weight `c`, and fixed horizon `H`. Every start `s` is
eligible only when endpoint `s + H` exists on the common session index.

For each offset `h` from zero through `H`:

```text
asset_return[i,s,h] = P[i,s+h] / P[i,s] - 1
contribution[i,s,h] = w[i] × asset_return[i,s,h]
book_return[s,h] = Σ contribution[i,s,h]
cash_return = cash_contribution = 0
```

This is equivalent to buying the opening units at `s` and never rebalancing
inside the window. `book_return[s,H]` is the terminal ranking value. The worst
interim point is the minimum path value over offsets `0..H`, with the earlier
offset winning an exact tie.

## Episode selection

Core enumerates every complete window, sorts ascending by terminal book
return, and breaks equal returns by earlier start. It then greedily admits a
candidate only when its inclusive `[start,end]` session interval is disjoint
from every already selected interval. Selection stops at `episodeCount`; an
insufficient history fails rather than returning fewer episodes silently.

For every selected episode, the dominant loss contributor is the non-cash
holding with the smallest terminal contribution. Contributions must reconcile
to terminal book return within the frozen tolerance. The conclusion also says
whether the same holding dominates every selected episode; it does not attach
news, macro, or causal labels.

## Immutable evidence

One successful Run owns exactly five artifacts:

1. `book-path-stress-report.json` — authority, book, dataset, summary,
   episodes, and no-trading conclusion;
2. `book-path-stress-windows.csv` — every complete window and selected rank;
3. `book-path-stress-episodes.csv` — the selected episode ledger;
4. `book-path-stress-contributions.csv` — terminal holding and cash
   reconciliation;
5. `book-path-stress-paths.csv` — every selected path offset and per-holding
   contribution.

The primary metric is `worst_terminal_book_return`; window and selected counts
are supporting metrics. `aq run book-path-stress` checks the exact artifact
inventory and frozen dependencies, independently reconstructs ranking and
greedy overlap selection, rechecks every path point and contribution, and
reconciles the report and Run metrics. Studio consumes this verified read
model rather than parsing files privately.

## Authority boundary

The result is descriptive historical decision support. It does not:

- authenticate an account or reconstruct historical account performance;
- forecast future stress or probability;
- explain an episode with news or causal labels;
- search weights, horizon, count, overlap, assets, or adjustment semantics;
- optimize a replacement book;
- create an Order, TP/SL, or trading recommendation.

OpenAlice or another caller may discuss the evidence with a user, but account
truth and execution remain outside AutoQuant.
