# Sentinel coverage matrix (Phase 0.2)

Each ✓ corresponds to one fixture file in this directory. The
matrix is the source-of-truth for `parity/scripts/gen-sentinels.ts`.
Sentinel literals (verified at `packages/ibkr/src/const.ts`):

- `UNSET_DECIMAL`  = `Decimal("170141183460469231731687303715884105727")` (2^127 − 1, ≈1.7e38)
- `UNSET_DOUBLE`   = `Number.MAX_VALUE` (≈1.798e308)
- `UNSET_INTEGER`  = `2 ** 31 - 1` (= 2147483647)

## Order

| Field | UNSET_DECIMAL | UNSET_DOUBLE | UNSET_INTEGER | Fixture file |
|---|---|---|---|---|
| `totalQuantity` | ✓ |  |  | `order-D-totalQuantity.json` |
| `lmtPrice` | ✓ |  |  | `order-D-lmtPrice.json` |
| `auxPrice` | ✓ |  |  | `order-D-auxPrice.json` |
| `trailStopPrice` | ✓ |  |  | `order-D-trailStopPrice.json` |
| `trailingPercent` | ✓ |  |  | `order-D-trailingPercent.json` |
| `cashQty` | ✓ |  |  | `order-D-cashQty.json` |
| `filledQuantity` | ✓ |  |  | `order-D-filledQuantity.json` |
| `percentOffset` |  | ✓ |  | `order-F-percentOffset.json` |
| `startingPrice` |  | ✓ |  | `order-F-startingPrice.json` |
| `stockRefPrice` |  | ✓ |  | `order-F-stockRefPrice.json` |
| `delta` |  | ✓ |  | `order-F-delta.json` |
| `stockRangeLower` |  | ✓ |  | `order-F-stockRangeLower.json` |
| `stockRangeUpper` |  | ✓ |  | `order-F-stockRangeUpper.json` |
| `volatility` |  | ✓ |  | `order-F-volatility.json` |
| `deltaNeutralAuxPrice` |  | ✓ |  | `order-F-deltaNeutralAuxPrice.json` |
| `basisPoints` |  | ✓ |  | `order-F-basisPoints.json` |
| `scalePriceIncrement` |  | ✓ |  | `order-F-scalePriceIncrement.json` |
| `scalePriceAdjustValue` |  | ✓ |  | `order-F-scalePriceAdjustValue.json` |
| `scaleProfitOffset` |  | ✓ |  | `order-F-scaleProfitOffset.json` |
| `triggerPrice` |  | ✓ |  | `order-F-triggerPrice.json` |
| `adjustedStopPrice` |  | ✓ |  | `order-F-adjustedStopPrice.json` |
| `adjustedStopLimitPrice` |  | ✓ |  | `order-F-adjustedStopLimitPrice.json` |
| `adjustedTrailingAmount` |  | ✓ |  | `order-F-adjustedTrailingAmount.json` |
| `lmtPriceOffset` |  | ✓ |  | `order-F-lmtPriceOffset.json` |
| `competeAgainstBestOffset` |  | ✓ |  | `order-F-competeAgainstBestOffset.json` |
| `midOffsetAtWhole` |  | ✓ |  | `order-F-midOffsetAtWhole.json` |
| `midOffsetAtHalf` |  | ✓ |  | `order-F-midOffsetAtHalf.json` |
| `minQty` |  |  | ✓ | `order-I-minQty.json` |
| `volatilityType` |  |  | ✓ | `order-I-volatilityType.json` |
| `referencePriceType` |  |  | ✓ | `order-I-referencePriceType.json` |
| `basisPointsType` |  |  | ✓ | `order-I-basisPointsType.json` |
| `scaleInitLevelSize` |  |  | ✓ | `order-I-scaleInitLevelSize.json` |
| `scaleSubsLevelSize` |  |  | ✓ | `order-I-scaleSubsLevelSize.json` |
| `scalePriceAdjustInterval` |  |  | ✓ | `order-I-scalePriceAdjustInterval.json` |
| `scaleInitPosition` |  |  | ✓ | `order-I-scaleInitPosition.json` |
| `scaleInitFillQty` |  |  | ✓ | `order-I-scaleInitFillQty.json` |
| `duration` |  |  | ✓ | `order-I-duration.json` |
| `postToAts` |  |  | ✓ | `order-I-postToAts.json` |
| `minTradeQty` |  |  | ✓ | `order-I-minTradeQty.json` |
| `minCompeteSize` |  |  | ✓ | `order-I-minCompeteSize.json` |
| `manualOrderIndicator` |  |  | ✓ | `order-I-manualOrderIndicator.json` |
| `whatIfType` |  |  | ✓ | `order-I-whatIfType.json` |
| `slOrderId` |  |  | ✓ | `order-I-slOrderId.json` |
| `ptOrderId` |  |  | ✓ | `order-I-ptOrderId.json` |

