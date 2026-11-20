# Binance asset inventory

Provide:

```json
[
  {
    "symbol": "BTC",
    "providerSymbol": "BTCUSDT",
    "venue": "BINANCE-SPOT",
    "currency": "USDT"
  }
]
```

`symbol` is the AutoQuant research identifier. `providerSymbol` is the exact
Binance Spot pair. Keep quote currency and venue explicit. Do not use a Spot
pair as a futures, perpetual, index, or executable-account proxy.
