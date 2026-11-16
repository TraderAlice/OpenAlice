# Nikkei recent four-price history

Observed route:

```text
https://www.nikkei.com/nkd/company/history/dprice/?scode=<code>&ba=<market>
```

The 2026-07 page declared “過去1カ月の四本値” and exposed a table with:

```text
日付 始値 高値 安値 終値 売買高 修正後終値
```

Dates omit the year, so the executable route requires the page's explicit
`YYYY年M月D日` as-of label and resolves only the current/previous-year boundary.
The route is recent displayed data, not an entitlement, stable API, JPX
calendar, or long-history contract.
