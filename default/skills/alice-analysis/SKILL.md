---
name: alice-analysis
description: >
  How to compute technical analysis with OpenAlice's Quant Calculator (v2) via
  `alice analysis` — a small Python/pandas-subset scripting language over
  K-lines, keyed by barId so you compute on a SPECIFIC source — prefer a
  broker's bars (matches what you trade, realtime) over a free vendor like
  yfinance (delayed fallback) — and can batch many
  timeframes/symbols/indicators in ONE call. Use whenever the task is
  technical/quantitative on price data: "RSI on BTC", "is AAPL above its
  200-day", "50/200 golden cross check", "multi-timeframe momentum", "how
  extended is X (z-score)", "does this track the sector (correlation)", "trend
  strength", "compare 1h/4h/12h at once". Reach it with
  `alice analysis search-bars` (find a barId) then `alice analysis quant`
  (compute).
---

# `alice analysis` — Quant Calculator (v2)

A bounded, side-effect-free expression language for technical analysis. You write
a short script; it fetches K-lines by **barId** and returns a value (or a panel
of values). Get barIds from `alice analysis search-bars` first.

## The loop

```bash
alice analysis search-bars --query AAPL
# Pick a broker barId if one came back (realtime, matches your fills); fall back to a vendor only if not.
alice analysis quant --script $'s = bars("alpaca-paper|AAPL", "1d", count=250)\nsma(s.close, 50)'
```

## Choosing a source

`search-bars` federates broker bars and vendor bars (freshest-first). Pick in
this order:

1. **A broker you actually trade** (`barCapability: "realtime"`) — freshest, and
   the chart matches your fills. Always prefer this when it's in the results.
2. **A paid vendor** (`fmp`, …) when no broker source exists.
3. **`yfinance` — free fallback only.** Its end-of-day bars can lag a **day or
   two**, so never use it for anything time-sensitive (a fresh signal, an entry
   check) or to chart a live position when a broker source is available.

Vendor barIds (`yfinance|…`, `fmp|…`) need `asset=`; broker barIds infer it.
Keyless exchange data sources such as `binance-readonly` are opt-in in
Trading settings, so do not assume they exist before `search-bars` returns them.

**No candidates for a non-US symbol?** `search-bars` only fans out over the
vendors that are *on*. A Taiwan or CN A-share searched by its native name can
come back empty just because its vendor is off — `alice market vendors` to see
what's available, `alice market vendor-set --vendor twse --enabled true` to add
it (live immediately), then re-run search-bars. See the `alice` skill.

## Language

A script is zero or more `name = ...` bindings, then a final result expression:

```python
s = bars("alpaca-paper|AAPL", "1d", count=250)
sma(s.close, 50) - sma(s.close, 200)        # +ve = 50 above 200 (uptrend)
```

**`bars(barId, interval, count=, asOf=, start=, end=, asset=)`**
- `barId`: `"{source}|{symbol}"` from search-bars. Broker (`alpaca-paper|AAPL`)
  or opt-in keyless exchange data (`binance-readonly|BTC/USDT`) needs NO
  `asset=`; vendor (`yfinance|AAPL`, `fmp|AAPL`) needs
  `asset="equity"|"crypto"|"currency"|"commodity"`.
- `interval`: `1m 5m 15m 30m 1h 4h 1d 1w`.
- Window: `count=N` (most-recent N bars — the natural window for indicators), OR
  `start=/end=` (YYYY-MM-DD date range), OR `end=+count=` (point-in-time backtest).

**Columns** of a bars() series: `s.open / s.high / s.low / s.close / s.volume`.

**Indexing:** raw columns are series — index them: `s.close[-1]` (latest),
`s.close[-2]` (one back). **Indicators already return the latest scalar — do NOT
index them** (`sma(s.close, 50)`, not `sma(...)[-1]`).

**Arithmetic:** `+ - * /`, parentheses, unary minus.

## Panels — batch many computations in one call

The result can be a **labeled dict** or a **positional list** (each entry a single
value, max 200). Use this instead of calling the tool N times:

```python
h1 = bars("yfinance|BTC-USD", "1h", count=250, asset="crypto")
h4 = bars("yfinance|BTC-USD", "4h", count=250, asset="crypto")
d1 = bars("yfinance|BTC-USD", "1d", count=250, asset="crypto")
{ "1h": rsi(h1.close, 14), "4h": rsi(h4.close, 14), "1d": rsi(d1.close, 14) }
```
→ `{ "1h": 53.2, "4h": 48.9, "1d": 61.4 }`

