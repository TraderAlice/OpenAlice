# Reported-position Book Risk

Status: implemented in AutoQuant `0.8.5`, with fixed-book drawdown evidence
added in `0.8.19`.

Related contracts: [[docs/design/agent-native-quant-workbench]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/study-run-evidence]], and
[[docs/design/studio-observation-surface]].

## Problem

A common OpenAlice handoff is not “find a factor.” It is:

> I mainly hold AAPL, MSFT, NVDA, and QQQ. Are these really one trade? If I
> want less risk, what should I reduce first?

The existing Portfolio lane cannot answer this honestly. Its weights are
model-generated historical targets, not the caller's current book. Substituting
those targets would silently change the question. AutoQuant also must not query
or impersonate OpenAlice Unified Trading Account authority.

The `ohlcv-book-risk-lab` therefore accepts one explicit reported or
hypothetical weight snapshot and performs a fixed descriptive covariance
audit. It is a separate evidence route, not a Portfolio optimizer and not a
Broker adapter.

A second common question is conditional:

> I want to add ten percentage points of TSLA. Is the same fully funded book
> less crowded if the funding comes from NVDA or QQQ?

This is still descriptive research when the caller supplies both complete
books. Comparing those books does not require AutoQuant to invent an Order,
search weights, or claim an optimum. Running them as unrelated Projects would,
however, lose the shared baseline, data panel, method, and delta identity.

## Authority boundary

`request.positionSnapshot` contains:

- `kind`: `reported-weights` or `hypothetical-weights`;
- timezone-aware `asOf`;
- `baseCurrency`;
- non-zero asset `weights`;
- `cashWeight`.

Weights plus cash must sum to one. Gross exposure is bounded at four, each
absolute asset weight at two, and every held asset must be a requested,
non-context asset in the content-locked dataset.

Core derives `strategies/position-snapshot.json` from the normalized request.
That file records the request hash and source provenance and is a fixed Study
dependency. It always declares:

```json
{
  "positionTruth": "external-reported-not-authenticated",
  "tradingAuthority": "none"
}
```

OpenAlice/UTA remains authoritative for authenticated current positions,
lots, tax state, venue capabilities, and execution. AutoQuant does not claim
that the supplied snapshot is still live.

Optional `request.positionScenarios` contains one to eight caller-specified
complete funded books. Each scenario has:

- a unique lowercase kebab-case `id` and non-empty `name`;
- `kind: hypothetical-weights`;
- the exact baseline `asOf` and `baseCurrency`;
- non-zero requested, non-context asset `weights`;
- `cashWeight`.

Each book independently obeys the baseline exposure/funding limits, differs
from the baseline and every other scenario, and is frozen into the same
position-snapshot dependency. Its fixed authority is:

```json
{
  "positionTruth": "caller-hypothetical-not-authenticated",
  "tradingAuthority": "none"
}
```

The public boundary deliberately accepts complete books rather than sparse
transfers. Core never guesses which leg funds an addition, whether omitted
assets remain unchanged, how residual cash behaves, or whether to normalize.

Optional `request.positionSizing` authorizes one narrower derived question:

```json
{
  "kind": "one-asset-against-cash-for-volatility-ceiling",
  "asset": "NVDA",
  "direction": "increase",
  "maximumWeight": 0.20,
  "annualizedVolatilityCeiling": 0.15,
  "lookbackBars": 252
}
```

The asset must be requested and non-context, the lookback must be one of the
fixed 63/126/252-bar windows, and `direction` is explicit:

- `decrease` requires a strictly positive baseline holding, one explicit
  non-negative `minimumWeight` below it, and authorizes only movement from
  that asset to cash;
- `increase` requires strictly positive baseline cash, permits the asset to be
  absent from the baseline book, requires one explicit `maximumWeight` above
  its zero or positive starting weight, and authorizes only movement from cash
  to that asset.

Sizing and caller-supplied scenarios are mutually exclusive so one Run answers
one authority-bounded question. Core freezes the policy with
`decisionPath: caller-bounded-historical-sizing` and
`tradingAuthority: none`. An absent entry asset remains absent from the
reported baseline weights; request-universe membership and the sizing policy,
not a fabricated zero holding, authorize its market data and target-book role.

## Fixed analysis

The default bounded method uses 63, 126, and 252 closed-bar lookbacks, with 252
as the primary window when no sizing question exists. When the caller supplies
`positionSizing`, its exact `lookbackBars` becomes the primary window for the
current metrics, contribution/reduction ledgers, drawdown and equity path, and
rolling evidence. All three fixed windows remain available as diagnostics.
This prevents the ordinary Explorer surface from answering a different
covariance question than the caller-authorized sizing path. The snapshot
`asOf` must lie inside the closed dataset range. Held-asset closes are
inner-aligned and converted to simple returns.

