# Nikkei asset file

Use a non-empty JSON array with exactly:

```json
{
  "symbol": "7203.T",
  "providerCode": "7203",
  "providerMarket": "1",
  "venue": "XTKS",
  "currency": "JPY",
  "assetClass": "equity"
}
```

- `providerMarket=1` is the observed Nikkei selector for the TSE primary
  listing on the field-trial assets.
- `symbol` is the canonical research identifier and should match peer packages
  for the same listing, such as Yahoo's `7203.T`. `providerCode` is the
  route-specific four-digit Nikkei lookup code; do not replace the canonical
  symbol with it merely because this provider accepts the shorter code.
- Verify code, issuer, primary listing, and market independently.
- This Skill accepts only four-digit named `XTKS` equities in JPY.
