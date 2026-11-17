# Sina observable K-line route

Observed route:

```text
https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData
  ?symbol=<prefixed-symbol>
  &scale=240
  &ma=no
  &datalen=1023
```

The 2026-07 response returned UTF-8 JSON under
`result.status.code` / `result.data`. Each daily row exposed `day`, `open`,
`high`, `low`, `close`, and `volume`. Bounded cross-source checks treated
volume as shares. This is observed provider behavior, not a stable published
API or exchange entitlement.
