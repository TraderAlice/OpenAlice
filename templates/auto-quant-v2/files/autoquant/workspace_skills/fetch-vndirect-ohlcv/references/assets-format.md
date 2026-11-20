# VNDIRECT asset inventory

```json
[
  {
    "symbol": "VCB",
    "providerSymbol": "VCB",
    "providerFloor": "HOSE",
    "venue": "HOSE",
    "currency": "VND",
    "assetClass": "equity"
  }
]
```

- `providerFloor` accepts `HOSE`, `HNX`, or `UPCOM`.
- `venue` preserves the research label `HOSE`, `HNX`, or `UPCoM`.
- The provider floor must match every returned row.
- Output prices are VND per share and volume is shares.
