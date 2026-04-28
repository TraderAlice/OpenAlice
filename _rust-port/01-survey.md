# OpenAlice Analysis + Thinking Modules — Rust Port Survey

**Document Version:** 1.0  
**Date:** 2026-04-28  
**Scope:** Cataloging TypeScript surface for Rust NAPI-RS port (alice-analysis crate)  
**Status:** Read-only analysis — no modifications to TS source

---

## 1. Indicators (Technical Analysis Functions)

### Overview

All indicators live in `src/domain/analysis/indicator/functions/`. They are **pure functions** that operate on arrays or TrackedValues objects (which wrap arrays + metadata). Indicators consume the last N values (rolling window), not a full history.

#### Warm-up / Initialization Behavior

- **SMA, EMA, BBANDS, RSI, MACD, ATR**: Require a minimum number of data points.
  - **SMA(period)**: Requires ≥ `period` points. Returns a **single number** (last SMA value).
  - **EMA(period)**: Requires ≥ `period` points. Returns a **single number**.
  - **STDEV()**: Requires ≥ 1 point. No rolling window; computes on all input.
  - **MAX(), MIN(), SUM(), AVERAGE()**: Require ≥ 1 point. No rolling window; computes on all input.
  - **RSI(period)**: Requires ≥ `period + 1` points (needs price changes). Returns **[0, 100]** or NaN edge cases.
  - **BBANDS(period, stdDevMultiplier)**: Requires ≥ `period` points. Uses last `period` points only. Returns `{ upper, middle, lower }`.
  - **MACD(fastPeriod, slowPeriod, signalPeriod)**: Requires ≥ `slowPeriod + signalPeriod` points. Returns `{ macd, signal, histogram }`.
  - **ATR(highs, lows, closes, period)**: Requires ≥ `period + 1` points (needs prior close for true range). Returns **single number**.

#### NaN / Error Handling

- **No NaN filling**: All functions throw an error if minimum points not met.
- **No forward-fill or zero-fill**: Empty result = error, not 0 or NaN.
- **VOLUME**: null values in source data are converted to 0 (see data-access.ts line 55).
- **Division by zero**: 
  - RSI: If avgLoss === 0 (all gains, no losses), returns 100.
  - Binary ops: Division by zero throws "Division by zero" error.

#### Precision / Rounding

- **Default precision**: 4 decimal places (`parseFloat(value.toFixed(4))`).
- **Customizable**: Via `precision` parameter in `IndicatorCalculator.calculate()`.
- **Applied to**: Scalars, arrays, and object values (e.g., BBANDS record).
- **Method**: `parseFloat(value.toFixed(n))` — not banker's rounding, standard rounding.

#### Rolling Window Semantics

- **SMA**: Last `period` points only. `slice(-period)`.
- **EMA**: Full history used. Starts with SMA of first `period`, then applies exp weight.
- **STDEV**: All input points. No rolling window.
- **MAX, MIN, SUM, AVERAGE**: All input points. No rolling window.
- **RSI**: Full history. Computes gains/losses for all diffs, then smooths with EMA-like average.
- **BBANDS**: Last `period` points only for mean/variance.
- **MACD**: Full history for EMA computations, but final value is scalar (not array).
- **ATR**: Uses all points; computes true range for each bar, then smooths.

#### Summary Table

| Indicator | Signature | Min Points | Return Type | Rolling Window | Special Cases |
|-----------|-----------|-----------|-------------|---------|---------|
| **SMA** | `SMA(data, period)` | ≥ period | `number` | Last period only | None |
| **EMA** | `EMA(data, period)` | ≥ period | `number` | Full history (exp weight) | None |
| **STDEV** | `STDEV(data)` | ≥ 1 | `number` | All | None |
| **MAX** | `MAX(data)` | ≥ 1 | `number` | All | None |
| **MIN** | `MIN(data)` | ≥ 1 | `number` | All | None |
| **SUM** | `SUM(data)` | ≥ 1 | `number` | All | None |
| **AVERAGE** | `AVERAGE(data)` | ≥ 1 | `number` | All | None |
| **RSI** | `RSI(data, period=14)` | ≥ period+1 | `number` [0,100] | Full (smooth gains/losses) | avgLoss=0 → 100 |
| **BBANDS** | `BBANDS(data, period=20, stdDev=2)` | ≥ period | `{upper, middle, lower}` | Last period | None |
| **MACD** | `MACD(data, fast=12, slow=26, signal=9)` | ≥ slow+signal | `{macd, signal, histogram}` | Full (two EMAs) | None |
| **ATR** | `ATR(highs, lows, closes, period=14)` | ≥ period+1 | `number` | Full (smooth) | Needs 3 aligned arrays |

