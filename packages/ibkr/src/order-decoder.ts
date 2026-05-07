/**
 * Mirrors: ibapi/orderdecoder.py
 */

import Decimal from 'decimal.js'
import { UNSET_DOUBLE, UNSET_INTEGER, UNSET_DECIMAL } from './const.js'
import { Contract, ComboLeg, DeltaNeutralContract, coerceSecType } from './contract.js'
import { Order, OrderComboLeg } from './order.js'
import { OrderState, OrderAllocation } from './order-state.js'
import { OrderCondition, Create as createOrderCondition } from './order-condition.js'
import { SoftDollarTier } from './softdollartier.js'
import { TagValue } from './tag-value.js'
import { IneligibilityReason } from './ineligibility-reason.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
  decodeDecimal,
  SHOW_UNSET,
  isPegBenchOrder,
} from './utils.js'
import {
  MIN_SERVER_VER_FA_PROFILE_DESUPPORT,
  MIN_SERVER_VER_MODELS_SUPPORT,
  MIN_SERVER_VER_SSHORTX_OLD,
  MIN_SERVER_VER_WHAT_IF_EXT_FIELDS,
  MIN_SERVER_VER_PEGGED_TO_BENCHMARK,
  MIN_SERVER_VER_SOFT_DOLLAR_TIER,
  MIN_SERVER_VER_CASH_QTY,
  MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE,
  MIN_SERVER_VER_ORDER_CONTAINER,
  MIN_SERVER_VER_D_PEG_ORDERS,
  MIN_CLIENT_VER,
  MIN_SERVER_VER_PRICE_MGMT_ALGO,
  MIN_SERVER_VER_DURATION,
  MIN_SERVER_VER_POST_TO_ATS,
  MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS,
  MIN_SERVER_VER_CUSTOMER_ACCOUNT,
  MIN_SERVER_VER_PROFESSIONAL_CUSTOMER,
  MIN_SERVER_VER_BOND_ACCRUED_INTEREST,
  MIN_SERVER_VER_INCLUDE_OVERNIGHT,
  MIN_SERVER_VER_CME_TAGGING_FIELDS_IN_OPEN_ORDER,
  MIN_SERVER_VER_FULL_ORDER_PREVIEW_FIELDS,
  MIN_SERVER_VER_SUBMITTER,
} from './server-versions.js'

export class OrderDecoder {
  contract: Contract
  order: Order
  orderState: OrderState
  version: number
  serverVersion: number

  constructor(
    contract: Contract,
    order: Order,
    orderState: OrderState,
    version: number,
    serverVersion: number,
  ) {
    this.contract = contract
    this.order = order
    this.orderState = orderState
    this.version = version
    this.serverVersion = serverVersion
  }

  decodeOrderId(fields: Iterator<string>): void {
    this.order.orderId = decodeInt(fields)
  }

  decodeContractFields(fields: Iterator<string>): void {
    this.contract.conId = decodeInt(fields)
    this.contract.symbol = decodeStr(fields)
    this.contract.secType = coerceSecType(decodeStr(fields))
    this.contract.lastTradeDateOrContractMonth = decodeStr(fields)
    this.contract.strike = decodeFloat(fields)
    this.contract.right = decodeStr(fields)
    if (this.version >= 32) {
      this.contract.multiplier = decodeStr(fields)
    }
    this.contract.exchange = decodeStr(fields)
    this.contract.currency = decodeStr(fields)
    this.contract.localSymbol = decodeStr(fields)
    if (this.version >= 32) {
      this.contract.tradingClass = decodeStr(fields)
    }
  }

  decodeAction(fields: Iterator<string>): void {
    this.order.action = decodeStr(fields)
  }

  decodeTotalQuantity(fields: Iterator<string>): void {
    this.order.totalQuantity = decodeDecimal(fields)
  }

  decodeOrderType(fields: Iterator<string>): void {
    this.order.orderType = decodeStr(fields)
  }

  decodeLmtPrice(fields: Iterator<string>): void {
    if (this.version < 29) {
      // Pre-v29: empty wire field meant 0 (not unset). Preserve that.
      const raw = decodeDecimal(fields)
      this.order.lmtPrice = raw.equals(UNSET_DECIMAL) ? new Decimal(0) : raw
    } else {
      this.order.lmtPrice = decodeDecimal(fields)
    }
  }

