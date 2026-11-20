# Naver Finance route

The observable route is:

```text
https://api.finance.naver.com/siseJson.naver
```

with a six-digit `symbol`, `requestType=1`, `startTime=YYYYMMDD`,
`endTime=YYYYMMDD`, and `timeframe=day`.

The response is a Python/JavaScript-style array rather than strict JSON. The
Skill parses it as literals only and requires the first six headers to be:

```text
날짜, 시가, 고가, 저가, 종가, 거래량
```

Exact response text is retained because this is observable behavior, not a
versioned public API contract.

Samsung observations before its 2018 50:1 split are visibly back-adjusted,
while the route does not disclose a complete corporate-action methodology.
The package therefore declares `provider-adjusted`, not `raw` or
`split-adjusted`. Treat numerical comparison with other adjustment contracts
as semantically incompatible.

The route has emitted split-suspension placeholders shaped exactly as zero
open/high/low, positive carried close, and zero volume. They are retained in
the raw response and listed in the provider audit, but omitted from normalized
observed history because no traded OHLCV observation exists. Partial zero
prices, nonzero volume, or a nonpositive close do not qualify and remain fatal.

Historical adjusted integer rounding has also placed close exactly one KRW
outside high or low. The normalized package expands only that violated bound
by at most one KRW, records raw and normalized values, and rejects every larger
OHLC inconsistency.
