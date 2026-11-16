# Fixed reported-book covariance and reduction audit

The Judge reads the immutable `request.json` position snapshot and the
researcher-owned `strategies/book-risk-scenarios.json` method declaration. It
uses only closed OHLCV observations at or before the snapshot `asOf` time.

It must report:

- annualized covariance risk through each predeclared lookback;
- signed and absolute component-risk contribution;
- component-risk HHI and effective risk bets;
- first-principal-component share of the held-asset correlation matrix;
- exact pairwise held-asset correlations;
- a primary-window daily constant-weight close-to-close equity path, signed
  maximum drawdown, peak, trough, and recovery interval, plus maximum drawdown
  on every fixed lookback;
- one standardized, cash-funded reduction of each position, ranked by
  volatility reduction per unit weight;
- when supplied, every caller-authored complete hypothetical book under the
  exact same return panel and covariance lookbacks, including volatility,
  component-risk HHI, effective risk bets, baseline deltas, primary-window
  per-asset contribution changes, and a no-authority volatility rank among
  supplied books only;
- when authorized, one exact direction-aware asset/cash sizing path under a
  fixed historical volatility ceiling: the smallest necessary decrease or
  largest compliant cash-funded increase, including its complete target book,
  signed changes, quadratic domain, governing target-book correlations and
  constant-weight maximum drawdown, and cross-lookback diagnostics;
- a sampled rolling path under the primary lookback.

The reduction, supplied-book, and one-leg sizing tables are historical
evidence, not tax-aware recommendations, general optimized targets, or orders.
The drawdown path applies the supplied weights to every same-clock simple
return row and therefore describes a research convention, not reconstructed
broker holdings.
Never silently replace reported weights, generate hypothetical books, select
the adjustable asset, or infer a funding leg.

`strategies/book-risk-scenarios.json.minimumObservations` is the lower bound
for the sampled rolling diagnostic, not a substitute for the complete declared
lookbacks. It may be 20 through the largest declared lookback; every fixed
lookback and any sizing `lookbackBars` still require their full observation
count before the Judge runs.
