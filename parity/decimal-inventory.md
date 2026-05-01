# Decimal / sentinel-bearing field inventory (Phase 0.7)

**Scope:** every field crossing persistence, hashing, or FFI in
`packages/ibkr/src/` + `src/domain/trading/` whose value is a `Decimal`,
a `Decimal-as-string`, or a `number` that may hold one of the three
IBKR sentinels (`UNSET_DECIMAL`, `UNSET_DOUBLE`, `UNSET_INTEGER`).

**Generated:** 2026-05-02 by `parity/scripts/scan-decimals.sh` + manual
review against the ibkr/trading source tree at branch
`migration/phase-0-fixtures`.

**Sentinel literals** (verified at
[`packages/ibkr/src/const.ts:8-13`](../packages/ibkr/src/const.ts)):
- `UNSET_DECIMAL` = `Decimal('170141183460469231731687303715884105727')` (2^127 − 1, ≈1.7e38)
- `UNSET_DOUBLE` = `Number.MAX_VALUE` (≈1.798e308)
- `UNSET_INTEGER` = `2 ** 31 - 1` (= 2147483647)

## Classification rubric

| Class | Criterion | Wire-type target (Phase 1b) |
|---|---|---|
| **(a) value-only** | Always a real value. Never compared to `UNSET_*`. | `WireDecimal::Value` only — no `Unset` variant emitted |
| **(b) value-or-unset** | Can hold either a real value or a sentinel. Source code uses `field.equals(UNSET_DECIMAL)` / `=== UNSET_DOUBLE` / `=== UNSET_INTEGER` checks. | `WireDecimal` / `WireDouble` / `WireInteger` |
| **(c) computed-only** | Derived from other fields by arithmetic. Always finite. Often already lives as `string` (canonical decimal). | string-as-canonical-decimal; verify always passes through `toCanonicalDecimalString` |

## `Order` ([packages/ibkr/src/order.ts](../packages/ibkr/src/order.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 47  | `totalQuantity`     | b | `WireDecimal` | sub-satoshi qty; `UNSET_DECIMAL` default |
| 49  | `lmtPrice`          | b | `WireDecimal` | LMT/STP_LMT only |
| 50  | `auxPrice`          | b | `WireDecimal` | STP/STP_LMT only |
| 71  | `minQty`            | b | `WireInteger` | algo orders |
| 72  | `percentOffset`     | b | `WireDouble`  | REL orders |
| 74  | `trailStopPrice`    | b | `WireDecimal` | TRAIL/TRAIL_LIMIT |
| 75  | `trailingPercent`   | b | `WireDecimal` | TRAILLIMIT |
| 95  | `startingPrice`     | b | `WireDouble`  | BOX-only |
| 96  | `stockRefPrice`     | b | `WireDouble`  | BOX-only |
| 97  | `delta`             | b | `WireDouble`  | VOL orders |
| 100 | `stockRangeLower`   | b | `WireDouble`  | VOL orders |
| 101 | `stockRangeUpper`   | b | `WireDouble`  | VOL orders |
| 107 | `volatility`        | b | `WireDouble`  | VOL orders |
| 108 | `volatilityType`    | b | `WireInteger` | 1=daily, 2=annual |
| 110 | `deltaNeutralAuxPrice` | b | `WireDouble` | VOL orders |
| 120 | `referencePriceType` | b | `WireInteger` | 1=Average, 2=Bid/Ask |
| 123 | `basisPoints`       | b | `WireDouble`  | EFP orders |
| 124 | `basisPointsType`   | b | `WireInteger` | EFP orders |
| 127 | `scaleInitLevelSize` | b | `WireInteger` | scale orders |
| 128 | `scaleSubsLevelSize` | b | `WireInteger` | scale orders |
| 129 | `scalePriceIncrement` | b | `WireDouble` | scale orders |
| 130 | `scalePriceAdjustValue` | b | `WireDouble` | scale orders |
| 131 | `scalePriceAdjustInterval` | b | `WireInteger` | scale orders |
| 132 | `scaleProfitOffset` | b | `WireDouble`  | scale orders |
| 134 | `scaleInitPosition` | b | `WireInteger` | scale orders |
| 135 | `scaleInitFillQty`  | b | `WireInteger` | scale orders |
| 180 | `triggerPrice`      | b | `WireDouble`  | adjustable trigger |
| 181 | `adjustedStopPrice` | b | `WireDouble`  | adjustable trigger |
| 182 | `adjustedStopLimitPrice` | b | `WireDouble` | adjustable trigger |
| 183 | `adjustedTrailingAmount` | b | `WireDouble` | adjustable trigger |
| 185 | `lmtPriceOffset`    | b | `WireDouble`  | discretionary up-to-limit |
| 195 | `cashQty`           | b | `WireDecimal` | cash-quantity orders |
| 209 | `filledQuantity`    | b | `WireDecimal` | populated post-fill |
| 218 | `duration`          | b | `WireInteger` | seconds |
| 219 | `postToAts`         | b | `WireInteger` | flag |
| 222 | `minTradeQty`       | b | `WireInteger` | adaptive algo |
| 223 | `minCompeteSize`    | b | `WireInteger` | adaptive algo |
| 224 | `competeAgainstBestOffset` | b | `WireDouble` | adaptive algo |
| 225 | `midOffsetAtWhole`  | b | `WireDouble`  | adaptive algo |
| 226 | `midOffsetAtHalf`   | b | `WireDouble`  | adaptive algo |
| 231 | `manualOrderIndicator` | b | `WireInteger` | manual order flag |
| 238 | `whatIfType`        | b | `WireInteger` | what-if scenario |
| 241 | `slOrderId`         | b | `WireInteger` | attached stop-loss order |
| 243 | `ptOrderId`         | b | `WireInteger` | attached take-profit order |