## Sibling verbs — dated reads & backtests

`quant` returns latest scalars with no dates. When you need the time axis or a
hypothetical trade, reach for these instead (see the `retrospective` skill for
the full workflow):

- **`alice analysis snapshot --query XLE [--asOf YYYY-MM-DD]`** — the honest
  as-of read: DATED bars (never past `asOf` — no lookahead), the latest print
  (close + vs-prevClose + day high/low + amplitude), compact levels, and a
  **freshness contract** (`isLatestActual` / `staleTradingDays`). Use this for
  "what does/did X look like", not a hand-rolled quant dump.
- **`alice analysis simulate --query XLE --entryDate … --exitRule …`** —
  backtest one entry + one exit (`trailing_stop`/`ma_break`/`stop`/`target`/
  `hold`); returns entry/exit, returnPct, MFE/MAE.
- **`alice analysis quant … --dates`** — opt-in date axis on a quant result
  (`dates[barId]`), to map a dumped series back to days.

## Function catalog

| Group | Functions |
|---|---|
| Trend | `sma(s, n)` `ema(s, n)` `macd(s, fast, slow, signal)` `slope(s, n)` (signed, rankable trend) |
| Momentum | `rsi(s, n=14)` `roc(s, n)` (% change over n) |
| Volatility | `stdev(s)` `atr(high, low, close, n)` `bbands(s, n, std)` `zscore(s, n?)` (how extended vs window) |
| Volume | `rvol(volume, n=20)` `obv(close, volume)` `mfi(high, low, close, volume, n=14)` `vwap(high, low, close, volume)` |
| Stats | `max/min/sum/average/median(s)` `highest(s, n)` `lowest(s, n)` |
| Comparison | `correlation(a, b)` (−1..1; relative strength / pairs / "tracks the sector?") |

Records: `bbands` → `{upper, middle, lower}`; `macd` → `{macd, signal, histogram}`.

## Examples

> Examples below use `yfinance|…` for brevity (it's always available without a
> broker). When you have a broker source for the symbol, swap its barId in —
> see *Choosing a source*.

```python
# Momentum % over the last 20 bars
s = bars("yfinance|AAPL", "1d", count=60, asset="equity")
roc(s.close, 20)

# How overbought/oversold vs the trailing 20 sessions
s = bars("yfinance|TSLA", "1d", count=60, asset="equity")
zscore(s.close, 20)

# Does this token move with BTC? (relative strength)
btc = bars("yfinance|BTC-USD", "1d", count=90, asset="crypto")
sui = bars("yfinance|SUI-USD", "1d", count=90, asset="crypto")
correlation(btc.close, sui.close)

# A one-call dashboard
s = bars("yfinance|NVDA", "1d", count=250, asset="equity")
{
  "rsi":        rsi(s.close, 14),
  "roc_20d_%":  roc(s.close, 20),
  "vs_200ma":   s.close[-1] - sma(s.close, 200),
  "trend":      slope(s.close, 50),
  "z_20d":      zscore(s.close, 20),
  "atr_14":     atr(s.high, s.low, s.close, 14),
}
```

## Self-correction

On failure the tool returns `{ error: { kind, message, suggestion } }`, not a
crash — read it and fix the script. It pinpoints the problem: unknown function
(with "did you mean"), wrong arity/type, insufficient bars (raise `count=`),
undeclared name, and common Python reflexes (`s.close.rolling(50).mean()` →
"use `sma(s.close, 50)`"; `sma(...)[-1]` → "drop the [-1]"; slices/`if` → not
supported here).

## Gotchas

- Indicators return the latest **scalar** — never `[-1]` them; only raw columns
  are series.
- Vendor barIds need `asset=`; broker barIds infer it.
- **Source freshness:** `yfinance`/`fmp` are delayed (yfinance EOD can lag a day
  or two). Prefer a broker barId for anything you trade or anything time-sensitive.
- No conditionals/booleans (no `if`, no crossover operator) — compute the parts
  and compare in your own reasoning, or return them in a panel.
- For arbitrary/looping logic beyond these primitives, spawn a separate
  Auto-Quant workspace, not this tool.
