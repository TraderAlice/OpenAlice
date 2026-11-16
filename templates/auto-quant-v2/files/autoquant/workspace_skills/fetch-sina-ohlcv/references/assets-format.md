# Sina asset file

Use a non-empty JSON array with exactly:

```json
{
  "symbol": "600519",
  "providerSymbol": "sh600519",
  "venue": "XSHG",
  "currency": "CNY",
  "assetClass": "equity"
}
```

Venue prefixes are fixed:

- `XSHG` → `sh`
- `XSHE` → `sz`
- `XBSE` → `bj`

The security code must contain six digits. Verify code migrations and listing
identity outside Sina.
`assetClass` is caller-verified `equity` or `fund`; Sina does not infer it from
the code.