  decodeAuxPrice(fields: Iterator<string>): void {
    if (this.version < 30) {
      const raw = decodeDecimal(fields)
      this.order.auxPrice = raw.equals(UNSET_DECIMAL) ? new Decimal(0) : raw
    } else {
      this.order.auxPrice = decodeDecimal(fields)
    }
  }

  decodeTIF(fields: Iterator<string>): void {
    this.order.tif = decodeStr(fields)
  }

  decodeOcaGroup(fields: Iterator<string>): void {
    this.order.ocaGroup = decodeStr(fields)
  }

  decodeAccount(fields: Iterator<string>): void {
    this.order.account = decodeStr(fields)
  }

  decodeOpenClose(fields: Iterator<string>): void {
    this.order.openClose = decodeStr(fields)
  }

  decodeOrigin(fields: Iterator<string>): void {
    this.order.origin = decodeInt(fields)
  }

  decodeOrderRef(fields: Iterator<string>): void {
    this.order.orderRef = decodeStr(fields)
  }

  decodeClientId(fields: Iterator<string>): void {
    this.order.clientId = decodeInt(fields)
  }

  decodePermId(fields: Iterator<string>): void {
    this.order.permId = decodeInt(fields)
  }

  decodeOutsideRth(fields: Iterator<string>): void {
    this.order.outsideRth = decodeBool(fields)
  }

  decodeHidden(fields: Iterator<string>): void {
    this.order.hidden = decodeBool(fields)
  }

  decodeDiscretionaryAmt(fields: Iterator<string>): void {
    this.order.discretionaryAmt = decodeFloat(fields)
  }

  decodeGoodAfterTime(fields: Iterator<string>): void {
    this.order.goodAfterTime = decodeStr(fields)
  }

  skipSharesAllocation(fields: Iterator<string>): void {
    decodeStr(fields) // deprecated
  }

  decodeFAParams(fields: Iterator<string>): void {
    this.order.faGroup = decodeStr(fields)
    this.order.faMethod = decodeStr(fields)
    this.order.faPercentage = decodeStr(fields)
    if (this.serverVersion < MIN_SERVER_VER_FA_PROFILE_DESUPPORT) {
      decodeStr(fields) // skip deprecated faProfile field
    }
  }

