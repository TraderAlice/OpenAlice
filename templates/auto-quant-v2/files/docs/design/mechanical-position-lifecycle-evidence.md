# Mechanical position lifecycle evidence

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/portfolio-decision-explorer]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the reconstruction of exact historical executed-weight
episodes from the Portfolio decision ledger: split boundaries, side changes,
cost allocation, contribution paths, censoring, summary statistics, immutable
artifact evidence, and public read models.

It does not own factor values, signal thresholds, target sizing, order fills,
tax lots, TPSL, intrabar paths, Broker/UTA state, or candidate promotion.

## Episode identity

An episode is one contiguous non-zero sign of one asset's executed weight
inside one fixed train/validation/test signal interval:

```text
flat → long       opens a long episode
long → long       holds/resizes the episode
long → flat       closes the episode
long → short      closes long and opens short on the same decision close
```

The split boundary is authoritative. A position already active at split start
creates a `left_censored` segment. A position still active after `signalEnd`
creates a `right_censored` segment. Only episodes with neither flag are
complete. A first-row close may create a zero-earning, cost-only
left-censored segment so split cost reconciliation remains exact.

Episode ids are deterministic within the artifact:
`<split>:<asset>:<four-digit sequence>`.

## Contribution and cost

Each decision row's gross contribution belongs to the episode represented by
that row's executed-weight sign. Linear asset cost is allocated exactly once:

- flat-to-position cost enters the new episode;
- same-side resize cost remains inside the current episode;
- position-to-flat cost exits the old episode;
- reversal cost is divided by absolute close and open notional between the old
  and new episodes.

For an episode:

```text
net contribution
= sum(asset weight × next-bar asset return)
- entry cost
- same-side holding/resize cost
- exit cost
```

This is additive contribution to portfolio return, not a standalone
compounded trade return. Its maximum favorable/adverse excursion is the
maximum/minimum cumulative net contribution observed at decision-bar
resolution from the clipped segment start. It is not intrabar price MFE/MAE.

## Evidence

`position-episodes.csv` records:

- split, role, deterministic id, asset, side, and sequence;
- entry, last earning, and optional exit timestamp/action;
- left/right censoring and complete status;
- decision bars, entry/last/peak/average absolute weight;
- gross contribution, entry/holding/exit/total cost, and net contribution;
- cumulative-contribution MFE/MAE;
- signal-intent mismatch, no-trade, and risk-override bars.

Split metrics distinguish complete episodes from all clipped segments. They
report complete-episode win rate, mean win/loss, payoff ratio, profit factor,
holding distribution, segment contribution/excursion, mismatch rates, and
per-asset/side summaries. Gross, cost, and net totals must reconcile to the
exact source ledger or the Judge fails.

## Selection and authority

Lifecycle evidence explains how a fixed candidate behaved after mechanical
portfolio construction. It uses `selection_authority=context-only` and does
not affect validation net Sharpe, KEEP/REVERT, non-dominance, or RL reward.

All episodes are historical target-weight research. “Entry” and “exit” name
state transitions in the simulator; they are not live orders, Broker fills,
account lots, or external trading approval.

## Legacy evidence

Older immutable Portfolio Runs without the artifact and metrics remain
readable. Public projections mark lifecycle evidence unavailable instead of
reconstructing and claiming a historical contract that the original Run did
not publish.

## Invariants

1. Episode rows use only immutable decision-ledger evidence.
2. No contribution or cost crosses a fixed split `signalEnd`.
3. Every selected gross contribution and asset cost is allocated exactly once.
4. Reversal cost is divided by close/open notional, never duplicated.
5. Censored segments are never included in complete-episode win/payoff claims.
6. MFE/MAE is daily additive contribution, not intrabar price excursion.
7. Lifecycle evidence is context-only and has no trading authority.

## Change checklist

- Test open, hold, resize, close, reversal, and boundary censoring explicitly.
- Reconcile artifact rows back to the decision ledger after strict parsing.
- Reject fully rehashed artifact/metric fabrication.
- Preserve legacy Portfolio explorer behavior.
- Update CLI, Reports, Dossiers, Studio, schemas, templates, and wheel assets
  together.
- Run repository documentation, focused, full, package, and browser checks.
