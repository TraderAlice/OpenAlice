# FinMind Taiwan asset file

Use a non-empty JSON array with exactly:

```json
{
  "symbol": "2330",
  "providerSymbol": "2330",
  "venue": "TWSE",
  "currency": "TWD",
  "assetClass": "equity"
}
```

This first implementation accepts the explicit `TWSE` venue only. Verify the
listing outside FinMind; the provider response carries a stock id but not a
MIC-quality venue identity.
