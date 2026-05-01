"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""
import logging
from _decimal import Decimal

from ibapi import order_condition
from ibapi.const import UNSET_DOUBLE
from ibapi.object_implem import Object
from ibapi.order import OrderComboLeg
from ibapi.order_state import OrderAllocation
from ibapi.contract import ComboLeg
from ibapi.server_versions import (
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
    MIN_SERVER_VER_SUBMITTER
)
from ibapi.tag_value import TagValue
from ibapi.utils import decode, SHOW_UNSET, isPegBenchOrder
from ibapi.wrapper import DeltaNeutralContract
from ibapi.softdollartier import SoftDollarTier

logger = logging.getLogger(__name__)


class OrderDecoder(Object):
    def __init__(self, contract, order, orderState, version, serverVersion):
        self.contract = contract
        self.order = order
        self.orderState = orderState
        self.version = version
        self.serverVersion = serverVersion

    def decodeOrderId(self, fields):
        self.order.orderId = decode(int, fields)

    def decodeContractFields(self, fields):
        self.contract.conId = decode(int, fields)
        self.contract.symbol = decode(str, fields)
        self.contract.secType = decode(str, fields)
        self.contract.lastTradeDateOrContractMonth = decode(str, fields)
        self.contract.strike = decode(float, fields)
        self.contract.right = decode(str, fields)
        if self.version >= 32:
            self.contract.multiplier = decode(str, fields)
        self.contract.exchange = decode(str, fields)
        self.contract.currency = decode(str, fields)
        self.contract.localSymbol = decode(str, fields)
        if self.version >= 32:
            self.contract.tradingClass = decode(str, fields)

    def decodeAction(self, fields):
        self.order.action = decode(str, fields)

    def decodeTotalQuantity(self, fields):
        self.order.totalQuantity = decode(Decimal, fields)

    def decodeOrderType(self, fields):
        self.order.orderType = decode(str, fields)

    def decodeLmtPrice(self, fields):
        if self.version < 29:
            self.order.lmtPrice = decode(float, fields)
        else:
            self.order.lmtPrice = decode(float, fields, SHOW_UNSET)

    def decodeAuxPrice(self, fields):
        if self.version < 30:
            self.order.auxPrice = decode(float, fields)
        else:
            self.order.auxPrice = decode(float, fields, SHOW_UNSET)

    def decodeTIF(self, fields):
        self.order.tif = decode(str, fields)

    def decodeOcaGroup(self, fields):
        self.order.ocaGroup = decode(str, fields)

    def decodeAccount(self, fields):
        self.order.account = decode(str, fields)

    def decodeOpenClose(self, fields):
        self.order.openClose = decode(str, fields)

    def decodeOrigin(self, fields):
        self.order.origin = decode(int, fields)

    def decodeOrderRef(self, fields):
        self.order.orderRef = decode(str, fields)

    def decodeClientId(self, fields):
        self.order.clientId = decode(int, fields)

    def decodePermId(self, fields):
        self.order.permId = decode(int, fields)

    def decodeOutsideRth(self, fields):
        self.order.outsideRth = decode(bool, fields)

    def decodeHidden(self, fields):
        self.order.hidden = decode(bool, fields)

    def decodeDiscretionaryAmt(self, fields):
        self.order.discretionaryAmt = decode(float, fields)

    def decodeGoodAfterTime(self, fields):
        self.order.goodAfterTime = decode(str, fields)

    def skipSharesAllocation(self, fields):
        _sharesAllocation = decode(str, fields)  # deprecated

    def decodeFAParams(self, fields):
        self.order.faGroup = decode(str, fields)
        self.order.faMethod = decode(str, fields)
        self.order.faPercentage = decode(str, fields)
        if self.serverVersion < MIN_SERVER_VER_FA_PROFILE_DESUPPORT:
            _faProfile = decode(str, fields)  # skip deprecated faProfile field

    def decodeModelCode(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_MODELS_SUPPORT:
            self.order.modelCode = decode(str, fields)

    def decodeGoodTillDate(self, fields):
        self.order.goodTillDate = decode(str, fields)

    def decodeRule80A(self, fields):
        self.order.rule80A = decode(str, fields)

    def decodePercentOffset(self, fields):
        self.order.percentOffset = decode(float, fields, SHOW_UNSET)

    def decodeSettlingFirm(self, fields):
        self.order.settlingFirm = decode(str, fields)

    def decodeShortSaleParams(self, fields):
        self.order.shortSaleSlot = decode(int, fields)
        self.order.designatedLocation = decode(str, fields)
        if self.serverVersion == MIN_SERVER_VER_SSHORTX_OLD:
            decode(int, fields)
        elif self.version >= 23:
            self.order.exemptCode = decode(int, fields)

    def decodeAuctionStrategy(self, fields):
        self.order.auctionStrategy = decode(int, fields)

    def decodeBoxOrderParams(self, fields):
        self.order.startingPrice = decode(float, fields, SHOW_UNSET)
        self.order.stockRefPrice = decode(float, fields, SHOW_UNSET)
        self.order.delta = decode(float, fields, SHOW_UNSET)

    def decodePegToStkOrVolOrderParams(self, fields):
        self.order.stockRangeLower = decode(float, fields, SHOW_UNSET)
        self.order.stockRangeUpper = decode(float, fields, SHOW_UNSET)

    def decodeDisplaySize(self, fields):
        self.order.displaySize = decode(int, fields, SHOW_UNSET)

    def decodeBlockOrder(self, fields):
        self.order.blockOrder = decode(bool, fields)

    def decodeSweepToFill(self, fields):
        self.order.sweepToFill = decode(bool, fields)

    def decodeAllOrNone(self, fields):
        self.order.allOrNone = decode(bool, fields)

    def decodeMinQty(self, fields):
        self.order.minQty = decode(int, fields, SHOW_UNSET)

    def decodeOcaType(self, fields):
        self.order.ocaType = decode(int, fields)

    def skipETradeOnly(self, fields):
        _eTradeOnly = decode(bool, fields)  # deprecated

    def skipFirmQuoteOnly(self, fields):
        _firmQuoteOnly = decode(bool, fields)  # ` deprecated

    def skipNbboPriceCap(self, fields):
        _nbboPriceCap = decode(float, fields, SHOW_UNSET)  # deprecated

    def decodeParentId(self, fields):
        self.order.parentId = decode(int, fields)

    def decodeTriggerMethod(self, fields):
        self.order.triggerMethod = decode(int, fields)

    def decodeVolOrderParams(self, fields, readOpenOrderAttribs):
        self.order.volatility = decode(float, fields, SHOW_UNSET)
        self.order.volatilityType = decode(int, fields)
        self.order.deltaNeutralOrderType = decode(str, fields)
        self.order.deltaNeutralAuxPrice = decode(float, fields, SHOW_UNSET)

        if self.version >= 27 and self.order.deltaNeutralOrderType:
            self.order.deltaNeutralConId = decode(int, fields)
            if readOpenOrderAttribs:
                self.order.deltaNeutralSettlingFirm = decode(str, fields)
                self.order.deltaNeutralClearingAccount = decode(str, fields)
                self.order.deltaNeutralClearingIntent = decode(str, fields)

        if self.version >= 31 and self.order.deltaNeutralOrderType:
            if readOpenOrderAttribs:
                self.order.deltaNeutralOpenClose = decode(str, fields)
            self.order.deltaNeutralShortSale = decode(bool, fields)
            self.order.deltaNeutralShortSaleSlot = decode(int, fields)
            self.order.deltaNeutralDesignatedLocation = decode(str, fields)

        self.order.continuousUpdate = decode(bool, fields)
        self.order.referencePriceType = decode(int, fields)

    def decodeTrailParams(self, fields):
        self.order.trailStopPrice = decode(float, fields, SHOW_UNSET)
        if self.version >= 30:
            self.order.trailingPercent = decode(float, fields, SHOW_UNSET)

    def decodeBasisPoints(self, fields):
        self.order.basisPoints = decode(float, fields, SHOW_UNSET)
        self.order.basisPointsType = decode(int, fields, SHOW_UNSET)

    def decodeComboLegs(self, fields):
        self.contract.comboLegsDescrip = decode(str, fields)

        if self.version >= 29:
            comboLegsCount = decode(int, fields)

            if comboLegsCount > 0:
                self.contract.comboLegs = []
                for _ in range(comboLegsCount):
                    comboLeg = ComboLeg()
                    comboLeg.conId = decode(int, fields)
                    comboLeg.ratio = decode(int, fields)
                    comboLeg.action = decode(str, fields)
                    comboLeg.exchange = decode(str, fields)
                    comboLeg.openClose = decode(int, fields)
                    comboLeg.shortSaleSlot = decode(int, fields)
                    comboLeg.designatedLocation = decode(str, fields)
                    comboLeg.exemptCode = decode(int, fields)
                    self.contract.comboLegs.append(comboLeg)

            orderComboLegsCount = decode(int, fields)
            if orderComboLegsCount > 0:
                self.order.orderComboLegs = []
                for _ in range(orderComboLegsCount):
                    orderComboLeg = OrderComboLeg()
                    orderComboLeg.price = decode(float, fields, SHOW_UNSET)
                    self.order.orderComboLegs.append(orderComboLeg)

    def decodeSmartComboRoutingParams(self, fields):
        if self.version >= 26:
            smartComboRoutingParamsCount = decode(int, fields)
            if smartComboRoutingParamsCount > 0:
                self.order.smartComboRoutingParams = []
                for _ in range(smartComboRoutingParamsCount):
                    tagValue = TagValue()
                    tagValue.tag = decode(str, fields)
                    tagValue.value = decode(str, fields)
                    self.order.smartComboRoutingParams.append(tagValue)

    def decodeScaleOrderParams(self, fields):
        if self.version >= 20:
            self.order.scaleInitLevelSize = decode(int, fields, SHOW_UNSET)
            self.order.scaleSubsLevelSize = decode(int, fields, SHOW_UNSET)
        else:
            self.order.notSuppScaleNumComponents = decode(int, fields, SHOW_UNSET)
            self.order.scaleInitLevelSize = decode(int, fields, SHOW_UNSET)

        self.order.scalePriceIncrement = decode(float, fields, SHOW_UNSET)

        if (
            self.version >= 28
            and self.order.scalePriceIncrement != UNSET_DOUBLE
            and self.order.scalePriceIncrement > 0.0
        ):
            self.order.scalePriceAdjustValue = decode(float, fields, SHOW_UNSET)
            self.order.scalePriceAdjustInterval = decode(int, fields, SHOW_UNSET)
            self.order.scaleProfitOffset = decode(float, fields, SHOW_UNSET)
            self.order.scaleAutoReset = decode(bool, fields)
            self.order.scaleInitPosition = decode(int, fields, SHOW_UNSET)
            self.order.scaleInitFillQty = decode(int, fields, SHOW_UNSET)
            self.order.scaleRandomPercent = decode(bool, fields)

    def decodeHedgeParams(self, fields):
        if self.version >= 24:
            self.order.hedgeType = decode(str, fields)
            if self.order.hedgeType:
                self.order.hedgeParam = decode(str, fields)

    def decodeOptOutSmartRouting(self, fields):
        if self.version >= 25:
            self.order.optOutSmartRouting = decode(bool, fields)

    def decodeClearingParams(self, fields):
        self.order.clearingAccount = decode(str, fields)
        self.order.clearingIntent = decode(str, fields)

    def decodeNotHeld(self, fields):
        if self.version >= 22:
            self.order.notHeld = decode(bool, fields)

    def decodeDeltaNeutral(self, fields):
        if self.version >= 20:
            deltaNeutralContractPresent = decode(bool, fields)
            if deltaNeutralContractPresent:
                self.contract.deltaNeutralContract = DeltaNeutralContract()
                self.contract.deltaNeutralContract.conId = decode(int, fields)
                self.contract.deltaNeutralContract.delta = decode(float, fields)
                self.contract.deltaNeutralContract.price = decode(float, fields)

    def decodeAlgoParams(self, fields):
        if self.version >= 21:
            self.order.algoStrategy = decode(str, fields)
            if self.order.algoStrategy:
                algoParamsCount = decode(int, fields)
                if algoParamsCount > 0:
                    self.order.algoParams = []
                    for _ in range(algoParamsCount):
                        tagValue = TagValue()
                        tagValue.tag = decode(str, fields)
                        tagValue.value = decode(str, fields)
                        self.order.algoParams.append(tagValue)

    def decodeSolicited(self, fields):
        if self.version >= 33:
            self.order.solicited = decode(bool, fields)

    def decodeOrderStatus(self, fields):
        self.orderState.status = decode(str, fields)

    def decodeWhatIfInfoAndCommissionAndFees(self, fields):
        self.order.whatIf = decode(bool, fields)
        OrderDecoder.decodeOrderStatus(self, fields)
        if self.serverVersion >= MIN_SERVER_VER_WHAT_IF_EXT_FIELDS:
            self.orderState.initMarginBefore = decode(str, fields)
            self.orderState.maintMarginBefore = decode(str, fields)
            self.orderState.equityWithLoanBefore = decode(str, fields)
            self.orderState.initMarginChange = decode(str, fields)
            self.orderState.maintMarginChange = decode(str, fields)
            self.orderState.equityWithLoanChange = decode(str, fields)

        self.orderState.initMarginAfter = decode(str, fields)
        self.orderState.maintMarginAfter = decode(str, fields)
        self.orderState.equityWithLoanAfter = decode(str, fields)

        self.orderState.commissionAndFees = decode(float, fields, SHOW_UNSET)
        self.orderState.minCommissionAndFees = decode(float, fields, SHOW_UNSET)
        self.orderState.maxCommissionAndFees = decode(float, fields, SHOW_UNSET)
        self.orderState.commissionAndFeesCurrency = decode(str, fields)
        
        if self.serverVersion >= MIN_SERVER_VER_FULL_ORDER_PREVIEW_FIELDS:
            self.orderState.marginCurrency = decode(str, fields)
            self.orderState.initMarginBeforeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.maintMarginBeforeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.equityWithLoanBeforeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.initMarginChangeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.maintMarginChangeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.equityWithLoanChangeOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.initMarginAfterOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.maintMarginAfterOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.equityWithLoanAfterOutsideRTH = decode(float, fields, SHOW_UNSET)
            self.orderState.suggestedSize = decode(Decimal, fields)
            self.orderState.rejectReason = decode(str, fields)
        
            accountsCount = decode(int, fields)
            if accountsCount > 0:
                self.orderState.orderAllocations = []
                for _ in range(accountsCount):
                    orderAllocation = OrderAllocation()
                    orderAllocation.account = decode(str, fields)
                    orderAllocation.position = decode(Decimal, fields)
                    orderAllocation.positionDesired = decode(Decimal, fields)
                    orderAllocation.positionAfter = decode(Decimal, fields)
                    orderAllocation.desiredAllocQty = decode(Decimal, fields)
                    orderAllocation.allowedAllocQty = decode(Decimal, fields)
                    orderAllocation.isMonetary = decode(bool, fields)
                    self.orderState.orderAllocations.append(orderAllocation)
        self.orderState.warningText = decode(str, fields)

    def decodeVolRandomizeFlags(self, fields):
        if self.version >= 34:
            self.order.randomizeSize = decode(bool, fields)
            self.order.randomizePrice = decode(bool, fields)

    def decodePegToBenchParams(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK:
            if isPegBenchOrder(self.order.orderType):
                self.order.referenceContractId = decode(int, fields)
                self.order.isPeggedChangeAmountDecrease = decode(bool, fields)
                self.order.peggedChangeAmount = decode(float, fields)
                self.order.referenceChangeAmount = decode(float, fields)
                self.order.referenceExchangeId = decode(str, fields)

    def decodeConditions(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK:
            conditionsSize = decode(int, fields)
            if conditionsSize > 0:
                self.order.conditions = []
                for _ in range(conditionsSize):
                    conditionType = decode(int, fields)
                    condition = order_condition.Create(conditionType)
                    condition.decode(fields)
                    self.order.conditions.append(condition)

                self.order.conditionsIgnoreRth = decode(bool, fields)
                self.order.conditionsCancelOrder = decode(bool, fields)

    def decodeAdjustedOrderParams(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK:
            self.order.adjustedOrderType = decode(str, fields)
            self.order.triggerPrice = decode(float, fields)
            OrderDecoder.decodeStopPriceAndLmtPriceOffset(self, fields)
            self.order.adjustedStopPrice = decode(float, fields)
            self.order.adjustedStopLimitPrice = decode(float, fields)
            self.order.adjustedTrailingAmount = decode(float, fields)
            self.order.adjustableTrailingUnit = decode(int, fields)

    def decodeStopPriceAndLmtPriceOffset(self, fields):
        self.order.trailStopPrice = decode(float, fields)
        self.order.lmtPriceOffset = decode(float, fields)

    def decodeSoftDollarTier(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_SOFT_DOLLAR_TIER:
            name = decode(str, fields)
            value = decode(str, fields)
            displayName = decode(str, fields)
            self.order.softDollarTier = SoftDollarTier(name, value, displayName)

    def decodeCashQty(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_CASH_QTY:
            self.order.cashQty = decode(float, fields)

    def decodeDontUseAutoPriceForHedge(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE:
            self.order.dontUseAutoPriceForHedge = decode(bool, fields)

    def decodeIsOmsContainers(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_ORDER_CONTAINER:
            self.order.isOmsContainer = decode(bool, fields)

    def decodeDiscretionaryUpToLimitPrice(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_D_PEG_ORDERS:
            self.order.discretionaryUpToLimitPrice = decode(bool, fields)

    def decodeAutoCancelDate(self, fields):
        self.order.autoCancelDate = decode(str, fields)

    def decodeFilledQuantity(self, fields):
        self.order.filledQuantity = decode(Decimal, fields)

    def decodeRefFuturesConId(self, fields):
        self.order.refFuturesConId = decode(int, fields)

    def decodeAutoCancelParent(self, fields, minVersionAutoCancelParent=MIN_CLIENT_VER):
        if self.serverVersion >= minVersionAutoCancelParent:
            self.order.autoCancelParent = decode(bool, fields)

    def decodeShareholder(self, fields):
        self.order.shareholder = decode(str, fields)

    def decodeImbalanceOnly(self, fields, minVersionImbalanceOnly=MIN_CLIENT_VER):
        if self.serverVersion >= minVersionImbalanceOnly:
            self.order.imbalanceOnly = decode(bool, fields)

    def decodeRouteMarketableToBbo(self, fields):
        self.order.routeMarketableToBbo = decode(bool, fields)

    def decodeParentPermId(self, fields):
        self.order.parentPermId = decode(int, fields)

    def decodeCompletedTime(self, fields):
        self.orderState.completedTime = decode(str, fields)

    def decodeCompletedStatus(self, fields):
        self.orderState.completedStatus = decode(str, fields)

    def decodeUsePriceMgmtAlgo(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PRICE_MGMT_ALGO:
            self.order.usePriceMgmtAlgo = decode(bool, fields)

    def decodeDuration(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_DURATION:
            self.order.duration = decode(int, fields, SHOW_UNSET)

    def decodePostToAts(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_POST_TO_ATS:
            self.order.postToAts = decode(int, fields, SHOW_UNSET)

    def decodePegBestPegMidOrderAttributes(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS:
            self.order.minTradeQty = decode(int, fields, SHOW_UNSET)
            self.order.minCompeteSize = decode(int, fields, SHOW_UNSET)
            self.order.competeAgainstBestOffset = decode(float, fields, SHOW_UNSET)
            self.order.midOffsetAtWhole = decode(float, fields, SHOW_UNSET)
            self.order.midOffsetAtHalf = decode(float, fields, SHOW_UNSET)

    def decodeCustomerAccount(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_CUSTOMER_ACCOUNT:
            self.order.customerAccount = decode(str, fields)

    def decodeProfessionalCustomer(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_PROFESSIONAL_CUSTOMER:
            self.order.professionalCustomer = decode(bool, fields)

    def decodeBondAccruedInterest(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_BOND_ACCRUED_INTEREST:
            self.order.bondAccruedInterest = decode(str, fields)

    def decodeIncludeOvernight(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_INCLUDE_OVERNIGHT:
            self.order.includeOvernight = decode(bool, fields)

    def decodeCMETaggingFields(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_CME_TAGGING_FIELDS_IN_OPEN_ORDER:
            self.order.extOperator = decode(str, fields)
            self.order.manualOrderIndicator = decode(int, fields, SHOW_UNSET)

    def decodeSubmitter(self, fields):
        if self.serverVersion >= MIN_SERVER_VER_SUBMITTER:
            self.order.submitter = decode(str, fields)

