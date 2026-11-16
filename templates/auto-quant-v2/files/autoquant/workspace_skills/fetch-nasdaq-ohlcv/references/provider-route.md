# Nasdaq.com historical route

The observable route is:

```text
https://api.nasdaq.com/api/quote/<symbol>/historical
```

with `assetclass=stocks|etf`, ISO `fromdate`, inclusive `todate`, and a bounded
`limit`.

Expected rows live at `data.tradesTable.rows` with `date`, `open`, `high`,
`low`, `close`, and `volume`. Values can contain currency symbols and comma
separators. The route is an observable website surface, not a promised public
API or a substitute for licensed Nasdaq Data Link products.