**Order subtotal:** 0 (a) · 44 (b) · 0 (c) · **44 fields**

`OrderComboLeg.price` (line 30, `number = UNSET_DOUBLE`) is also class (b)
but `OrderComboLeg` is rarely wire-traversed standalone. Track when
Phase 1b builds the `WireOrder` adapter — combo legs may need a nested
`WireOrderComboLeg`.

## `Contract` ([packages/ibkr/src/contract.ts](../packages/ibkr/src/contract.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 62  | `strike`                | b | `WireDouble`  | options/futures only |

**Contract subtotal:** 0 (a) · 1 (b) · 0 (c) · **1 field**

**Phase-0 finding:** PHASE0_PLAN.md §4 attributed `minSize`,
`sizeIncrement`, `suggestedSizeIncrement`, `minAlgoSize`,
`lastPricePrecision`, `lastSizePrecision` to `Contract`. They actually
live on `ContractDetails` (see below), a separate carrier returned by
`reqContractDetails()`. The plan's matrix is incorrect; my fixtures
correctly target `ContractDetails`.

## `ContractDetails` ([packages/ibkr/src/contract.ts](../packages/ibkr/src/contract.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 162 | `minSize`               | b | `WireDecimal` | crypto/forex |
| 163 | `sizeIncrement`         | b | `WireDecimal` | crypto/forex |
| 164 | `suggestedSizeIncrement` | b | `WireDecimal` | crypto/forex |
| 165 | `minAlgoSize`           | b | `WireDecimal` | adaptive algo |
| 166 | `lastPricePrecision`    | b | `WireDecimal` | display precision |
| 167 | `lastSizePrecision`     | b | `WireDecimal` | display precision |

**ContractDetails subtotal:** 0 (a) · 6 (b) · 0 (c) · **6 fields**

## `Execution` ([packages/ibkr/src/execution.ts](../packages/ibkr/src/execution.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 51  | `shares`     | b | `WireDecimal` | per-fill quantity |
| 57  | `cumQty`     | b | `WireDecimal` | cumulative qty |

**Execution subtotal:** 0 (a) · 2 (b) · 0 (c) · **2 fields**

**Phase-0 finding:** PHASE0_PLAN.md §4 attributed `lastNDays` to
`Execution`. It actually lives on `ExecutionFilter`, a separate carrier
used to *query* executions — not the executions themselves. My
fixtures correctly target `ExecutionFilter`.

## `ExecutionFilter` ([packages/ibkr/src/execution.ts](../packages/ibkr/src/execution.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 92  | `lastNDays`  | b | `WireInteger` | filter window |

**ExecutionFilter subtotal:** 0 (a) · 1 (b) · 0 (c) · **1 field**

(Execution does *not* carry `commission` directly; commission is on
`OrderState` and `CommissionAndFeesReport`. Confirmed by re-grep:
`packages/ibkr/src/execution.ts` has no `: Decimal` or `: number =
UNSET_*` lines beyond the three above.)