Plus corner fixtures: `order-all-unset.json`, `order-all-set.json`.

## Contract

| Field | UNSET_DECIMAL | UNSET_DOUBLE | UNSET_INTEGER | Fixture file |
|---|---|---|---|---|
| `minSize` | ✓ |  |  | `contract-D-minSize.json` |
| `sizeIncrement` | ✓ |  |  | `contract-D-sizeIncrement.json` |
| `suggestedSizeIncrement` | ✓ |  |  | `contract-D-suggestedSizeIncrement.json` |
| `minAlgoSize` | ✓ |  |  | `contract-D-minAlgoSize.json` |
| `lastPricePrecision` | ✓ |  |  | `contract-D-lastPricePrecision.json` |
| `lastSizePrecision` | ✓ |  |  | `contract-D-lastSizePrecision.json` |
| `strike` |  | ✓ |  | `contract-F-strike.json` |

Plus corner fixtures: `contract-all-unset.json`, `contract-all-set.json`.

## Execution

| Field | UNSET_DECIMAL | UNSET_DOUBLE | UNSET_INTEGER | Fixture file |
|---|---|---|---|---|
| `shares` | ✓ |  |  | `execution-D-shares.json` |
| `cumQty` | ✓ |  |  | `execution-D-cumQty.json` |
| `lastNDays` |  |  | ✓ | `execution-I-lastNDays.json` |

Plus corner fixtures: `execution-all-unset.json`, `execution-all-set.json`.

## OrderState

| Field | UNSET_DECIMAL | UNSET_DOUBLE | UNSET_INTEGER | Fixture file |
|---|---|---|---|---|
| `position` | ✓ |  |  | `orderstate-D-position.json` |
| `positionDesired` | ✓ |  |  | `orderstate-D-positionDesired.json` |
| `positionAfter` | ✓ |  |  | `orderstate-D-positionAfter.json` |
| `desiredAllocQty` | ✓ |  |  | `orderstate-D-desiredAllocQty.json` |
| `allowedAllocQty` | ✓ |  |  | `orderstate-D-allowedAllocQty.json` |
| `suggestedSize` | ✓ |  |  | `orderstate-D-suggestedSize.json` |
| `commissionAndFees` |  | ✓ |  | `orderstate-F-commissionAndFees.json` |
| `minCommissionAndFees` |  | ✓ |  | `orderstate-F-minCommissionAndFees.json` |
| `maxCommissionAndFees` |  | ✓ |  | `orderstate-F-maxCommissionAndFees.json` |
| `initMarginBeforeOutsideRTH` |  | ✓ |  | `orderstate-F-initMarginBeforeOutsideRTH.json` |
| `maintMarginBeforeOutsideRTH` |  | ✓ |  | `orderstate-F-maintMarginBeforeOutsideRTH.json` |
| `equityWithLoanBeforeOutsideRTH` |  | ✓ |  | `orderstate-F-equityWithLoanBeforeOutsideRTH.json` |
| `initMarginChangeOutsideRTH` |  | ✓ |  | `orderstate-F-initMarginChangeOutsideRTH.json` |
| `maintMarginChangeOutsideRTH` |  | ✓ |  | `orderstate-F-maintMarginChangeOutsideRTH.json` |
| `equityWithLoanChangeOutsideRTH` |  | ✓ |  | `orderstate-F-equityWithLoanChangeOutsideRTH.json` |
| `initMarginAfterOutsideRTH` |  | ✓ |  | `orderstate-F-initMarginAfterOutsideRTH.json` |
| `maintMarginAfterOutsideRTH` |  | ✓ |  | `orderstate-F-maintMarginAfterOutsideRTH.json` |
| `equityWithLoanAfterOutsideRTH` |  | ✓ |  | `orderstate-F-equityWithLoanAfterOutsideRTH.json` |

Plus corner fixtures: `orderstate-all-unset.json`, `orderstate-all-set.json`.

---

**Total single-cell fixtures:** 72
**Plus corner fixtures (2 × 4 carriers):** 8
**Total fixture files:** 80

Verification: `find parity/fixtures/sentinels -name "*.json" | wc -l` ≥ 80.
