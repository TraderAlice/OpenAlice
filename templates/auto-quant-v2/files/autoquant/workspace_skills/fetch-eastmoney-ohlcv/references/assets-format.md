# Eastmoney A-share asset inventory

Provide a JSON array:

```json
[
  {
    "symbol": "600519",
    "providerSecid": "1.600519",
    "venue": "XSHG",
    "currency": "CNY",
    "assetClass": "equity"
  },
  {
    "symbol": "510300",
    "providerSecid": "1.510300",
    "venue": "XSHG",
    "currency": "CNY",
    "assetClass": "fund"
  }
]
```

- `symbol` is the unique path-safe AutoQuant research identifier.
- `providerSecid` is sent verbatim to Eastmoney. The observed convention uses
  `1.<six-digit-code>` for Shanghai and `0.<six-digit-code>` for Shenzhen;
  verify every code and venue independently.
- This Skill also permits caller-verified XBSE mappings but does not infer
  them from a code prefix.
- `venue` must be `XSHG`, `XSHE`, or `XBSE`; `currency` must be `CNY`; and
  `assetClass` must be caller-verified `equity` or `fund`; the numeric code
  does not prove instrument class.
- Provider volume is interpreted as lots and converted to shares only after
  the returned amount/price consistency check passes.