## `OrderState` ([packages/ibkr/src/order-state.ts](../packages/ibkr/src/order-state.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 50  | `commissionAndFees`                 | b | `WireDouble`  | margin |
| 51  | `minCommissionAndFees`              | b | `WireDouble`  | margin |
| 52  | `maxCommissionAndFees`              | b | `WireDouble`  | margin |
| 55  | `initMarginBeforeOutsideRTH`        | b | `WireDouble`  | margin |
| 56  | `maintMarginBeforeOutsideRTH`       | b | `WireDouble`  | margin |
| 57  | `equityWithLoanBeforeOutsideRTH`    | b | `WireDouble`  | margin |
| 58  | `initMarginChangeOutsideRTH`        | b | `WireDouble`  | margin |
| 59  | `maintMarginChangeOutsideRTH`       | b | `WireDouble`  | margin |
| 60  | `equityWithLoanChangeOutsideRTH`    | b | `WireDouble`  | margin |
| 61  | `initMarginAfterOutsideRTH`         | b | `WireDouble`  | margin |
| 62  | `maintMarginAfterOutsideRTH`        | b | `WireDouble`  | margin |
| 63  | `equityWithLoanAfterOutsideRTH`     | b | `WireDouble`  | margin |
| 64  | `suggestedSize`                     | b | `WireDecimal` | model |

**OrderState subtotal:** 0 (a) · 13 (b) · 0 (c) · **13 fields**

**Phase-0 finding:** PHASE0_PLAN.md §4 attributed `position`,
`positionDesired`, `positionAfter`, `desiredAllocQty`, `allowedAllocQty`
to `OrderState`. They actually live on `OrderAllocation`, a nested
array element on `OrderState.orderAllocations`. My fixtures correctly
target `OrderAllocation`. Phase 1b's `WireOrderState` adapter must
recursively wire-type the nested `OrderAllocation[]`.

## `OrderAllocation` ([packages/ibkr/src/order-state.ts](../packages/ibkr/src/order-state.ts))

| Line | Field | Class | Wire type | Notes |
|---|---|---|---|---|
| 18  | `position`         | b | `WireDecimal` | model position |
| 19  | `positionDesired`  | b | `WireDecimal` | model |
| 20  | `positionAfter`    | b | `WireDecimal` | model |
| 21  | `desiredAllocQty`  | b | `WireDecimal` | allocation |
| 22  | `allowedAllocQty`  | b | `WireDecimal` | allocation |

**OrderAllocation subtotal:** 0 (a) · 5 (b) · 0 (c) · **5 fields**

## Trading-domain monetary fields (`Decimal` and `Decimal-as-string`)

These don't live on the four IBKR carriers but DO cross persistence /
hashing / FFI. Phase 1b's adapters need to know about them.

### `Position` ([src/domain/trading/brokers/types.ts:68-80](../src/domain/trading/brokers/types.ts))

| Field | Class | Wire type | Notes |
|---|---|---|---|
| `quantity`      | a | `WireDecimal` | always real (broker emits actual position size; never `UNSET_DECIMAL`) |
| `avgCost`       | c | string-canonical | already string |
| `marketPrice`   | c | string-canonical | already string |
| `marketValue`   | c | string-canonical | always derived (qty × marketPrice) |
| `unrealizedPnL` | c | string-canonical | derived |
| `realizedPnL`   | c | string-canonical | derived |

**Note on `Position.quantity`:** classified as (a) value-only because
broker layers always emit a real number; if a future broker
implementation routes `UNSET_DECIMAL` here, the classification flips
to (b) and Phase 1b's `WireDecimal::Unset` variant must be allowed.

### `OperationResult` ([src/domain/trading/git/types.ts:33-46](../src/domain/trading/git/types.ts))

| Field | Class | Wire type | Notes |
|---|---|---|---|
| `filledQty`   | c | string-canonical | always populated post-fill; sub-satoshi must round-trip |
| `filledPrice` | c | string-canonical | always populated post-fill |

### `OpenOrder` ([src/domain/trading/brokers/types.ts:95-108](../src/domain/trading/brokers/types.ts))

| Field | Class | Wire type | Notes |
|---|---|---|---|
| `avgFillPrice` | c | string-canonical | optional; from orderStatus callback |

### `GitState` ([src/domain/trading/git/types.ts:51-58](../src/domain/trading/git/types.ts))