  decodeModelCode(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_MODELS_SUPPORT) {
      this.order.modelCode = decodeStr(fields)
    }
  }

  decodeGoodTillDate(fields: Iterator<string>): void {
    this.order.goodTillDate = decodeStr(fields)
  }

  decodeRule80A(fields: Iterator<string>): void {
    this.order.rule80A = decodeStr(fields)
  }

  decodePercentOffset(fields: Iterator<string>): void {
    this.order.percentOffset = decodeFloat(fields, SHOW_UNSET)
  }

  decodeSettlingFirm(fields: Iterator<string>): void {
    this.order.settlingFirm = decodeStr(fields)
  }

  decodeShortSaleParams(fields: Iterator<string>): void {
    this.order.shortSaleSlot = decodeInt(fields)
    this.order.designatedLocation = decodeStr(fields)
    if (this.serverVersion === MIN_SERVER_VER_SSHORTX_OLD) {
      decodeInt(fields)
    } else if (this.version >= 23) {
      this.order.exemptCode = decodeInt(fields)
    }
  }

  decodeAuctionStrategy(fields: Iterator<string>): void {
    this.order.auctionStrategy = decodeInt(fields)
  }

  decodeBoxOrderParams(fields: Iterator<string>): void {
    this.order.startingPrice = decodeFloat(fields, SHOW_UNSET)
    this.order.stockRefPrice = decodeFloat(fields, SHOW_UNSET)
    this.order.delta = decodeFloat(fields, SHOW_UNSET)
  }

  decodePegToStkOrVolOrderParams(fields: Iterator<string>): void {
    this.order.stockRangeLower = decodeFloat(fields, SHOW_UNSET)
    this.order.stockRangeUpper = decodeFloat(fields, SHOW_UNSET)
  }

  decodeDisplaySize(fields: Iterator<string>): void {
    this.order.displaySize = decodeInt(fields, SHOW_UNSET)
  }

  decodeBlockOrder(fields: Iterator<string>): void {
    this.order.blockOrder = decodeBool(fields)
  }

  decodeSweepToFill(fields: Iterator<string>): void {
    this.order.sweepToFill = decodeBool(fields)
  }

  decodeAllOrNone(fields: Iterator<string>): void {
    this.order.allOrNone = decodeBool(fields)
  }

  decodeMinQty(fields: Iterator<string>): void {
    this.order.minQty = decodeInt(fields, SHOW_UNSET)
  }

  decodeOcaType(fields: Iterator<string>): void {
    this.order.ocaType = decodeInt(fields)
  }

  skipETradeOnly(fields: Iterator<string>): void {
    decodeBool(fields) // deprecated
  }

  skipFirmQuoteOnly(fields: Iterator<string>): void {
    decodeBool(fields) // deprecated
  }

  skipNbboPriceCap(fields: Iterator<string>): void {
    decodeFloat(fields, SHOW_UNSET) // deprecated
  }

  decodeParentId(fields: Iterator<string>): void {
    this.order.parentId = decodeInt(fields)
  }

  decodeTriggerMethod(fields: Iterator<string>): void {
    this.order.triggerMethod = decodeInt(fields)
  }

  decodeVolOrderParams(fields: Iterator<string>, readOpenOrderAttribs: boolean): void {
    this.order.volatility = decodeFloat(fields, SHOW_UNSET)
    this.order.volatilityType = decodeInt(fields)
    this.order.deltaNeutralOrderType = decodeStr(fields)
    this.order.deltaNeutralAuxPrice = decodeFloat(fields, SHOW_UNSET)

    if (this.version >= 27 && this.order.deltaNeutralOrderType) {
      this.order.deltaNeutralConId = decodeInt(fields)
      if (readOpenOrderAttribs) {
        this.order.deltaNeutralSettlingFirm = decodeStr(fields)
        this.order.deltaNeutralClearingAccount = decodeStr(fields)
        this.order.deltaNeutralClearingIntent = decodeStr(fields)
      }
    }

    if (this.version >= 31 && this.order.deltaNeutralOrderType) {
      if (readOpenOrderAttribs) {
        this.order.deltaNeutralOpenClose = decodeStr(fields)
      }
      this.order.deltaNeutralShortSale = decodeBool(fields)
      this.order.deltaNeutralShortSaleSlot = decodeInt(fields)
      this.order.deltaNeutralDesignatedLocation = decodeStr(fields)
    }

    this.order.continuousUpdate = decodeBool(fields)
    this.order.referencePriceType = decodeInt(fields)
  }

  decodeTrailParams(fields: Iterator<string>): void {
    this.order.trailStopPrice = decodeDecimal(fields)
    if (this.version >= 30) {
      this.order.trailingPercent = decodeDecimal(fields)
    }
  }

  decodeBasisPoints(fields: Iterator<string>): void {
    this.order.basisPoints = decodeFloat(fields, SHOW_UNSET)
    this.order.basisPointsType = decodeInt(fields, SHOW_UNSET)
  }

  decodeComboLegs(fields: Iterator<string>): void {
    this.contract.comboLegsDescrip = decodeStr(fields)

    if (this.version >= 29) {
      const comboLegsCount = decodeInt(fields)

      if (comboLegsCount > 0) {
        this.contract.comboLegs = []
        for (let i = 0; i < comboLegsCount; i++) {
          const comboLeg = new ComboLeg()
          comboLeg.conId = decodeInt(fields)
          comboLeg.ratio = decodeInt(fields)
          comboLeg.action = decodeStr(fields)
          comboLeg.exchange = decodeStr(fields)
          comboLeg.openClose = decodeInt(fields)
          comboLeg.shortSaleSlot = decodeInt(fields)
          comboLeg.designatedLocation = decodeStr(fields)
          comboLeg.exemptCode = decodeInt(fields)
          this.contract.comboLegs.push(comboLeg)
        }
      }

      const orderComboLegsCount = decodeInt(fields)
      if (orderComboLegsCount > 0) {
        this.order.orderComboLegs = []
        for (let i = 0; i < orderComboLegsCount; i++) {
          const orderComboLeg = new OrderComboLeg()
          orderComboLeg.price = decodeFloat(fields, SHOW_UNSET)
          this.order.orderComboLegs.push(orderComboLeg)
        }
      }
    }
  }

  decodeSmartComboRoutingParams(fields: Iterator<string>): void {
    if (this.version >= 26) {
      const smartComboRoutingParamsCount = decodeInt(fields)
      if (smartComboRoutingParamsCount > 0) {
        this.order.smartComboRoutingParams = []
        for (let i = 0; i < smartComboRoutingParamsCount; i++) {
          const tagValue = new TagValue()
          tagValue.tag = decodeStr(fields)
          tagValue.value = decodeStr(fields)
          this.order.smartComboRoutingParams.push(tagValue)
        }
      }
    }
  }

  decodeScaleOrderParams(fields: Iterator<string>): void {
    if (this.version >= 20) {
      this.order.scaleInitLevelSize = decodeInt(fields, SHOW_UNSET)
      this.order.scaleSubsLevelSize = decodeInt(fields, SHOW_UNSET)
    } else {
      decodeInt(fields, SHOW_UNSET) // notSuppScaleNumComponents (deprecated)
      this.order.scaleInitLevelSize = decodeInt(fields, SHOW_UNSET)
    }

    this.order.scalePriceIncrement = decodeFloat(fields, SHOW_UNSET)

    if (
      this.version >= 28 &&
      this.order.scalePriceIncrement !== UNSET_DOUBLE &&
      this.order.scalePriceIncrement > 0.0
    ) {
      this.order.scalePriceAdjustValue = decodeFloat(fields, SHOW_UNSET)
      this.order.scalePriceAdjustInterval = decodeInt(fields, SHOW_UNSET)
      this.order.scaleProfitOffset = decodeFloat(fields, SHOW_UNSET)
      this.order.scaleAutoReset = decodeBool(fields)
      this.order.scaleInitPosition = decodeInt(fields, SHOW_UNSET)
      this.order.scaleInitFillQty = decodeInt(fields, SHOW_UNSET)
      this.order.scaleRandomPercent = decodeBool(fields)
    }
  }

  decodeHedgeParams(fields: Iterator<string>): void {
    if (this.version >= 24) {
      this.order.hedgeType = decodeStr(fields)
      if (this.order.hedgeType) {
        this.order.hedgeParam = decodeStr(fields)
      }
    }
  }

  decodeOptOutSmartRouting(fields: Iterator<string>): void {
    if (this.version >= 25) {
      this.order.optOutSmartRouting = decodeBool(fields)
    }
  }

  decodeClearingParams(fields: Iterator<string>): void {
    this.order.clearingAccount = decodeStr(fields)
    this.order.clearingIntent = decodeStr(fields)
  }

  decodeNotHeld(fields: Iterator<string>): void {
    if (this.version >= 22) {
      this.order.notHeld = decodeBool(fields)
    }
  }

  decodeDeltaNeutral(fields: Iterator<string>): void {
    if (this.version >= 20) {
      const deltaNeutralContractPresent = decodeBool(fields)
      if (deltaNeutralContractPresent) {
        this.contract.deltaNeutralContract = new DeltaNeutralContract()
        this.contract.deltaNeutralContract.conId = decodeInt(fields)
        this.contract.deltaNeutralContract.delta = decodeFloat(fields)
        this.contract.deltaNeutralContract.price = decodeFloat(fields)
      }
    }
  }

  decodeAlgoParams(fields: Iterator<string>): void {
    if (this.version >= 21) {
      this.order.algoStrategy = decodeStr(fields)
      if (this.order.algoStrategy) {
        const algoParamsCount = decodeInt(fields)
        if (algoParamsCount > 0) {
          this.order.algoParams = []
          for (let i = 0; i < algoParamsCount; i++) {
            const tagValue = new TagValue()
            tagValue.tag = decodeStr(fields)
            tagValue.value = decodeStr(fields)
            this.order.algoParams.push(tagValue)
          }
        }
      }
    }
  }

  decodeSolicited(fields: Iterator<string>): void {
    if (this.version >= 33) {
      this.order.solicited = decodeBool(fields)
    }
  }

  decodeOrderStatus(fields: Iterator<string>): void {
    this.orderState.status = decodeStr(fields)
  }

  decodeWhatIfInfoAndCommissionAndFees(fields: Iterator<string>): void {
    this.order.whatIf = decodeBool(fields)
    this.decodeOrderStatus(fields)
    if (this.serverVersion >= MIN_SERVER_VER_WHAT_IF_EXT_FIELDS) {
      this.orderState.initMarginBefore = decodeStr(fields)
      this.orderState.maintMarginBefore = decodeStr(fields)
      this.orderState.equityWithLoanBefore = decodeStr(fields)
      this.orderState.initMarginChange = decodeStr(fields)
      this.orderState.maintMarginChange = decodeStr(fields)
      this.orderState.equityWithLoanChange = decodeStr(fields)
    }

    this.orderState.initMarginAfter = decodeStr(fields)
    this.orderState.maintMarginAfter = decodeStr(fields)
    this.orderState.equityWithLoanAfter = decodeStr(fields)

    this.orderState.commissionAndFees = decodeFloat(fields, SHOW_UNSET)
    this.orderState.minCommissionAndFees = decodeFloat(fields, SHOW_UNSET)
    this.orderState.maxCommissionAndFees = decodeFloat(fields, SHOW_UNSET)
    this.orderState.commissionAndFeesCurrency = decodeStr(fields)

    if (this.serverVersion >= MIN_SERVER_VER_FULL_ORDER_PREVIEW_FIELDS) {
      this.orderState.marginCurrency = decodeStr(fields)
      this.orderState.initMarginBeforeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.maintMarginBeforeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.equityWithLoanBeforeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.initMarginChangeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.maintMarginChangeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.equityWithLoanChangeOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.initMarginAfterOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.maintMarginAfterOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.equityWithLoanAfterOutsideRTH = decodeFloat(fields, SHOW_UNSET)
      this.orderState.suggestedSize = decodeDecimal(fields)
      this.orderState.rejectReason = decodeStr(fields)

      const accountsCount = decodeInt(fields)
      if (accountsCount > 0) {
        this.orderState.orderAllocations = []
        for (let i = 0; i < accountsCount; i++) {
          const orderAllocation = new OrderAllocation()
          orderAllocation.account = decodeStr(fields)
          orderAllocation.position = decodeDecimal(fields)
          orderAllocation.positionDesired = decodeDecimal(fields)
          orderAllocation.positionAfter = decodeDecimal(fields)
          orderAllocation.desiredAllocQty = decodeDecimal(fields)
          orderAllocation.allowedAllocQty = decodeDecimal(fields)
          orderAllocation.isMonetary = decodeBool(fields)
          this.orderState.orderAllocations.push(orderAllocation)
        }
      }
    }
    this.orderState.warningText = decodeStr(fields)
  }

  decodeVolRandomizeFlags(fields: Iterator<string>): void {
    if (this.version >= 34) {
      this.order.randomizeSize = decodeBool(fields)
      this.order.randomizePrice = decodeBool(fields)
    }
  }

  decodePegToBenchParams(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK) {
      if (isPegBenchOrder(this.order.orderType)) {
        this.order.referenceContractId = decodeInt(fields)
        this.order.isPeggedChangeAmountDecrease = decodeBool(fields)
        this.order.peggedChangeAmount = decodeFloat(fields)
        this.order.referenceChangeAmount = decodeFloat(fields)
        this.order.referenceExchangeId = decodeStr(fields)
      }
    }
  }

  decodeConditions(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK) {
      const conditionsSize = decodeInt(fields)
      if (conditionsSize > 0) {
        this.order.conditions = []
        for (let i = 0; i < conditionsSize; i++) {
          const conditionType = decodeInt(fields)
          const condition = createOrderCondition(conditionType)
          if (condition) {
            condition.decode(fields)
            this.order.conditions.push(condition)
          }
        }

        this.order.conditionsIgnoreRth = decodeBool(fields)
        this.order.conditionsCancelOrder = decodeBool(fields)
      }
    }
  }

  decodeAdjustedOrderParams(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK) {
      this.order.adjustedOrderType = decodeStr(fields)
      this.order.triggerPrice = decodeFloat(fields)
      this.decodeStopPriceAndLmtPriceOffset(fields)
      this.order.adjustedStopPrice = decodeFloat(fields)
      this.order.adjustedStopLimitPrice = decodeFloat(fields)
      this.order.adjustedTrailingAmount = decodeFloat(fields)
      this.order.adjustableTrailingUnit = decodeInt(fields)
    }
  }

  decodeStopPriceAndLmtPriceOffset(fields: Iterator<string>): void {
    const raw = decodeDecimal(fields)
    this.order.trailStopPrice = raw.equals(UNSET_DECIMAL) ? new Decimal(0) : raw
    this.order.lmtPriceOffset = decodeFloat(fields)
  }

  decodeSoftDollarTier(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_SOFT_DOLLAR_TIER) {
      const name = decodeStr(fields)
      const value = decodeStr(fields)
      const displayName = decodeStr(fields)
      this.order.softDollarTier = new SoftDollarTier(name, value, displayName)
    }
  }

  decodeCashQty(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_CASH_QTY) {
      this.order.cashQty = decodeDecimal(fields)
    }
  }

  decodeDontUseAutoPriceForHedge(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE) {
      this.order.dontUseAutoPriceForHedge = decodeBool(fields)
    }
  }

  decodeIsOmsContainers(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_ORDER_CONTAINER) {
      this.order.isOmsContainer = decodeBool(fields)
    }
  }

  decodeDiscretionaryUpToLimitPrice(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_D_PEG_ORDERS) {
      this.order.discretionaryUpToLimitPrice = decodeBool(fields)
    }
  }

  decodeAutoCancelDate(fields: Iterator<string>): void {
    this.order.autoCancelDate = decodeStr(fields)
  }

  decodeFilledQuantity(fields: Iterator<string>): void {
    this.order.filledQuantity = decodeDecimal(fields)
  }

  decodeRefFuturesConId(fields: Iterator<string>): void {
    this.order.refFuturesConId = decodeInt(fields)
  }

  decodeAutoCancelParent(fields: Iterator<string>, minVersionAutoCancelParent: number = MIN_CLIENT_VER): void {
    if (this.serverVersion >= minVersionAutoCancelParent) {
      this.order.autoCancelParent = decodeBool(fields)
    }
  }

  decodeShareholder(fields: Iterator<string>): void {
    this.order.shareholder = decodeStr(fields)
  }

  decodeImbalanceOnly(fields: Iterator<string>, minVersionImbalanceOnly: number = MIN_CLIENT_VER): void {
    if (this.serverVersion >= minVersionImbalanceOnly) {
      this.order.imbalanceOnly = decodeBool(fields)
    }
  }

  decodeRouteMarketableToBbo(fields: Iterator<string>): void {
    this.order.routeMarketableToBbo = decodeBool(fields)
  }

  decodeParentPermId(fields: Iterator<string>): void {
    this.order.parentPermId = decodeInt(fields)
  }

  decodeCompletedTime(fields: Iterator<string>): void {
    this.orderState.completedTime = decodeStr(fields)
  }

  decodeCompletedStatus(fields: Iterator<string>): void {
    this.orderState.completedStatus = decodeStr(fields)
  }

  decodeUsePriceMgmtAlgo(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PRICE_MGMT_ALGO) {
      this.order.usePriceMgmtAlgo = decodeBool(fields)
    }
  }

  decodeDuration(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_DURATION) {
      this.order.duration = decodeInt(fields, SHOW_UNSET)
    }
  }

  decodePostToAts(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_POST_TO_ATS) {
      this.order.postToAts = decodeInt(fields, SHOW_UNSET)
    }
  }

  decodePegBestPegMidOrderAttributes(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS) {
      this.order.minTradeQty = decodeInt(fields, SHOW_UNSET)
      this.order.minCompeteSize = decodeInt(fields, SHOW_UNSET)
      this.order.competeAgainstBestOffset = decodeFloat(fields, SHOW_UNSET)
      this.order.midOffsetAtWhole = decodeFloat(fields, SHOW_UNSET)
      this.order.midOffsetAtHalf = decodeFloat(fields, SHOW_UNSET)
    }
  }

  decodeCustomerAccount(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_CUSTOMER_ACCOUNT) {
      this.order.customerAccount = decodeStr(fields)
    }
  }

  decodeProfessionalCustomer(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_PROFESSIONAL_CUSTOMER) {
      this.order.professionalCustomer = decodeBool(fields)
    }
  }

  decodeBondAccruedInterest(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_BOND_ACCRUED_INTEREST) {
      this.order.bondAccruedInterest = decodeStr(fields)
    }
  }

  decodeIncludeOvernight(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_INCLUDE_OVERNIGHT) {
      this.order.includeOvernight = decodeBool(fields)
    }
  }

  decodeCMETaggingFields(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_CME_TAGGING_FIELDS_IN_OPEN_ORDER) {
      this.order.extOperator = decodeStr(fields)
      this.order.manualOrderIndicator = decodeInt(fields, SHOW_UNSET)
    }
  }

  decodeSubmitter(fields: Iterator<string>): void {
    if (this.serverVersion >= MIN_SERVER_VER_SUBMITTER) {
      this.order.submitter = decodeStr(fields)
    }
  }
}
