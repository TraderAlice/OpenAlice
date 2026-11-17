# Tencent route evidence

The observable raw daily route is:

```text
https://web.ifzq.gtimg.cn/appstock/app/kline/kline
```

with:

```text
param=<provider-symbol>,day,<start>,<end>,2000
```

The Skill consumes `data[providerSymbol].day` rows as:

```text
date, open, close, high, low, volume_lots
```

This is observable behavior rather than a documented stable API contract.
Exact response bytes are retained. The 2,000-row request bound is checked
against the requested range; longer history should be split explicitly rather
than silently accepting a truncated response.
