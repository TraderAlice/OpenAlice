# Fix log — IBKR Japanese-stock paper trading & market-data history (2026-06-01)

## Goal

Enable paper-trading **Japanese (TSE) stocks** through OpenAlice, with Alice
doing analysis and IBKR (Interactive Brokers) **Free Trial paper account**
doing execution. Real-time data not required (delayed data is fine).

Connection setup (no code): IBKR Free Trial → IB Gateway on Linux (API socket,
paper port `4002`) → OpenAlice `ibkr-tws` connector at `127.0.0.1:4002`.
Account came up healthy (`ibkr-tws-bb10d614`, $1M paper). Everything below is
the code work needed to make quotes, ordering, and analysis actually function
for non-USD (TSE/JPY) instruments.

## Summary of commits

| Commit | Area | One-liner |
|--------|------|-----------|
| `c143cd7` | IBKR quotes | getQuote works for conId-resolved & non-USD (TSE) contracts |
| `215007d` | IBKR orders | order placement & read-back for non-USD contracts |
| `9975a44` | Indicator data | extend historical lookback for W/M/Q intervals |
| `6fb6e6a` | opentypebb schema | allow null close in currency historical |

---

## 1. `c143cd7` — getQuote for conId-resolved & non-USD contracts

**Symptom:** `getQuote` for any IBKR contract failed with IBKR error 321
("The symbol or the local-symbol or the security id must be entered"); after
that was fixed, JP quotes returned all-zeros.

**Root causes & fixes:**
- `UnifiedTradingAccount._expandAliceIdIfNeeded` — the override-copy loop only
  skipped `''`/`null`/`undefined`, so `new Contract()`'s default `conId=0`
  clobbered the conId resolved from the aliceId. The broker received an empty
  contract. **Fix:** also skip `value === 0` (all Contract numeric fields
  default to 0 = "unset"). *This was the root cause of error 321.*
- `IbkrBroker.getContractDetails` — only force the USD currency default when
  resolving by symbol; forcing it on conId lookups excluded JPY/TSE listings.
- `IbkrBroker.getQuote` — hydrate conId-only contracts via reqContractDetails
  before reqMktData; call `reqMarketDataType(3)` (delayed) so accounts without
  a real-time subscription still get prices; fall back `last → close` outside
  trading hours.
- `request-bridge.ts` `tickPrice`/`tickSize` — map delayed tick types
  (`DELAYED_BID 66` … `DELAYED_CLOSE 75`) and `CLOSE 9`, not just real-time
  `BID`/`ASK`/`LAST`/`VOLUME`.
- `ibkr-types.ts` — add `close` to `TickSnapshot`.

**Verified:** 7203.T (TSEJ/JPY) → ¥2,909.1; AAPL → $309.65 (no US regression).

**Gotcha for JP stocks:** `searchContracts("7203")` returns empty
(`reqMatchingSymbols` doesn't match numeric JP tickers). Resolve via
`getContractDetails(source=ibkr, symbol=7203, secType=STK, currency=JPY)`.

---

## 2. `215007d` — order placement & read-back for non-USD contracts

**Symptom:** placing `BUY 100 NRI (4307.T) LMT @5200` was rejected with IBKR
error 478 (parameter conflict); after that, `getOrders` threw
`order.totalQuantity.equals is not a function`.

**Root causes & fixes:**
- `IbkrBroker.placeOrder` — a conId-resolved contract could carry a stale
  display symbol ("NRI") and the default USD currency, conflicting with what
  the conId actually is (4307/JPY) → error 478. **Fix:** re-resolve the full
  contract from a clean conId-only `reqContractDetails` query before ordering
  so symbol/exchange/currency always agree.
- `tool/trading.ts` `summarizeOrder` — orders fetched over HTTP from the UTA
  service arrive as JSON with Decimal fields serialized to **strings**, so
  `.equals()`/`.toFixed()` on `order.totalQuantity` threw. **Fix:** rehydrate
  each Decimal field via a `toDec()` coercion before formatting.

**Verified end-to-end:** staged → `tradingCommit` → `tradingPush` → **manual
approval** (Web UI "Trading as Git" → "Approve & Push" → "Confirm"; Telegram
is not connected, only the `web` connector) → IBKR accepted → `getOrders`
reads back `status=Submitted` (resting, TSE closed).

---

## 3. `9975a44` — extend historical lookback (W/M/Q intervals)

**Symptom:** `calculateIndicator` could only reach ~1 year of weekly/monthly
bars (e.g. `CLOSE('SPY','1M')` returned ~13 bars), making 5-year comparisons
impossible.

**Root cause:** `getCalendarDays` in `tool/analysis.ts` matched intervals with
`/^(\d+)([dwhm])$/`, but the real interval enum uses **uppercase** `1W`/`1M`/
`1Q`. So `W`/`M`/`Q` never matched and fell through to the 365-day fallback.
The intended "weekly = 5 years" branch (lowercase `w`) was dead code, since the
enum emits `1W`. Lowercase `m` (minutes) also collided conceptually with months.

**Fix:** match the real units, case-sensitive so minutes `m` ≠ months `M`, and
give each a sensible span: days 5y, weeks 10y, months 20y, quarters 30y.

**Verified:** `CLOSE('SPY','1M')` now returns 240 monthly bars back to 2006.

---

## 4. `6fb6e6a` — allow null close in currency historical schema

**Symptom:** `CLOSE('USDJPY','1M')` threw zod
`Expected number, received null` at path `close`.

**Root cause:** `CurrencyHistoricalDataSchema` (opentypebb) had
`open/high/low/volume/vwap` nullable but `close` as a bare `z.number()`. A
single null close bar (common in FX monthly/weekly series) failed validation
for the whole response. Equity/index/commodity historical models already mark
close nullable.

**Fix:** align currency `close` to `z.number().nullable().default(null)`. Null
bars are dropped downstream by the indicator data filter.

**Verified:** `CLOSE('USDJPY','1M')` returns 240 monthly bars back to 2006.

---

## Verification artifact — 5-year comparison (all real data)

Built once the data fixes landed. S&P500 (SPY) vs All-Country (ACWI) vs NRI
(4307.T), 2021-05 → 2026-05:

| | USD 5y | JPY 5y |
|---|--------|--------|
| S&P500 | +76.7% | +155.0% |
| All-Country (ACWI) | +56.7% | +126.1% |
| NRI (4307) | — (JPY-native) | +42.1% |

USDJPY 110.535 → 159.496. Price-only (dividends excluded). Conclusion:
S&P500 ≫ All-Country ≫ NRI — US strength plus a large yen-weakening tailwind.

## Notes / follow-ups

- Capability now: JP stocks resolve/quote/order/read-back; historical reaches
  daily 5y / weekly 10y / monthly 20y / quarterly 30y; currency historical is
  null-tolerant.
- Open items: dividend-inclusive (total-return) figures; cosmetic noise in
  order read-back (`trailStopPrice` etc. echoed by TWS); IB Gateway daily
  auto-logout (automate with IBC).
- All fixes touched only the files named above; unrelated working-tree changes
  (pnpm-lock.yaml, ui/) were left untouched.
