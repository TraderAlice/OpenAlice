# Euronext Live historical route

Official discovery page:

https://live.euronext.com/en/popout-page/getHistoricalPrice/FR0000121014-XPAR

The page's download form calls:

```text
/en/ajax/AwlHistoricalPrice/getFullDownloadAjax/<ISIN-MIC>
```

The field trial requests CSV with decimal separator `.`, date form `d/m/Y`,
an explicit `adjusted=Y|N`, and exact `startdate`/`enddate`. The downloaded
file declares the range, repeats the ISIN, and exposes `Date`, OHLC, `Last`,
`Close`, `Number of Shares`, `Number of Trades`, `Turnover`, and `vwap`.

The page displayed a two-year download limit for Euronext markets other than
Milan and a five-day limit for Milan during the 2026-07 field trial. Treat
those limits and endpoint shape as mutable provider behavior.
