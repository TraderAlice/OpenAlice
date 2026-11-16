# VNDIRECT route

The observable route is:

```text
https://api-finfo.vndirect.com.vn/v4/stock_prices
```

with a query such as:

```text
q=code:VCB~date:gte:2025-01-01~date:lte:2025-12-31
```

and explicit page/size/sort parameters.

Raw fields use `open`, `high`, `low`, and `close`; provider-adjusted fields
use `adOpen`, `adHigh`, `adLow`, and `adClose`. `nmVolume` is normal-matching
share volume and `nmValue` is normal-matching traded value in VND. Price
fields are quoted in thousand VND, which the Skill verifies from
`nmValue / nmVolume` before multiplying by 1,000.
