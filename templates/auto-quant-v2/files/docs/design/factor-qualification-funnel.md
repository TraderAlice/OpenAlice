# Factor qualification funnel

Status: implemented.

Related: [[docs/design/factor-diagnostics]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/factor-evidence-explorer]],
[[docs/design/cross-study-factor-dependencies]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/research-program-orchestration]].

## Purpose

AutoQuant must not send every syntactically valid candidate factor directly
into portfolio construction or RL. A quant researcher first needs to know
whether the request needs a useful decision signal, is validating a
predeclared known style, or is claiming novel information. That distinction is
frozen in `strategies/factor-claim.json` before candidate iteration; it cannot
be inferred after seeing results.

The qualification funnel is research evidence, not an automatic promotion or
trading gate:

```text
request-bound factor claim
→ candidate source
→ claim-specific validation funnel
→ chronological stability
→ Project-family selection adjustment
→ Portfolio monetization for forward-return evidence only
→ optional governed-RL consumption for forward-return evidence only
```

## Fixed comparison contract

The Factor Judge owns four fixed OHLCV style proxies:

- 20-bar momentum;
- 5-bar reversal;
- 20-bar realized volatility;
- 20-bar relative volume.

For `novel-factor`, the dominant comparison style is selected once using only
the training split: maximum absolute mean daily cross-sectional rank overlap
with the candidate. Validation and test never choose the comparison.

For `known-style-validation`, the caller must predeclare one of the four
styles. The Judge fixes that comparison even if another style overlaps more.
The candidate must match it with at least `0.95` mean train rank correlation.
This makes “we implemented and validated reversal” a coherent claim instead
of forcing an impossible requirement that reversal also be novel versus
reversal.

For `decision-signal`, the researcher may use a familiar or composite signal
to answer an allocation, ranking, or timing question. The Judge still chooses
the closest comparison style on train only and discloses neutralized and blend
evidence, but style overlap is not a failure: the request does not claim new
information.

At every timestamp, the Judge ranks the candidate and selected style across the
current asset universe and centers both rank vectors. It computes:

- the candidate signal;
- the selected style by itself;
- the candidate residual after a same-timestamp one-style OLS projection;
- an equal-weight rank blend of candidate and selected style.

This neutralization is causal because all inputs are observable at the signal
close. It is cross-sectional and contemporaneous; it is not a fitted
forward-return model and never sees the target.

The same target-free comparison works when the fixed outcome is forward
realized volatility. A positive risk forecast terminates as
`risk-forecast-positive`; it does not enter Portfolio or governed RL because
high predicted risk has no inherited expected-return sign.

## Evidence

For every Horizon Mandate target and train / validation / visible-test split,
the immutable Run records daily rank IC and descriptive/HAC summaries for all
four signals. It also records:

- train-only comparison-style candidates and the chosen style;
- validation residual-IC retention versus raw candidate IC;
- validation blend uplift versus style and versus candidate;
- two chronological residual-IC folds per split;
- exact method, timing, split roles, and authority.

Core reconstructs every mean and observation count from the immutable daily
qualification artifact before exposing a diagnosis. Candidate and residual
chronological folds are both preserved.

## Diagnosis

Only validation can set the next research focus. The novel-factor funnel's
first demonstrated failure is classified as:

1. `raw-predictive-edge-absent`;
2. `raw-statistical-evidence-weak`;
3. `style-neutral-edge-absent`;
4. `style-neutral-statistical-evidence-weak`;
5. `blend-uplift-absent`;
6. `residual-temporal-instability`;
7. `factor-qualification-positive`.

The decision-signal funnel uses:

1. `raw-predictive-edge-absent`;
2. `raw-statistical-evidence-weak`;
3. `decision-signal-temporal-instability`;
4. `decision-signal-positive`.

The known-style funnel uses:

1. `known-style-identity-mismatch`;
2. `raw-predictive-edge-absent`;
3. `raw-statistical-evidence-weak`;
4. `known-style-temporal-instability`;
5. `known-style-validation-positive`.

Positive raw and residual IC require a fixed positive HAC t-statistic of at
least `1.96` before the funnel advances. This is a conventional diagnostic
threshold, not a p-hacking surface or promotion rule. Project-family
selection-adjusted significance remains separately required after repeated
candidate search. Effect size, turnover, decay, quantile shape, and later
Portfolio monetization remain visible evidence for the researcher.

Test appears beside validation as visible audit only. It never changes the
stage, comparison style, Session verdict, Report recommendation, or RL policy.

## Reference evidence

The bounded Yahoo reference used actual provider-adjusted daily OHLCV for AAPL,
MSFT, NVDA, QQQ, and SPY over 1,254 sessions from 2021-07-23 through
2026-07-22. The default candidate produced:

- validation raw rank IC `+0.0028`, HAC t-statistic `+0.0782`;
- train-selected dominant style `reversal_5`;
- validation residual rank IC `+0.0495`, HAC t-statistic `+1.5031`;
- validation blend rank IC `+0.0200`; and
- visible-test raw/residual rank IC `-0.0768` / `-0.0682`.

The correct diagnosis is `raw-statistical-evidence-weak`, even though the raw
IC sign is positive. This reference caught and removed an earlier UI shortcut
that treated positive sign alone as sufficient evidence.

A separate deterministic relative-volume candidate provides the complementary
redundancy case: it improves the fixed Factor objective and receives KEEP, but
the train-selected comparison is `relative_volume_20` and style-neutral
residual IC is zero. The funnel therefore diagnoses
`style-neutral-edge-absent` without mutating the existing Session verdict.

## Caller and RL boundary

A local or delegated request gives the Project its assets, direction, horizon,
and decision context. Qualification answers whether a proposed model contains
distinct historical information worth carrying into the next research lane.
It does not answer whether any caller should buy an asset.

Governed RL may consume the content-locked candidate source only as a research
dependency. The Factor qualification hash and diagnosis belong in immutable
Report/Dossier evidence so an operator can distinguish:

- weak factor research;
- useful factor evidence that fails Portfolio monetization;
- useful mechanical evidence that RL fails to improve; and
- genuine incremental adaptive value.

## Invariants

1. The research claim and optional known style are fixed by request intake.
2. Decision-signal and novel claims select their dominant style on train only;
   a known-style claim uses the request-predeclared comparison.
3. Neutralization uses only same-timestamp factor/style observations.
4. Forward returns never enter style selection or neutralization.
5. Validation alone determines the research diagnosis.
6. Test is visible audit only.
7. Raw, residual, style, and blend IC remain separate; no composite score hides
   a failed layer.
8. Legacy Runs without qualification evidence remain immutable and readable.
9. Qualification grants no KEEP/REVERT, RL, Broker, order, account, capital, or
   trading authority.
