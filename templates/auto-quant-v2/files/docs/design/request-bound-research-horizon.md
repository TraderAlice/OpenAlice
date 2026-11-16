# Request-bound numerical research horizon

Status: V1 implemented.

Related: [[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/ohlcv-factor-lab]],
[[docs/design/factor-diagnostics]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Purpose

The caller owns the intended forward question; the locked dataset owns the
meaning of one decision bar; AutoQuant owns reproducible evaluation.

```text
Research Request.horizonPolicy
→ content-addressed research-horizon.json
→ Factor primary target and diagnostic forward outcomes
→ Portfolio/RL question identity and disclosure
→ Report / Dossier / optional host delivery
```

Candidate Agents cannot edit this chain.

## Request contract

`horizon` remains the caller's human description. Optional `horizonPolicy`
provides its numerical evaluation contract:

```json
{
  "primaryForwardBars": 21,
  "diagnosticForwardBars": [5, 63]
}
```

Rules:

- bars are positive non-boolean integers no greater than 252;
- caller diagnostics contain one to five sorted unique additional bars;
- Core always evaluates the separately declared primary and canonically stores
  the sorted union, so the example becomes `[5, 21, 63]`;
- the complete canonical evaluated set contains no more than five bars;
- the locked panel must leave at least 20 eligible observations in every
  purged chronological split at the largest diagnostic bar.

When omitted, Core records the reference default primary `1` and diagnostics
`[1, 5, 10]`. It never claims that these values were supplied by the caller.

## Decision-clock semantics

Bar `n` means close `t` to close `t+n` on the Study's exact base decision
clock. The dataset interval surface supplies whether that is one XNYS session,
one XNYS intraday bar, or one continuous UTC bar. Natural-language conversion
does not occur.

## Factor authority

The primary bar owns:

- `validation_mean_ic` and the immutable Study objective;
- train/validation/test headline metrics;
- chronological fold evidence;
- regime, style, per-asset, qualification, component-priority, and component
  ablation summaries that were formerly hardwired to bar 1.

Every diagnostic bar owns its own boundary purge, rank/Pearson IC, quantile
outcome, component quality, and artifact columns. Non-primary bars remain
context only and cannot select a candidate. The canonical
`diagnosticForwardBars` name is retained for compatibility even though its
stored value is the complete evaluated set including the primary.

## Portfolio and governed RL

Portfolio and RL bind the exact Horizon Mandate so changing the caller's
question changes Study, Run, Session, and publication identity. Their
accounting remains a causal sequence of next-bar returns:

- Portfolio signal state may persist across many bars;
- RL receives one next-bar reward per transition;
- cumulative paths can be inspected against the wider question;
- neither lane claims a direct `n`-bar forecast or forced holding period.

This is an honest boundary, not an unfinished semantic substitution.

## Authority and limits

The policy grants `quantitative-decision-support` and
`tradingAuthority: none`. It does not choose a dataset, parse prose, force
exits, define TPSL, or authorize positions. Those require separate contracts.