All five monetary fields are class (c) computed-only:
- `netLiquidation` · `totalCashValue` · `unrealizedPnL` · `realizedPnL`
- (positions/pendingOrders are object arrays, not scalars)

### `OrderStatusUpdate` ([src/domain/trading/git/types.ts:135-143](../src/domain/trading/git/types.ts))

| Field | Class | Wire type | Notes |
|---|---|---|---|
| `filledPrice` | c | string-canonical | optional |
| `filledQty`   | c | string-canonical | optional |

### `SimulationPositionCurrent`/`After` + `SimulatePriceChangeResult` ([src/domain/trading/git/types.ts:160-203](../src/domain/trading/git/types.ts))

All `string` — class (c) computed-only. Phase 1b adapters see these
during `simulatePriceChange()` round-trip; verify each goes through
`toCanonicalDecimalString` upstream.

### `Operation.closePosition` ([src/domain/trading/git/types.ts:25](../src/domain/trading/git/types.ts))

| Field | Class | Wire type | Notes |
|---|---|---|---|
| `quantity` (optional Decimal) | b | `WireDecimal` | undefined = "close all" |

The undefined-vs-`{kind: 'unset'}` distinction matters here — Phase 1b
must encode "field absent" differently from "field present and unset".

## Summary by carrier

| Carrier               | (a) value-only | (b) value-or-unset | (c) computed-only | Total |
|---|---|---|---|---|
| `Order`               | 0 | 44 | 0 | 44 |
| `Contract`            | 0 |  1 | 0 |  1 |
| `ContractDetails`     | 0 |  6 | 0 |  6 |
| `Execution`           | 0 |  2 | 0 |  2 |
| `ExecutionFilter`     | 0 |  1 | 0 |  1 |
| `OrderState`          | 0 | 13 | 0 | 13 |
| `OrderAllocation`     | 0 |  5 | 0 |  5 |
| `Position`            | 1 |  0 | 5 |  6 |
| `OperationResult`     | 0 |  0 | 2 |  2 |
| `OpenOrder`           | 0 |  0 | 1 |  1 |
| `GitState`            | 0 |  0 | 4 |  4 |
| `OrderStatusUpdate`   | 0 |  0 | 2 |  2 |
| `Simulation*`         | 0 |  0 | ~12 | ~12 |
| `Operation closePosition` | 0 |  1 | 0 |  1 |
| **Total**             | **1** | **73** | **~26** | **~100** |

## Cross-cuts to flag for Phase 1b