---

## 2. Formula Language (IndicatorCalculator Parser)

### Tokenizer & Lexical Rules

**Location:** `src/domain/analysis/indicator/calculator.ts:79–234` (inline recursive descent parser)

- **Whitespace**: Ignored (consumed by `skipWhitespace()`).
- **Numbers**: `[-]?\d+\.?\d*` (integers and decimals, unary minus supported).
- **Strings**: Single or double quotes; no escape sequences; unterminated → error.
- **Identifiers** (function names): `[a-zA-Z_][a-zA-Z0-9_]*`.
- **Operators**: `+`, `-`, `*`, `/`, `(`, `)`, `[`, `]`, `,`.
- **No other tokens**: Anything else → parse error.

### Operator Precedence (Highest to Lowest)

1. **Array access** `[ ]` — parsed as postfix (highest)
2. **Multiplication / Division** `*`, `/`
3. **Addition / Subtraction** `+`, `-` (lowest)

**Associativity**: Left-to-right for all operators.  
**Example**: `2 + 3 * 4` → `(2 + (3 * 4))` = 14 (not 20).

### Grammar (Recursive Descent)

```
Expression  → Term (('+' | '-') Term)*
Term        → Factor (('*' | '/') Factor)*
Factor      → '(' Expression ')'
            | String
            | Number
            | FunctionOrIdentifier
FunctionOrIdentifier → Identifier ('(' Arguments? ')')?
                    → followed by optional '[' Index ']'
Arguments   → Expression (',' Expression)*
```

### Supported Functions

#### Data Access (Async, Return TrackedValues)
- `CLOSE(symbol, interval)` → array of closing prices
- `HIGH(symbol, interval)` → array of highs
- `LOW(symbol, interval)` → array of lows
- `OPEN(symbol, interval)` → array of opens
- `VOLUME(symbol, interval)` → array of volumes (null → 0)

#### Statistics (Return Single Number)
- `SMA(data, period)` → number
- `EMA(data, period)` → number
- `STDEV(data)` → number
- `MAX(data)` → number
- `MIN(data)` → number
- `SUM(data)` → number
- `AVERAGE(data)` → number

#### Technical Indicators (Return Single Number or Object)
- `RSI(data, period=14)` → number [0, 100]
- `BBANDS(data, period=20, stdDev=2)` → `{ upper, middle, lower }`
- `MACD(data, fast=12, slow=26, signal=9)` → `{ macd, signal, histogram }`
- `ATR(highs, lows, closes, period=14)` → number

### Error Modes

**Parse Errors** (thrown immediately):
- Unexpected character at position X
- Unterminated string
- Expected ')' or ']'
- Unknown identifier (function call without parens)

**Evaluation Errors** (thrown at runtime):
- Unknown function name
- Insufficient data points for indicator
- Array index out of bounds
- Division by zero
- Binary operation on non-numbers (e.g., `array + 1`)
- Array access on non-array
- Final result is string (not a number or array)

### Input/Output Types

- **Input**: Formula string, optional precision (default 4).
- **Output**: `{ value, dataRange }` where:
  - `value`: `number | number[] | Record<string, number>`
  - `dataRange`: `Record<symbol, DataSourceMeta>` (tracks which symbols were fetched and their date ranges)

---

## 3. Thinking Evaluator (Safe Expression Calculator)

**Location:** `src/domain/thinking/tools/calculate.tool.ts`

### Arithmetic Semantics

- **Allowed**: `+`, `-`, `*`, `/`, `()`, decimal numbers, whitespace.
- **Forbidden**: Variables, function calls (alert, console.log, etc.), operators (&&, ||, ;, etc.), identifiers.
- **Security**: Strict regex whitelist: `^[\d+\-*/().\s]+$`. Anything else → error.

### Precision & Rounding

- **Fixed precision**: Always 4 decimal places.
- **Method**: `Math.round(result * 10000) / 10000`.
- **No customization**: Hardcoded, not parameterized.

### Error Handling

- **Invalid expression**: Non-matching regex → "Invalid expression: only numbers and basic operators allowed".
- **Non-finite result** (Infinity, NaN): "Invalid calculation result".
- **Other eval errors**: Wrapped as "Calculation error: [original message]".

### Key Distinction from Indicator Calculator

- **No function calls, no data fetching, no arrays**.
- **Pure arithmetic only** — used for safe LLM-controlled calculations (risk management, position sizing, etc.).
- **Hard-coded 4-decimal precision** (not customizable).

---

## 4. Public API Surface (Tool Wrappers)

### src/tool/analysis.ts — createAnalysisTools()

