# Portfolio diversification and correlation-breakdown stress

Status: active design.

Related: [[docs/design/portfolio-risk-governor]],
[[docs/design/portfolio-decision-explorer]],
`plans/portfolio-sizing-anatomy`,
[[docs/design/executed-book-risk-compliance]],
[[docs/design/program-research-dossiers]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

Per-asset caps and a covariance volatility ceiling do not prove that a book has
several independent bets. Five technology stocks can still be one risk
position, and a long/short book can rely on correlations that disappear under
stress.

AutoQuant therefore exposes a bounded, immutable diversification read model:

```text
historical executed weights
+ causal covariance reconstructed from the exact asset-return ledger
+ covariance component variance
+ portfolio variance
→ component-risk concentration
→ effective risk bets
→ 25% / 50% / 100% covariance blend toward the
  perfect position-aligned correlation upper bound
→ fixed-ceiling stress disclosure
```

This is research context for a trader and OpenAlice. It does not change the
book.

## Exact reconstruction

For decision date `t`, let:

- `w_i(t)` be the historical executed weight;
- `σ_i(t)` be the daily own volatility from the diagonal of the same causal
  covariance window used by the request-bound risk governor;
- `v_i(t)` be the covariance component variance contribution;
- `V(t) = Σ_i v_i(t)` be the frozen portfolio variance;
- `C` be the request-bound annualized volatility ceiling;
- `A = 252` be the fixed daily annualization.

An active book has at least one `abs(w_i) > 1e-12`. Risk evidence is available
only when every active asset has finite positive own volatility and
`V(t) > 1e-18`.

The reconstructed sample forecast is:

```text
sample_vol(t) = sqrt(V(t) * A)
```

Absolute covariance-risk shares retain negative hedging contributions before
normalization:

```text
absolute_share_i = abs(v_i / V) / Σ_j abs(v_j / V)
risk_hhi = Σ_i absolute_share_i²
effective_risk_bets = 1 / risk_hhi
```

The terminal stress assumes every active pair becomes perfectly correlated in the
direction that makes the signed positions' PnL risks reinforce. This
correlation matrix is an outer product of position signs and is positive
semidefinite. The corresponding upper-bound volatility is:

```text
stress_daily_vol(t) = Σ_i abs(w_i(t)) * σ_i(t)
stress_vol(t) = stress_daily_vol(t) * sqrt(A)
stress_multiplier(t) = stress_vol(t) / sample_vol(t)
```

One terminal upper bound is mathematically clean but often too blunt. The
fixed stress ladder therefore uses `b ∈ {0.25, 0.50, 1.00}`:

```text
Σ_b(t) = (1 - b) Σ_observed(t) + b Σ_perfect-aligned(t)
```

Both endpoint covariance matrices are positive semidefinite, so every blended
scenario is positive semidefinite. The ladder answers when the book crosses
its fixed ceiling as 25%, 50%, then 100% of observed diversification benefit
is replaced by position-aligned co-movement. No ladder point is selected or
assigned a probability.

Core reconstructs close return at date `t` from the preceding decision row's
exact next-bar asset return, then applies the same covariance window, complete
panel requirement, population normalization, minimum observations, universe
order, and annualization frozen by the Portfolio Mandate. Reconstructed
portfolio/component variance must equal the ledger before any stress is
exposed.

Per-asset stress-risk share is its
`abs(w_i) * σ_i / stress_daily_vol`. It sums to one for every available active
book.

## Current and split evidence

The current historical book exposes:

- active assets and evidence state;
- sample and perfect-correlation annualized volatility;
- stress multiplier and request-bound ceiling breach;
- absolute component-risk HHI and effective risk bets;
- largest absolute covariance contributor;
- per-asset weight, own volatility, covariance contribution, absolute
  covariance share, standalone annualized risk load, and stress-risk share.

Validation and visible test remain separate. Each split reports:

- total, active, available, flat, and unavailable dates;
- ceiling-breach count/rate at every fixed ladder point;
- median, p95, and maximum stress multiplier;
- median and minimum effective risk bets;
- the dated maximum-stress book.

Validation has selection-role visibility only; the projection is
`context-only`. Test is `visible-audit`. Neither enters candidate selection,
KEEP/REVERT, factor/Portfolio/RL progression, or promotion.

## Flat and unavailable semantics

- A flat book has zero active assets, zero sample/stress volatility, no breach,
  and no fabricated multiplier or effective-bet count.
- An active book with missing own-volatility history or non-positive frozen
  portfolio variance is `risk-history-unavailable`.
- A single available position has risk HHI `1`, effective risk bets `1`, and
  stress multiplier `1`.
- Negative covariance component contributions are valid hedging evidence. They
  are preserved signed and normalized only by absolute magnitude for HHI.

## Report, Dossier, and Studio

The Portfolio leader-decision-support snapshot freezes the exact
`diversificationStress` object and hash. Report and Dossier Markdown show the
current upper bound and validation/test split summaries. OpenAlice receives the
same immutable evidence as Studio and CLI.

Studio leads with effective risk bets and stress-ceiling status, then exposes
per-asset risk shares and split history. JavaScript formats Core evidence but
does not recompute covariance, stress, or a verdict.

## Authority and invariants

1. Every field is reconstructed from verified immutable Run artifacts.
2. Only causal own volatility already available at each decision date enters
   the stress.
3. The stress is a deterministic upper bound, not a probability or prediction.
4. Visible test never changes the projection's authority or any research gate.
5. The projection never mutates weights, orders, account state, or capital.
6. Authority is `context-only`; trading authority is `none`.

## Known limitations

- The ladder and terminal perfect position-aligned correlation scenario are
  deliberately severe and contain no estimated likelihood or holding-horizon
  model.
- V1 does not expose the full covariance/correlation matrix or stable clusters.
- No shrinkage, factor covariance, scenario library, or optimization is added.
- Own volatility inherits the fixed trailing window from the Portfolio Judge.