For annualized covariance matrix \(\Sigma\) and reported weights \(w\):

```text
portfolio variance      = w' Σ w
marginal variance       = Σ w
component variance      = w ⊙ (Σ w)
signed risk share       = component variance / portfolio variance
absolute risk share     = |component variance| / Σ|component variance|
component-risk HHI      = Σ absolute risk share²
effective risk bets     = 1 / component-risk HHI
```

The first principal-component share is calculated from the held-asset
correlation matrix. It describes common-movement crowding; it is not a claim
that the holdings are literally one economic trade.

For every fixed lookback, the Judge also constructs a descriptive equity path.
NAV begins at `1.0` on the observed close immediately before the first return.
On every later same-clock row, supplied asset weights are applied to
close-to-close simple returns while cash earns zero:

```text
book return       = Σ supplied weightᵢ × asset returnᵢ
NAVₜ              = NAVₜ₋₁ × (1 + book returnₜ)
drawdownₜ         = NAVₜ / running maximum NAVₜ - 1
maximum drawdown  = minimum drawdownₜ
```

Maximum drawdown is signed and non-positive. The primary window records the
observed peak and trough timestamps and the first later recovery to the peak,
or `null` when unrecovered. A no-loss path uses the initial observed timestamp
for peak, trough, and recovery. This daily constant-weight convention shares
the covariance audit's immutable return panel, but it is not reconstructed
broker holdings, fills, taxes, cash yield, or authenticated account equity.

For each asset the Judge moves one percentage point of absolute position
toward cash, or the whole position when smaller, while holding every other
weight fixed. It ranks the resulting annualized-volatility reduction per unit
weight. This is a standardized historical sensitivity. It is not a tax-aware
recommendation, replacement portfolio, or executable order.

When scenarios exist, the comparison universe is the ordered union of baseline
and scenario assets. The Judge inner-aligns one common closed-price panel for
that union and evaluates the zero-filled baseline plus every supplied complete
book over each fixed 63/126/252-bar covariance window. This common panel can be
narrower than a baseline-only panel when a newly proposed asset has shorter
coverage; the ordinary baseline audit and the scenario baseline both disclose
their observations.

For each supplied scenario and lookback the Judge reports:

- annualized volatility and delta from the common-panel baseline;
- component-risk HHI and delta;
- effective risk bets and delta;
- largest absolute-risk contributor and share;
- volatility rank among the supplied books for that lookback.

For the primary window it also reports each comparison asset's baseline and
scenario weight, component variance, absolute risk share, and exact deltas.
The rank has `selectionAuthority: none`: it orders only books authored by the
caller and does not search, promote, or recommend a nearby portfolio.

When sizing is requested, every weight except the named asset remains fixed
and every unit of asset change is exactly offset by cash. For adjustable
weight \(x\), annualized variance on the governing covariance matrix is solved
exactly as:

```text
q(x) = a x² + b x + c

decrease domain: caller minimum weight ≤ x ≤ reported weight
increase domain: reported weight ≤ x ≤ min(caller maximum weight,
                                            reported weight + reported cash)
```

For `decrease`, the Judge preserves an already-compliant book or returns the
largest feasible \(x\), which is the smallest necessary reduction. For
`increase`, it returns the largest feasible \(x\), either the exact ceiling
boundary, the caller maximum-weight endpoint, or the fully cash-funded endpoint
when that endpoint remains compliant. Every result names the binding constraint
as `volatility-ceiling`, `caller-weight-bound`, `available-cash`,
`current-book`, or `no-compliant-weight`. `infeasible` returns the constrained
minimum-risk point solely as proof that no point on the authorized path reaches
the ceiling. The result
includes signed asset/cash changes, the complete target book, quadratic
coefficients and domain, governing contribution ledger, and diagnostic
behavior on the other fixed lookbacks. It is a historical target-position
calculation, not a forecast guarantee or execution plan.

The sizing result also reports the governing target-book pairwise correlations
and one constant-weight maximum-drawdown summary over the same governing
lookback. This keeps an absent candidate's dependence and downside path inside
the immutable Run rather than forcing an Agent to reconstruct them from the
quadratic coefficients or Project data. The ordinary baseline correlation and
drawdown surfaces remain the exact reported book and therefore do not pretend
the candidate was already held.

The immutable report's `method.primaryLookbackBars`, `current`, primary
contribution and reduction CSVs, and sizing policy must all name that same
governing lookback. The Explorer rejects a Run that diverges across those
surfaces instead of asking an Agent to reconcile conflicting definitions of
“current.”

## Immutable evidence

One successful Run publishes:

- `book-risk-report.json`;
- `book-risk-contributions.csv`;
- `book-risk-reductions.csv`;
- `book-risk-correlations.csv`;
- `book-risk-path.csv`;
- `book-risk-equity-path.csv`;
- `book-risk-scenario-comparisons.csv`;
- `book-risk-scenario-contributions.csv`;
- `book-risk-sizing-lookbacks.csv`;
- `book-risk-sizing-contributions.csv`.

The equity-path CSV retains the longest declared fixed-lookback path so the
Explorer can independently rebuild every 63/126/252-style drawdown even when
a shorter caller-fixed sizing window is primary. CLI and Studio project only
the normalized primary-window path and interval; the longer artifact is
validation evidence, not a competing definition of “current.”

`aq run book-risk` revalidates Run hashes, the frozen position snapshot, exact
method and dataset description, metric reconciliation, contribution and
reduction ordering, pair counts, rolling summaries, and cross-artifact
identity before returning the bounded `book-risk-diagnostics` read model. For
new Runs, every declared lookback in `book-risk-report.json` carries its full
standardized reduction ranking. The primary-window CSV remains the compact
tabular artifact, while the immutable report lets an Agent compare complete
63/126/252-style ordering without recomputing evidence outside the Run. For
drawdown it additionally rebuilds NAV, cumulative return, running peaks,
per-row drawdown, the peak/trough/recovery interval, and the primary-window
scalar from the immutable equity-path CSV. For
supplied scenarios it additionally re-derives every delta, rank, HHI/effective
bet identity, weight change, component-variance sum, risk-share sum and leader
from the two scenario artifacts and frozen books.
For sizing it additionally re-derives the direction-specific domain,
constrained quadratic minimum, largest feasible root or endpoint, status
semantics, complete one-leg/cash weight change, governing variance,
contribution identities, and both sizing artifacts. A sizing-only asset may
enter this ledger with baseline weight zero without entering the
caller-scenario comparison universe.

Run-native compatibility is explicit. Book Risk Runs recorded by Harness
versions before `0.8.19` keep their original nine-artifact inventory and remain
readable in CLI and Studio; their read model marks drawdown and equity path
unavailable. Core never retrofits a new path into an old immutable Run.

Studio exposes the same verified evidence as a Book Risk lane:

- current volatility, effective risk bets, first-PC share, and HHI;
- current and lookback maximum drawdown plus the primary equity path and
  peak/trough/recovery interval;
- the contributor and reduction leader;
- lookback stability;
- component-risk tables;
- pairwise correlations;
- rolling crowding context;
- caller-supplied scenario ranks/deltas and primary-window per-asset changes;
- caller-bounded sizing status, binding constraint, target weights, cash
  change, governing ceiling, and cross-lookback diagnostics;
- the explicit no-authentication/no-optimization/no-order warning.

## Agent lifecycle

The Quant Agent first writes the English `research.md` and clarifies whether
weights are reported or hypothetical, the as-of time, the meaning of “reduce
first,” and any tax, lot, replacement, or horizon constraints that would
change interpretation.

For a conditional reallocation question, the Agent must also clarify and
record every complete proposed book, confirm the common time/currency and
unchanged legs, and state that historical covariance risk—not taxes, expected
return, suitability, or execution—is the comparison meaning. It must not
manufacture missing scenarios.

For a one-leg sizing question, the Agent must clarify the only adjustable
asset, whether it increases from cash or decreases to cash, exact historical
covariance window, numerical annualized-volatility ceiling, the explicit
direction-specific minimum or maximum resulting weight, and whether the caller
accepts a no-solution result. For an increase it must also confirm the available
cash and that every existing holding remains fixed. It must not add
another adjustable asset, create a scenario grid, or turn the historical
target into an Order.

After the fixed Run, `aq orient` reports
`descriptive-audit-complete`, has no primary CLI action, explicitly instructs
the Agent to explain and return the decision-support answer, retains
`aq run book-risk ... --json` as supporting read-only evidence access, and
creates no experiment agenda. It must not be converted into an optimization
Session merely because AutoQuant also supports iterative Factor, Portfolio,
and RL research.

## Explicit limitations

The first contract intentionally excludes:

- authenticated account reconciliation;
- point-in-time fundamentals, exposures, sectors, or options Greeks;
- tax lots, borrow, financing, replacement selection, and transaction costs;
- covariance shrinkage or factor-model estimation;
- choosing the adjustable asset, non-cash funding, general portfolio
  optimization, or multi-leg target generation;
- scenario generation, sparse-delta interpretation, or scenario probability;
- orders, TPSL, approval, or execution.

Those require either another bounded research question or OpenAlice's existing
account and execution surfaces. They must not be inferred from this audit.