**Signature:**
```typescript
createAnalysisTools(
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
  commodityClient: CommodityClientLike,
)
```

**Exports:**
```typescript
{
  calculateIndicator: Tool<{
    asset: 'equity' | 'crypto' | 'currency' | 'commodity'
    formula: string
    precision?: number (0–10, default 4)
  }, {
    value: number | number[] | Record<string, number>
    dataRange: Record<string, DataSourceMeta>
  }>
}
```

**Behavior:**
- Builds `IndicatorContext` from asset class + clients.
- Fetches OHLCV data on-demand for each symbol in formula.
- No caching — fresh fetch per call.
- **Calendar days by interval** (line 15–30):
  - `1d` → 730 days (2 years)
  - `1w` → 1825 days (5 years)
  - `1h` → 90 days
  - `1m` → 30 days
  - Custom multiples (e.g., `5d` → 5 × 730 = 3650 days)

**Data filtering** (line 67–70):
- Drops bars where close/open/high/low is null.
- VOLUME null → 0 (in data-access.ts, not here).

### src/tool/thinking.ts — createThinkingTools()

**Signature:**
```typescript
createThinkingTools()
```

**Exports:**
```typescript
{
  calculate: Tool<{
    expression: string
  }, number>
}
```

**Behavior:**
- Pure arithmetic evaluation.
- 4-decimal precision (hardcoded).
- No parameters, single tool.

### src/domain/analysis/index.ts (Public Exports)

```typescript
export { IndicatorCalculator }
export type { IndicatorContext, OhlcvData }
```

Only exports the calculator class and context interface. Types for AST, results, etc., are internal.

---

## 5. Test Fixtures & Parity Oracles

### Unit Tests — calculator.spec.ts

**Location:** `src/domain/analysis/indicator/calculator.spec.ts`

**Mock Data:**
- 50 bars, dates 2025-01-01 to 2025-02-19.
- Close: 100–149 (linear ramp).
- Open: same. High: +2. Low: –1.
- Volume: 1000–1490 (null at bar 48).

**Test Groups & Fixtures:**

| Group | Tests | Key Fixture |
|-------|-------|-----------|
| **arithmetic** | 11 tests | Operator precedence, parentheses, negative numbers, division by zero |
| **data access** | 5 tests | CLOSE/HIGH/LOW/OPEN/VOLUME with 50-bar array |
| **array access** | 3 tests | Index [0], [-1], [-2], out-of-bounds error |
| **statistics** | 7 tests | SMA/EMA/STDEV/MAX/MIN/SUM/AVERAGE on 50-bar array |
| **technical indicators** | 4 tests | RSI (0–100), BBANDS (3-field object), MACD (3-field object), ATR (positive) |
| **complex expressions** | 3 tests | Nested calls, percent deviation formula, double quotes |
| **precision** | 5 tests | Default 4, custom 2, 0 (integer) |
| **dataRange** | 3 tests | Symbol tracking, multi-symbol, empty on pure arithmetic |
| **errors** | 7 tests | String result, unknown function, parse errors, binary ops on arrays |

**Expected Values (50-bar mock):**
- SMA(close, 10) → 144.5 (avg of last 10: 140–149)
- AVERAGE(close, 50) → 124.5 (avg of 100–149)
- MAX(close) → 149
- MIN(close) → 100
- SUM(close) → 6225 (sum 100+101+...+149)
- RSI(close, 14) → >90 (strong uptrend)
- BBANDS: upper > middle > lower (monotonic)
- STDEV(close) ≈ 14.43
- ATR: positive, reasonable range

### Unit Tests — calculate.tool.spec.ts

**Location:** `src/domain/thinking/tools/calculate.tool.spec.ts`

**Test Groups:**

| Group | Tests | Key Fixture |
|-------|-------|-----------|
| **basic arithmetic** | 4 tests | +, –, *, / |
| **parentheses** | 2 tests | (1+2)*3, 10/(2+3) |
| **precision** | 4 tests | 10/3 → 3.3333, decimals in input |
| **security** | 3 tests | alert(), console.log(), x+1, Math.PI — all rejected |
| **edge cases** | 4 tests | Spaces, negative results, zero |

### E2E Tests — analysis.bbProvider.spec.ts

**Location:** `src/domain/market-data/__tests__/bbProviders/analysis.bbProvider.spec.ts`

**Real Data** (yfinance, FMP):
- AAPL daily (equity): 100+ bars, current price, dataRange.to is recent (<7 days)
- BTCUSD daily (crypto): 100+ bars, reasonable price range
- gold, crude_oil (commodity, yfinance): 100+ bars, recent data (≥ 2026)
- gold via FMP: Separate test suite; data must be current (≥ 2026), catches 2022-data regression