0. **PHASE0_PLAN.md §4 carrier matrix is incorrect** for three sets of
   fields — Phase 0 fixtures correct it. The plan must be updated
   (or Phase 1b's adapter spec must reference this inventory instead):
   - `Contract.{minSize, sizeIncrement, suggestedSizeIncrement, minAlgoSize, lastPricePrecision, lastSizePrecision}` → actually on `ContractDetails`
   - `Execution.lastNDays` → actually on `ExecutionFilter`
   - `OrderState.{position, positionDesired, positionAfter, desiredAllocQty, allowedAllocQty}` → actually on `OrderAllocation` (nested in `OrderState.orderAllocations[]`)

1. **All sentinel-bearing fields → `WireDecimal | WireDouble | WireInteger`** per v3 §6.1. The (b) column above is the to-do list for the wire-type adapter.
2. **(c) computed-only fields stay as `string`** on the wire (already canonical). Phase 1b must verify every callsite that produces a (c) value passes the source `Decimal` through `toCanonicalDecimalString` instead of `Decimal.toString()`. Today, `OperationResult.filledQty` / `filledPrice` are written via ad-hoc `.toFixed()` / `.toString()` calls in broker code — that's drift waiting to happen and Phase 1c will replace it.
3. **(a) value-only fields lift to `WireDecimal::Value { value }`** with no `Unset` variant ever emitted. Today the only such field is `Position.quantity`; if MockBroker or any production broker ever emits `UNSET_DECIMAL` here, the field flips to (b). T05/T08 fixtures do not currently exercise this — added to Phase 4b checklist.
4. **`Contract.strike` defaults to `UNSET_DOUBLE` even on equities** where strike is meaningless. Phase 1b's adapter should emit `{ kind: 'unset' }` for STK/CRYPTO contracts; recipients should not treat `0` as a valid strike.
5. **`OrderComboLeg.price` (UNSET_DOUBLE)** is the only sentinel-bearing field on a non-top-level carrier — Phase 1b's `WireOrder` should carry an array of nested `WireOrderComboLeg` rather than emitting raw doubles.
6. **`Operation.closePosition.quantity` is `Decimal | undefined`** — three states must round-trip distinctly: `undefined` (close all), `{kind: 'unset'}` (technically possible but never produced), `{kind: 'value', value: '<canonical>'}`. Phase 1b's adapter test must cover all three.

## Out-of-scope

- `OrderCancel.manualOrderIndicator: number = UNSET_INTEGER` (line 14) — this carrier travels through `cancelOrder` operations but is not yet on a Phase 0 fixture set. Add to the Phase 1b test suite.
- `Scanner` and `OrderCondition` carriers — `UNSET_*` defaults exist but these don't cross persistence/hashing/FFI in the trading core. Out of v3 §5 Phase 0 scope; revisit in Phase 1b only if the wire boundary expands.
- Files under `packages/ibkr/src/decoder/`, `packages/ibkr/src/protobuf/`, `packages/ibkr/src/client/` — wire-protocol internals, sentinel-handling encapsulated within the package boundary.
- `request-bridge.ts` Decimal usage (lines 86, 210, 448, 511, 553, 554) — internal-only; not on the persistence/hashing/FFI boundary.

## Phase 1c followups — `.toFixed()` / `.toString()` audit

These are the sites that produce class-(c) `Decimal-as-string` values
(or class-(b) sentinel-bearing values that get string-encoded for an
external API) using ad-hoc `.toFixed()` / `.toString()` instead of the
`toCanonicalDecimalString` formatter that Phase 1c will introduce.
Phase 1c must replace each of these to guarantee uniform canonical
output across the persistence/hashing/FFI boundary. Sites that only
format for log output (templates, error messages) do **not** need
canonicalization and are excluded from this list.

### Persistence/hash boundary — MUST switch to `toCanonicalDecimalString` in Phase 1c

| File | Line(s) | What it does | Why it matters |
|---|---|---|---|
| `src/domain/trading/UnifiedTradingAccount.ts` | 476 | `filledQty = orderFilledQty.toFixed()` — feeds `OperationResult.filledQty` and from there into the persisted commit. | The whole point of (c) computed-only — must be canonical so v2 hashes (Phase 2) and Rust persistence (Phase 4d) verify. |
| `src/domain/trading/brokers/alpaca/AlpacaBroker.ts` | 259, 261, 265, 269, 271, 274, 305, 306, 307, 308 | Order field stringification before sending to Alpaca (`qty`, `notional`, `limit_price`, `stop_price`, `trail_price`, `trail_percent`); modify-order patch builder. | Goes out over the wire to Alpaca and into persisted records; today uses bare `.toFixed()`. Sentinel checks present (`!order.lmtPrice.equals(UNSET_DECIMAL)`) but the formatter itself doesn't enforce no-exponent / canonical-zero rules. |
| `src/domain/trading/brokers/alpaca/AlpacaBroker.ts` | 385, 386, 388, 405, 406 | `AccountInfo.{netLiquidation,totalCashValue,buyingPower}` and `Position.{avgCost,marketPrice}` via `new Decimal(...).toString()`. | Class (c) computed; flows into `GitState.netLiquidation` etc. on every `git push`. |
| `src/domain/trading/brokers/ccxt/CcxtBroker.ts` | 387, 399, 734, 735 | `order.totalQuantity.toFixed()`, `order.cashQty.div(price).toFixed()` (qty-from-cash conversion), `unrealizedPnL.toString()`, `realizedPnL.toString()`. | CCXT-side (c) computed values bound for `GitState`. The qty-from-cash conversion is particularly sensitive — sub-satoshi precision matters on OKX/Bybit unified accounts. |
| `src/domain/trading/brokers/ibkr/IbkrBroker.ts` | 289, 290, 291, 292, 293 | `unrealizedPnL`, `realizedPnL`, `buyingPower`, `initMarginReq`, `maintMarginReq` via `new Decimal(...).toString()`. | Class (c) computed; flows into `GitState` via `getAccountInfo()`. |
| `src/domain/trading/brokers/ibkr/request-bridge.ts` | 466 | `marketValue: new Decimal(marketValue).abs().toString()`. | Class (c); flows into `Position.marketValue`. |

Total: **~24 callsites** across 5 files (Alpaca, CCXT, IBKR brokers + UTA). All in the broker layer + UTA fill-extraction; none in `TradingGit` itself today (TradingGit just forwards what brokers produce).

### Internal-only — stays as `.toFixed()` / `.toString()` in Phase 1c

These are intentional and do **not** need canonicalization:

| File | Line(s) | What it does | Why exempt |
|---|---|---|---|
| `packages/ibkr/src/utils.ts` | 135, 149 | TWS wire encoding helper (`val.toFixed(8)`, `val.toFixed()`). | TWS protocol-level wire encoding, kept inside the IBKR client package boundary. |
| `packages/ibkr/src/comm.ts` | 62-64 | TWS protocol field encoder. | Same — IBKR wire-protocol internals. |
| `packages/ibkr/src/decoder/account.ts` | 122-127 | TWS account-update decoder. | Internal to the IBKR decoder; resulting strings are re-wrapped in `new Decimal(...)` upstream and re-canonicalized at the broker→trading boundary in `IbkrBroker.getAccountInfo()` (already in the list above). |
| `packages/ibkr/src/{order,contract,order-state}.ts` | various | `decimalMaxString(val)` helper for `toString()` debug output. | Used in class `toString()` methods for human display only — never on the wire to disk/FFI. |
| `src/domain/trading/git/TradingGit.ts` | 245, 543, 559, 574 | Display-only formatting: commit message templates (`$${cashQty.toFixed()}`), price-change percent, worst-case message, equity-change percent. | These are user-facing message strings, not persisted scalars. Phase 1c does not need to touch them. |
| `src/domain/trading/guards/max-position-size.ts` | 44 | Guard error message `${percent.toFixed(1)}%`. | Display-only error text. |
| `src/domain/trading/__test__/e2e/*.ts` | various | Test-side `.toFixed()` for assertions and console logging. | Test code; not part of the production boundary. |
| `src/domain/trading/git/TradingGit.spec.ts`, `UnifiedTradingAccount.spec.ts` | various | Test assertions on `Decimal.toFixed()`. | Test-side assertions; Phase 1c may want to migrate them to `toCanonicalDecimalString` for clarity but it is not required for parity. |

### Why this matters for Phase 1c's audit

The (c)-computed pattern today is:
1. Broker SDK returns a string (or Number).
2. Broker layer wraps it in `new Decimal(...)` for arithmetic.
3. Broker layer emits `.toString()` or `.toFixed()` on the result.
4. Result flows into `OperationResult` / `GitState` / `Position` strings.
5. `TradingGit.push()` writes the resulting commit to disk.

Step 3 is the leak. `.toString()` on a `Decimal` produces scientific
notation for very small / very large values (`1e-30`, `1e30`);
`.toFixed()` without an explicit dp count uses the value's own
precision, which may or may not match the canonical no-exponent form.
Both differ from `toCanonicalDecimalString` for adversarial inputs
already covered by Phase 0 fixtures (`adversarial-decimal` cases in
`parity/fixtures/operations/case-201..case-240`).

Phase 1c's deliverable PR should:
1. Add `import { toCanonicalDecimalString } from '@/domain/trading/canonical-decimal'` to each file in the "MUST switch" table.
2. Replace each `.toFixed()` / `.toString()` callsite with `toCanonicalDecimalString(d)`.
3. Verify by re-running `parity/run-ts.ts` on the operations fixtures and `diff`-ing the output before/after — the diff should be non-empty (Phase 1c is the moment canonical form first applies on the live path) and every changed line should be a normalization, not a correctness change.

## How this list was produced

```bash
bash parity/scripts/scan-decimals.sh > /tmp/decimal-scan.txt
# Plus a focused .toFixed() / .toString() sweep for the Phase 1c
# followups section:
rg -n '\.toFixed\(' packages/ibkr/src/ src/domain/trading/
rg -n -B1 'Decimal.*\.toString\(' packages/ibkr/src/ src/domain/trading/
# Then manual classification per the rubric, with cross-checks against:
#   - packages/ibkr/src/{order,contract,execution,order-state}.ts
#   - src/domain/trading/git/types.ts
#   - src/domain/trading/brokers/types.ts
```

The scan script is committed at `parity/scripts/scan-decimals.sh` and
is re-runnable. If a future commit adds a Decimal field to one of the
in-scope files, the scan picks it up; the inventory must be updated
in the same PR (no implicit drift allowed).
