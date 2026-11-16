# Sohu asset file

Use a non-empty JSON array with exactly:

```json
{
  "symbol": "920019",
  "providerSymbol": "cn_920019",
  "venue": "XBSE",
  "currency": "CNY",
  "assetClass": "equity"
}
```

Supported venues are `XSHG`, `XSHE`, and `XBSE`. The provider symbol is
`cn_` plus the six-digit security code. Verify the issuer and venue outside
Sohu; the provider prefix does not encode the venue.
`assetClass` may be caller-verified `equity` or `fund`; the provider prefix
does not establish instrument class.