**Key Test Scenarios:**
- Single indicator per asset: CLOSE[-1], SMA(50), RSI(14), BBANDS(20,2), ATR
- Crypto assets: BTCUSD, ETHUSD
- Commodity canonical names: 'gold', 'crude_oil' (not ticker symbols)
- dataRange validation: symbol presence, bar count, date recency
- FMP credential gating (hasCredential skip)

**Parity Assertion:** If TS result is X for AAPL CLOSE[-1] and dataRange.AAPL.to is recent, Rust must return the same X (within precision).

---

## 6. Weird Corners & Design Quirks

### 1. **TrackedValues Wrapper — Implicit Data Provenance**
   - Functions return `TrackedValues = { values: number[], source: DataSourceMeta }`.
   - Indicator functions unwrap with `toValues()`, but the wrapper is re-wrapped on data access.
   - Rust must preserve this: **each data-fetch carries metadata that bubbles up to the result**.
   - Tools only export final `value`, but internal calculator tracks `dataRange` separately.

### 2. **Precision Loss Boundary — Last EMA in MACD**
   - MACD recomputes EMA for every slice (slow + expensive).
   - Precision is applied **after** entire calculation, so rounding happens once at the end.
   - Rust should replicate exact TS floating-point order or tests may diverge.

### 3. **RSI Edge Case — All-Gains (avgLoss = 0)**
   - If data is strictly increasing, avgLoss stays 0.
   - Hard-coded return `100` (not NaN, not undefined).
   - Rust must match: avgLoss == 0 → RSI = 100.

### 4. **BBANDS Uses Last N Points, Not Full History**
   - Unlike RSI/MACD (which use full history), BBANDS only sees last `period` candles.
   - This affects results on very long datasets.

### 5. **ATR True Range Computation — Previous Close Needed**
   - `TR = max(H - L, abs(H - C_prev), abs(L - C_prev))`
   - Loop starts at `i=1` (bar 1, not bar 0), because bar 0 has no previous close.
   - **First close is never used for TR** — array must be ≥ period+1.

### 6. **VOLUME Null Handling — Specific, Not Generic**
   - Only VOLUME converts null → 0 (line 55 of data-access.ts).
   - CLOSE/HIGH/LOW/OPEN never see null (data filtered in tool layer, line 67–70).
   - No generic "null = 0" rule — it's explicit per function.

### 7. **Negative Array Indices — Python-Like**
   - `CLOSE('AAPL', '1d')[-1]` is last element.
   - `[-2]` is second-to-last.
   - Implemented as `index < 0 ? length + index : index` (line 343).
   - Out-of-bounds → error (not wrapping).

### 8. **No Operator Overloads for Arrays**
   - `SMA(...) + 1` throws error (cannot add array + number).
   - You must use `SMA(...)` (returns scalar) or array access `CLOSE(...)[-1]` (returns scalar).
   - Vectors are **not** element-wise operations.

### 9. **Formula Result Type Ambiguity**
   - Caller doesn't know if result is scalar or array without parsing.
   - Tool documentation says: "Statistics → scalar, do NOT use [-1]".
   - "Data access → array, use [-1] for latest".
   - **Rust API must encode this or mirror TS's permissiveness (allow [-1] but error if not array)**.

### 10. **Division by Zero — Only in Binary Op, Not in Functions**
   - `/` operator throws immediately.
   - Functions never divide (STDEV divides in variance, but uses / internally).
   - **Rust must reproduce: eager div-by-zero check in binary op executor**.

### 11. **Empty dataRange on Pure Arithmetic**
   - If formula is `2 + 3`, dataRange is `{}` (empty).
   - If formula fetches symbols, they are all added to dataRange.
   - **Rust must track data-access calls and bubble source metadata**.

### 12. **Precision Parameter Type & Clamping**
   - Tool schema clamps to [0, 10] (`z.number().int().min(0).max(10)`).
   - Precision is always an integer.
   - TS uses `toFixed(precision)` then `parseFloat()` to avoid trailing zeros.

### 13. **Calendar Calculation for Data Fetch is Deterministic**
   - E.g., `1d` → 730 days (not "approx 2 years").
   - Uses Date math; start date is computed at call time (relative to today).
   - Rust should match: e.g., `now - 730 days` for `1d` interval.

---

## 7. Missing / Disabled Features (Not in Scope)

