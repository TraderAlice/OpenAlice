# South Korea listed equities

- Preserve the exact KRX market/board and provider symbol separately.
- Use `Asia/Seoul`; verify session dates and suspended observations.
- Confirm price adjustment, share/lot volume units, and currency.
- Do not infer delisting coverage or historical index membership from a
  successful current symbol lookup.

## Routes

- Naver Finance: provider-adjusted route through `$fetch-naver-ohlcv`; verify the six-digit
  code and board identity outside the response. Inspect exact no-trade
  placeholders omitted from normalized observed history and any audited
  one-KRW rounded-bound normalization. Its full adjustment methodology is
  unknown; never relabel it as raw or equivalent to Yahoo.
- Daum Finance: independent raw route through `$fetch-daum-ohlcv`; preserve
  pagination evidence and retain accumulated trade value/share-volume ratios
  as diagnostics. Do not assume those aggregates share daily OHLC session
  scope.
- Yahoo: broad route through `$fetch-yahoo-ohlcv`; verify `.KS` versus `.KQ`,
  history, freshness, currency, and split-adjusted semantics. Do not compare
  it as equivalent to the two raw routes.

None of these routes is KRX authority. Preserve that limitation even when
observations agree.
