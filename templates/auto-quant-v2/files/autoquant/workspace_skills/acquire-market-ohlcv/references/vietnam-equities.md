# Vietnam listed equities

- Preserve `HOSE`, `HNX`, or `UPCoM` explicitly.
- Use `Asia/Ho_Chi_Minh`; verify session dates and historical market-rule
  changes relevant to the requested range.
- Verify currency scale, price scale, volume units, corporate-action
  adjustment, and symbol reuse.
- Do not collapse the three venues into one nominal Vietnam calendar without
  evidence.

## Routes

- VNDIRECT: use `$fetch-vndirect-ohlcv` for explicit raw or
  provider-adjusted HOSE/HNX/UPCoM daily observations. The route converts
  thousand-VND prices to VND, preserves share volume, verifies reported
  value/volume scale, and retains contradictory provider rows in the audit
  while excluding them from the package.
- Yahoo: use `$fetch-yahoo-ohlcv` as an independent broad route. Yahoo
  historical quote OHLC is split-adjusted rather than exchange-unadjusted, so
  do not compare it with VNDIRECT raw prices as if their semantics matched.

The two routes are real but Vietnam is not accepted as dual-source coverage
until overlapping acquisitions with the same declared adjustment semantics
have passed comparison and strict intake. Neither provider is venue authority.