- **Rolling OHLC windows** (e.g., "last 5 closes as array") — CLOSE returns 50 bars, not a sliding window.
- **Parameter validation** — Rust will need to replicate period bounds (e.g., RSI ≥ period+1).
- **Async generators / streaming results** — Formula evaluator is fully async but returns final value only.
- **Think / Plan / reportWarning / getConfirm tools** — Commented as "low usage, overlaps with architecture" (src/tool/thinking.ts).
- **Custom precision in thinking.calculate** — Hard-coded to 4 decimals.

---

## 8. Files to Port & Dependencies

### Core Files to Port (TS → Rust)

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/domain/analysis/indicator/calculator.ts` | Parser, AST, evaluator | types.ts, functions/* |
| `src/domain/analysis/indicator/functions/statistics.ts` | SMA, EMA, STDEV, MAX, MIN, SUM, AVERAGE | types.ts |
| `src/domain/analysis/indicator/functions/technical.ts` | RSI, BBANDS, MACD, ATR | types.ts, statistics.ts |
| `src/domain/analysis/indicator/types.ts` | Type definitions (OhlcvData, IndicatorContext, ASTNode, etc.) | — |
| `src/domain/thinking/tools/calculate.tool.ts` | Safe arithmetic evaluator | — (pure function) |

### Tool Wrappers (TS Only, Not Ported)

| File | Purpose | Status |
|------|---------|--------|
| `src/tool/analysis.ts` | createAnalysisTools() — wraps IndicatorCalculator | **Stay in TS**, call NAPI |
| `src/tool/thinking.ts` | createThinkingTools() — wraps calculate() | **Stay in TS**, call NAPI |

### Test Fixtures (Reference for Parity)

| File | Purpose | Parity Oracle? |
|------|---------|--------|
| `src/domain/analysis/indicator/calculator.spec.ts` | Unit tests (50-bar mock) | ✓ Exact numerical parity |
| `src/domain/thinking/tools/calculate.tool.spec.ts` | Arithmetic safety tests | ✓ Exact match |
| `src/domain/market-data/__tests__/bbProviders/analysis.bbProvider.spec.ts` | E2E cross-asset (real data) | ✓ Value range + dataRange shape |

---

## 9. Architecture Notes for Rust Port

### NAPI Bridge

1. **Input**: Rust receives formula string + optional precision (serialized from TS).
2. **Data Fetching**: Stays in TS layer (via callback or separate data service).
3. **Output**: Rust returns `{ value, dataRange }` (serialize back to TS).
4. **Async**: NAPI must handle async formula evaluation (data fetches inside parser/evaluator).

### Decimal Handling

- **TS uses f64 (JavaScript number)**: No decimal.js in indicator logic; only in trading domain.
- **Rust u64/f64 parity**: Match TS floating-point order and rounding.
- **Precision control**: Implement same `toFixed(n) → parseFloat()` pattern.

### Error Propagation

- **Parse errors**: Return error to TS immediately.
- **Eval errors** (insufficient data, div by zero): Propagate to TS.
- **Data fetch errors**: Should be caught in TS layer (via IndicatorContext callback).

### Array / Vector Handling

- **Rust Vec<f64>** ↔️ **TS number[]**.
- **TrackedValues**: May serialize as `{ values: [...], source: {...} }` or keep internal.
- **NAPI serialization**: Determine JSON schema for dataRange (symbol → {from, to, bars}).

---

## Summary: Contract for Rust Port

**The Rust crate `alice-analysis` must:**

1. ✓ Parse formula strings with same grammar (operators, functions, arrays, strings).
2. ✓ Implement all 11 indicators with identical warm-up, NaN, precision, rolling-window behavior.
3. ✓ Evaluate formulas asynchronously (data fetches are async).
4. ✓ Return `{ value, dataRange }` with identical structure.
5. ✓ Pass unit test parity (50-bar mock fixture values must match exactly or within precision tolerance).
6. ✓ Pass E2E parity (real AAPL/BTCUSD/gold data must produce same results as TS).
7. ✓ Implement safe arithmetic calculator with hardcoded 4-decimal precision.
8. ✓ Error messages and error paths should match TS (for debugging and integration tests).

---

## References

- **Indicator implementations**: `src/domain/analysis/indicator/functions/statistics.ts`, `technical.ts`
- **Parser/evaluator**: `src/domain/analysis/indicator/calculator.ts` (lines 79–350)
- **Tool surface**: `src/tool/analysis.ts`, `src/tool/thinking.ts`
- **Unit fixtures**: `src/domain/analysis/indicator/calculator.spec.ts` (327 lines)
- **E2E fixtures**: `src/domain/market-data/__tests__/bbProviders/analysis.bbProvider.spec.ts` (159 lines)
- **Type contracts**: `src/domain/analysis/indicator/types.ts`
