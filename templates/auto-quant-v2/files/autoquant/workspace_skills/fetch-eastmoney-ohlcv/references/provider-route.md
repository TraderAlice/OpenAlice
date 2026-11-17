# Eastmoney route evidence

## Observable request

The narrow route used by this Skill is:

```text
https://push2his.eastmoney.com/api/qt/stock/kline/get
```

It requests:

- `klt=101` — observed daily interval;
- `fqt=0` — raw price history;
- `fields2=f51,...,f61`;
- an inclusive provider `beg`/`end`, derived from the caller's
  start/end-exclusive range.

Observed row fields are:

| Field | Meaning used by this Skill |
| --- | --- |
| `f51` | session date |
| `f52` | open |
| `f53` | close |
| `f54` | high |
| `f55` | low |
| `f56` | volume in lots |
| `f57` | amount in CNY |
| `f58` | amplitude |
| `f59` | percentage change |
| `f60` | absolute change |
| `f61` | turnover percentage |

This is observable behavior, not a stable public API contract. Preserve the
raw bytes and fail closed on a field or unit change.

## Volume proof

The output CSV uses shares so that close-times-volume has a coherent CNY
notional meaning. For each nonzero row the script computes:

```text
derived_vwap = f57_amount / (f56_lots × 100)
```

and requires the result to lie inside the reported low/high interval, allowing
only a tiny rounding tolerance. This makes the conversion auditable without
pretending that the endpoint is official schema authority.

## Terms boundary

Eastmoney's service agreement and the underlying exchanges may restrict
copying, redistribution, or derivative use of market data. This open-source
Skill distributes procedure only, not acquired bytes or a data licence. The
caller must supply the terms statement retained in the package.
