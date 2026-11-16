# Yahoo asset inventory

Provide a JSON array:

```json
[
  {
    "symbol": "AAPL",
    "providerSymbol": "AAPL",
    "venue": "XNAS",
    "currency": "USD",
    "assetClass": "equity"
  }
]
```

- `symbol` is the path-safe AutoQuant research identifier.
- `providerSymbol` is sent to Yahoo and may contain a venue suffix.
- `venue`, `currency`, and `assetClass` are caller/researcher claims checked
  against independent market evidence; Yahoo metadata does not authenticate
  them.
- Use unique values for both `symbol` and `providerSymbol`.
- Supported output is either completed daily V1/V4 data or strict aligned XNYS
  `1h` V3 data. The selected script fixes the contract.
- Yahoo does not provide exchange-unadjusted OHLC through this procedure.
  Daily acquisition chooses split-adjusted or split-and-dividend-adjusted
  explicitly. Intraday acquisition is split-adjusted only because Yahoo does
  not expose intraday adjusted close.
