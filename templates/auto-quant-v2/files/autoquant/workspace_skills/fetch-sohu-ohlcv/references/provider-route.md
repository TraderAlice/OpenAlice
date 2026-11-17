# Sohu historical-quotes route

Observed route:

```text
https://q.stock.sohu.com/hisHq
  ?code=cn_<six-digit-code>
  &start=YYYYMMDD
  &end=YYYYMMDD
  &stat=1
  &order=D
  &period=d
  &callback=historySearchHandler
  &rt=jsonp
```

The July 2026 JSONP returned reverse-chronological rows containing date, open,
close, change, change percentage, low, high, volume in 100-share lots, traded
value in ten-thousand CNY, and turnover rate. The route uses GB18030 bytes.
This is observed web behavior, not a stable public API contract.
