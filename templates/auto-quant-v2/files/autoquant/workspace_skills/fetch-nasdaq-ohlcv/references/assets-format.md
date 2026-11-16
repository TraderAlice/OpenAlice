# Nasdaq.com asset inventory

```json
[
  {
    "symbol": "AAPL",
    "providerSymbol": "AAPL",
    "providerAssetClass": "stocks",
    "venue": "XNAS",
    "currency": "USD",
    "assetClass": "equity"
  },
  {
    "symbol": "QQQ",
    "providerSymbol": "QQQ",
    "providerAssetClass": "etf",
    "venue": "XNAS",
    "currency": "USD",
    "assetClass": "fund"
  }
]
```

- `providerAssetClass=stocks` requires `assetClass=equity`.
- `providerAssetClass=etf` requires `assetClass=fund`.
- `venue` remains a caller/researcher claim and may be `XNAS`, `XNYS`,
  `ARCX`, or another independently verified U.S. venue.
- Output is split-adjusted USD daily history.
