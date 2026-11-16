# TWSE asset inventory

```json
[
  {
    "symbol": "2330",
    "providerStockNo": "2330",
    "venue": "TWSE",
    "currency": "TWD",
    "assetClass": "equity"
  }
]
```

- `symbol` is the path-safe AutoQuant research identifier.
- `providerStockNo` is sent verbatim to the official monthly report.
- Initial scope requires `venue=TWSE`, `currency=TWD`, and
  `assetClass=equity`.
- TPEx instruments require a separate official route and must not be relabeled
  as TWSE.
