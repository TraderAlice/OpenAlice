# Euronext asset file

Use a non-empty JSON array. Every object must contain exactly:

```json
{
  "symbol": "MC",
  "providerInstrument": "FR0000121014-XPAR",
  "venue": "XPAR",
  "currency": "EUR",
  "assetClass": "equity"
}
```

- `symbol` is the stable path-safe AutoQuant identity.
- `providerInstrument` is the exact Euronext Live `ISIN-MIC` product identity.
- This first executable route accepts only `XPAR`, EUR, and equity.
- Verify the ISIN, MIC, issuer, and requested instrument independently.
