# Tencent A-share asset inventory

```json
[
  {
    "symbol": "600519",
    "providerSymbol": "sh600519",
    "venue": "XSHG",
    "currency": "CNY",
    "assetClass": "equity"
  },
  {
    "symbol": "510300",
    "providerSymbol": "sh510300",
    "venue": "XSHG",
    "currency": "CNY",
    "assetClass": "fund"
  }
]
```

- `providerSymbol` must use the explicit observed `sh` or `sz` prefix plus a
  six-digit code.
- The Skill verifies prefix/declared-venue consistency but not listing truth.
- Initial scope is caller-verified XSHG/XSHE listed equity or fund in CNY.
  Provider symbols do not prove instrument class. XBSE requires separately
  proved symbol semantics.
- Output volume is shares; the observed provider lot value is multiplied by
  100 and retained in the audit.
