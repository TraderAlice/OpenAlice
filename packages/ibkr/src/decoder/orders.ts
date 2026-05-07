/**
 * Order-related message handlers (text + protobuf).
 *
 * Message types handled:
 *   IN.ORDER_STATUS (3)
 *   IN.OPEN_ORDER (5)
 *   IN.OPEN_ORDER_END (53)
 *   IN.ORDER_BOUND (100)
 *   IN.COMPLETED_ORDER (101)
 *   IN.COMPLETED_ORDERS_END (102)
 *   IN.NEXT_VALID_ID (9)
 */

import Decimal from 'decimal.js'
import type { Decoder } from './base.js'
import { IN } from '../message.js'
import { UNSET_INTEGER, UNSET_DOUBLE, UNSET_DECIMAL } from '../const.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeDecimal,
  floatMaxString,
  decimalMaxString,
  isValidIntValue,
} from '../utils.js'
import {
  MIN_SERVER_VER_MARKET_CAP_PRICE,
  MIN_SERVER_VER_ORDER_CONTAINER,
  MIN_SERVER_VER_AUTO_CANCEL_PARENT,
  MIN_SERVER_VER_IMBALANCE_ONLY,
} from '../server-versions.js'
import { OrderDecoder } from '../order-decoder.js'
import { Contract, ComboLeg, DeltaNeutralContract } from '../contract.js'
import { Order, OrderComboLeg } from '../order.js'
import { OrderState, OrderAllocation } from '../order-state.js'
import { SoftDollarTier } from '../softdollartier.js'
import { TagValue } from '../tag-value.js'
import {
  OrderCondition,
  PriceCondition,
  TimeCondition,
  MarginCondition,
  ExecutionCondition,
  VolumeCondition,
  PercentChangeCondition,
} from '../order-condition.js'

// Protobuf message types
import { OrderStatus as OrderStatusProto } from '../protobuf/OrderStatus.js'
import { OpenOrder as OpenOrderProto } from '../protobuf/OpenOrder.js'
import { OpenOrdersEnd as OpenOrdersEndProto } from '../protobuf/OpenOrdersEnd.js'
import { OrderBound as OrderBoundProto } from '../protobuf/OrderBound.js'
import { CompletedOrder as CompletedOrderProto } from '../protobuf/CompletedOrder.js'
import { CompletedOrdersEnd as CompletedOrdersEndProto } from '../protobuf/CompletedOrdersEnd.js'
import { NextValidId as NextValidIdProto } from '../protobuf/NextValidId.js'

import type { Contract as ContractProto } from '../protobuf/Contract.js'
import type { Order as OrderProtoType } from '../protobuf/Order.js'
import type { OrderState as OrderStateProto } from '../protobuf/OrderState.js'
import type { OrderCondition as OrderConditionProto } from '../protobuf/OrderCondition.js'

// ---------------------------------------------------------------------------
// Protobuf → data-model conversion helpers
// (mirrors decoder_utils.py: decodeContract, decodeOrder, decodeOrderState)
// ---------------------------------------------------------------------------

function decodeContractFromProto(cp: ContractProto): Contract {
  const contract = new Contract()
  if (cp.conId !== undefined) contract.conId = cp.conId
  if (cp.symbol !== undefined) contract.symbol = cp.symbol
  if (cp.secType !== undefined) 
  if (cp.lastTradeDateOrContractMonth !== undefined) contract.lastTradeDateOrContractMonth = cp.lastTradeDateOrContractMonth
  if (cp.strike !== undefined) contract.strike = cp.strike
  if (cp.right !== undefined) contract.right = cp.right
  if (cp.multiplier !== undefined) contract.multiplier = floatMaxString(cp.multiplier)
  if (cp.exchange !== undefined) contract.exchange = cp.exchange
  if (cp.currency !== undefined) contract.currency = cp.currency
  if (cp.localSymbol !== undefined) contract.localSymbol = cp.localSymbol
  if (cp.tradingClass !== undefined) contract.tradingClass = cp.tradingClass
  if (cp.comboLegsDescrip !== undefined) contract.comboLegsDescrip = cp.comboLegsDescrip

  // combo legs
  if (cp.comboLegs && cp.comboLegs.length > 0) {
    const legs: ComboLeg[] = []
    for (const clp of cp.comboLegs) {
      const leg = new ComboLeg()
      if (clp.conId !== undefined) leg.conId = clp.conId
      if (clp.ratio !== undefined) leg.ratio = clp.ratio
      if (clp.action !== undefined) leg.action = clp.action
      if (clp.exchange !== undefined) leg.exchange = clp.exchange
      if (clp.openClose !== undefined) leg.openClose = clp.openClose
      if (clp.shortSalesSlot !== undefined) leg.shortSaleSlot = clp.shortSalesSlot
      if (clp.designatedLocation !== undefined) leg.designatedLocation = clp.designatedLocation
      if (clp.exemptCode !== undefined) leg.exemptCode = clp.exemptCode
      legs.push(leg)
    }
    contract.comboLegs = legs
  }

  // delta neutral contract
  if (cp.deltaNeutralContract !== undefined) {
    const dnc = new DeltaNeutralContract()
    const dnp = cp.deltaNeutralContract
    if (dnp.conId !== undefined) dnc.conId = dnp.conId
    if (dnp.delta !== undefined) dnc.delta = dnp.delta
    if (dnp.price !== undefined) dnc.price = dnp.price
    contract.deltaNeutralContract = dnc
  }

  if (cp.lastTradeDate !== undefined) contract.lastTradeDate = cp.lastTradeDate
  if (cp.primaryExch !== undefined) contract.primaryExchange = cp.primaryExch
  if (cp.issuerId !== undefined) contract.issuerId = cp.issuerId
  if (cp.description !== undefined) contract.description = cp.description

  return contract
}

function decodeOrderComboLegsFromProto(cp: ContractProto): OrderComboLeg[] {
  const result: OrderComboLeg[] = []
  if (cp.comboLegs && cp.comboLegs.length > 0) {
    for (const clp of cp.comboLegs) {
      const ocl = new OrderComboLeg()
      if (clp.perLegPrice !== undefined) ocl.price = clp.perLegPrice
      result.push(ocl)
    }
  }
  return result
}

function decodeTagValueMap(protoMap: { [key: string]: string } | undefined): TagValue[] | null {
  if (!protoMap) return null
  const entries = Object.entries(protoMap)
  if (entries.length === 0) return null
  return entries.map(([tag, value]) => new TagValue(tag, value))
}

function decodeConditionsFromProto(conditions: OrderConditionProto[] | undefined): OrderCondition[] {
  if (!conditions || conditions.length === 0) return []
  const result: OrderCondition[] = []

  for (const ocp of conditions) {
    const conditionType = ocp.type ?? 0
    let condition: OrderCondition | null = null

    if (conditionType === OrderCondition.Price) {
      const c = new PriceCondition()
      setContractConditionFields(ocp, c)
      if (ocp.price !== undefined) c.price = ocp.price
      if (ocp.triggerMethod !== undefined) c.triggerMethod = ocp.triggerMethod
      condition = c
    } else if (conditionType === OrderCondition.Time) {
      const c = new TimeCondition()
      setOperatorConditionFields(ocp, c)
      if (ocp.time !== undefined) c.time = ocp.time
      condition = c
    } else if (conditionType === OrderCondition.Margin) {
      const c = new MarginCondition()
      setOperatorConditionFields(ocp, c)
      if (ocp.percent !== undefined) c.percent = ocp.percent
      condition = c
    } else if (conditionType === OrderCondition.Execution) {
      const c = new ExecutionCondition()
      setConditionFields(ocp, c)
      if (ocp.secType !== undefined) c.secType = ocp.secType
      if (ocp.exchange !== undefined) c.exchange = ocp.exchange
      if (ocp.symbol !== undefined) c.symbol = ocp.symbol
      condition = c
    } else if (conditionType === OrderCondition.Volume) {
      const c = new VolumeCondition()
      setContractConditionFields(ocp, c)
      if (ocp.volume !== undefined) c.volume = ocp.volume
      condition = c
    } else if (conditionType === OrderCondition.PercentChange) {
      const c = new PercentChangeCondition()
      setContractConditionFields(ocp, c)
      if (ocp.changePercent !== undefined) c.changePercent = ocp.changePercent
      condition = c
    }

    if (condition) result.push(condition)
  }

  return result
}

function setConditionFields(ocp: OrderConditionProto, cond: OrderCondition): void {
  if (ocp.isConjunctionConnection !== undefined) cond.isConjunctionConnection = ocp.isConjunctionConnection
}

function setOperatorConditionFields(ocp: OrderConditionProto, cond: { isMore: boolean | null; isConjunctionConnection: boolean }): void {
  if (ocp.isConjunctionConnection !== undefined) cond.isConjunctionConnection = ocp.isConjunctionConnection
  if (ocp.isMore !== undefined) cond.isMore = ocp.isMore
}

function setContractConditionFields(ocp: OrderConditionProto, cond: { conId: number | null; exchange: string | null; isMore: boolean | null; isConjunctionConnection: boolean }): void {
  setOperatorConditionFields(ocp, cond)
  if (ocp.conId !== undefined) cond.conId = ocp.conId
  if (ocp.exchange !== undefined) cond.exchange = ocp.exchange
}

function decodeSoftDollarTierFromProto(op: OrderProtoType): SoftDollarTier | null {
  const sdtp = op.softDollarTier
  if (!sdtp) return null
  return new SoftDollarTier(
    sdtp.name ?? '',
    sdtp.value ?? '',
    sdtp.displayName ?? '',
  )
}

function decodeOrderFromProto(orderId: number, cp: ContractProto, op: OrderProtoType): Order {
  const order = new Order()
  if (isValidIntValue(orderId)) order.orderId = orderId
  if (op.orderId !== undefined) order.orderId = op.orderId
  if (op.action !== undefined) order.action = op.action
  if (op.totalQuantity !== undefined) order.totalQuantity = new Decimal(op.totalQuantity)
  if (op.orderType !== undefined) order.orderType = op.orderType
  if (op.lmtPrice !== undefined) order.lmtPrice = new Decimal(op.lmtPrice)
  if (op.auxPrice !== undefined) order.auxPrice = new Decimal(op.auxPrice)
  if (op.tif !== undefined) order.tif = op.tif
  if (op.ocaGroup !== undefined) order.ocaGroup = op.ocaGroup
  if (op.account !== undefined) order.account = op.account
  if (op.openClose !== undefined) order.openClose = op.openClose
  if (op.origin !== undefined) order.origin = op.origin
  if (op.orderRef !== undefined) order.orderRef = op.orderRef
  if (op.clientId !== undefined) order.clientId = op.clientId
  if (op.permId !== undefined) order.permId = op.permId
  if (op.outsideRth !== undefined) order.outsideRth = op.outsideRth
  if (op.hidden !== undefined) order.hidden = op.hidden
  if (op.discretionaryAmt !== undefined) order.discretionaryAmt = op.discretionaryAmt
  if (op.goodAfterTime !== undefined) order.goodAfterTime = op.goodAfterTime
  if (op.faGroup !== undefined) order.faGroup = op.faGroup
  if (op.faMethod !== undefined) order.faMethod = op.faMethod
  if (op.faPercentage !== undefined) order.faPercentage = op.faPercentage
  if (op.modelCode !== undefined) order.modelCode = op.modelCode
  if (op.goodTillDate !== undefined) order.goodTillDate = op.goodTillDate
  if (op.rule80A !== undefined) order.rule80A = op.rule80A
  if (op.percentOffset !== undefined) order.percentOffset = op.percentOffset
  if (op.settlingFirm !== undefined) order.settlingFirm = op.settlingFirm
  if (op.shortSaleSlot !== undefined) order.shortSaleSlot = op.shortSaleSlot
  if (op.designatedLocation !== undefined) order.designatedLocation = op.designatedLocation
  if (op.exemptCode !== undefined) order.exemptCode = op.exemptCode
  if (op.startingPrice !== undefined) order.startingPrice = op.startingPrice
  if (op.stockRefPrice !== undefined) order.stockRefPrice = op.stockRefPrice
  if (op.delta !== undefined) order.delta = op.delta
  if (op.stockRangeLower !== undefined) order.stockRangeLower = op.stockRangeLower
  if (op.stockRangeUpper !== undefined) order.stockRangeUpper = op.stockRangeUpper
  if (op.displaySize !== undefined) order.displaySize = op.displaySize
  if (op.blockOrder !== undefined) order.blockOrder = op.blockOrder
  if (op.sweepToFill !== undefined) order.sweepToFill = op.sweepToFill
  if (op.allOrNone !== undefined) order.allOrNone = op.allOrNone
  if (op.minQty !== undefined) order.minQty = op.minQty
  if (op.ocaType !== undefined) order.ocaType = op.ocaType
  if (op.parentId !== undefined) order.parentId = op.parentId
  if (op.triggerMethod !== undefined) order.triggerMethod = op.triggerMethod
  if (op.volatility !== undefined) order.volatility = op.volatility
  if (op.volatilityType !== undefined) order.volatilityType = op.volatilityType
  if (op.deltaNeutralOrderType !== undefined) order.deltaNeutralOrderType = op.deltaNeutralOrderType
  if (op.deltaNeutralAuxPrice !== undefined) order.deltaNeutralAuxPrice = op.deltaNeutralAuxPrice
  if (op.deltaNeutralConId !== undefined) order.deltaNeutralConId = op.deltaNeutralConId
  if (op.deltaNeutralSettlingFirm !== undefined) order.deltaNeutralSettlingFirm = op.deltaNeutralSettlingFirm
  if (op.deltaNeutralClearingAccount !== undefined) order.deltaNeutralClearingAccount = op.deltaNeutralClearingAccount
  if (op.deltaNeutralClearingIntent !== undefined) order.deltaNeutralClearingIntent = op.deltaNeutralClearingIntent
  if (op.deltaNeutralOpenClose !== undefined) order.deltaNeutralOpenClose = op.deltaNeutralOpenClose
  if (op.deltaNeutralShortSale !== undefined) order.deltaNeutralShortSale = op.deltaNeutralShortSale
  if (op.deltaNeutralShortSaleSlot !== undefined) order.deltaNeutralShortSaleSlot = op.deltaNeutralShortSaleSlot
  if (op.deltaNeutralDesignatedLocation !== undefined) order.deltaNeutralDesignatedLocation = op.deltaNeutralDesignatedLocation
  if (op.continuousUpdate !== undefined) order.continuousUpdate = op.continuousUpdate
  if (op.referencePriceType !== undefined) order.referencePriceType = op.referencePriceType
  if (op.trailStopPrice !== undefined) order.trailStopPrice = new Decimal(op.trailStopPrice)
  if (op.trailingPercent !== undefined) order.trailingPercent = new Decimal(op.trailingPercent)

  // order combo legs
  const orderComboLegs = decodeOrderComboLegsFromProto(cp)
  if (orderComboLegs.length > 0) order.orderComboLegs = orderComboLegs

  // smart combo routing params
  order.smartComboRoutingParams = decodeTagValueMap(op.smartComboRoutingParams)

  if (op.scaleInitLevelSize !== undefined) order.scaleInitLevelSize = op.scaleInitLevelSize
  if (op.scaleSubsLevelSize !== undefined) order.scaleSubsLevelSize = op.scaleSubsLevelSize
  if (op.scalePriceIncrement !== undefined) order.scalePriceIncrement = op.scalePriceIncrement
  if (op.scalePriceAdjustValue !== undefined) order.scalePriceAdjustValue = op.scalePriceAdjustValue
  if (op.scalePriceAdjustInterval !== undefined) order.scalePriceAdjustInterval = op.scalePriceAdjustInterval
  if (op.scaleProfitOffset !== undefined) order.scaleProfitOffset = op.scaleProfitOffset
  if (op.scaleAutoReset !== undefined) order.scaleAutoReset = op.scaleAutoReset
  if (op.scaleInitPosition !== undefined) order.scaleInitPosition = op.scaleInitPosition
  if (op.scaleInitFillQty !== undefined) order.scaleInitFillQty = op.scaleInitFillQty
  if (op.scaleRandomPercent !== undefined) order.scaleRandomPercent = op.scaleRandomPercent
  if (op.hedgeType !== undefined) order.hedgeType = op.hedgeType
  if (op.hedgeType !== undefined && op.hedgeParam !== undefined && op.hedgeType) order.hedgeParam = op.hedgeParam
  if (op.optOutSmartRouting !== undefined) order.optOutSmartRouting = op.optOutSmartRouting
  if (op.clearingAccount !== undefined) order.clearingAccount = op.clearingAccount
  if (op.clearingIntent !== undefined) order.clearingIntent = op.clearingIntent
  if (op.notHeld !== undefined) order.notHeld = op.notHeld

  if (op.algoStrategy !== undefined) {
    order.algoStrategy = op.algoStrategy
    order.algoParams = decodeTagValueMap(op.algoParams)
  }

  if (op.solicited !== undefined) order.solicited = op.solicited
  if (op.whatIf !== undefined) order.whatIf = op.whatIf
  if (op.randomizeSize !== undefined) order.randomizeSize = op.randomizeSize
  if (op.randomizePrice !== undefined) order.randomizePrice = op.randomizePrice
  if (op.referenceContractId !== undefined) order.referenceContractId = op.referenceContractId
  if (op.isPeggedChangeAmountDecrease !== undefined) order.isPeggedChangeAmountDecrease = op.isPeggedChangeAmountDecrease
  if (op.peggedChangeAmount !== undefined) order.peggedChangeAmount = op.peggedChangeAmount
  if (op.referenceChangeAmount !== undefined) order.referenceChangeAmount = op.referenceChangeAmount
  if (op.referenceExchangeId !== undefined) order.referenceExchangeId = op.referenceExchangeId

  // conditions
  const conditions = decodeConditionsFromProto(op.conditions)
  if (conditions.length > 0) order.conditions = conditions
  if (op.conditionsIgnoreRth !== undefined) order.conditionsIgnoreRth = op.conditionsIgnoreRth
  if (op.conditionsCancelOrder !== undefined) order.conditionsCancelOrder = op.conditionsCancelOrder

  if (op.adjustedOrderType !== undefined) order.adjustedOrderType = op.adjustedOrderType
  if (op.triggerPrice !== undefined) order.triggerPrice = op.triggerPrice
  if (op.lmtPriceOffset !== undefined) order.lmtPriceOffset = op.lmtPriceOffset
  if (op.adjustedStopPrice !== undefined) order.adjustedStopPrice = op.adjustedStopPrice
  if (op.adjustedStopLimitPrice !== undefined) order.adjustedStopLimitPrice = op.adjustedStopLimitPrice
  if (op.adjustedTrailingAmount !== undefined) order.adjustedTrailingAmount = op.adjustedTrailingAmount
  if (op.adjustableTrailingUnit !== undefined) order.adjustableTrailingUnit = op.adjustableTrailingUnit

  // soft dollar tier
  const sdt = decodeSoftDollarTierFromProto(op)
  if (sdt) order.softDollarTier = sdt

  if (op.cashQty !== undefined) order.cashQty = new Decimal(op.cashQty)
  if (op.dontUseAutoPriceForHedge !== undefined) order.dontUseAutoPriceForHedge = op.dontUseAutoPriceForHedge
  if (op.isOmsContainer !== undefined) order.isOmsContainer = op.isOmsContainer
  if (op.discretionaryUpToLimitPrice !== undefined) order.discretionaryUpToLimitPrice = op.discretionaryUpToLimitPrice
  if (op.usePriceMgmtAlgo !== undefined) order.usePriceMgmtAlgo = op.usePriceMgmtAlgo !== 0 ? true : false
  if (op.duration !== undefined) order.duration = op.duration
  if (op.postToAts !== undefined) order.postToAts = op.postToAts
  if (op.autoCancelParent !== undefined) order.autoCancelParent = op.autoCancelParent
  if (op.minTradeQty !== undefined) order.minTradeQty = op.minTradeQty
  if (op.minCompeteSize !== undefined) order.minCompeteSize = op.minCompeteSize
  if (op.competeAgainstBestOffset !== undefined) order.competeAgainstBestOffset = op.competeAgainstBestOffset
  if (op.midOffsetAtWhole !== undefined) order.midOffsetAtWhole = op.midOffsetAtWhole
  if (op.midOffsetAtHalf !== undefined) order.midOffsetAtHalf = op.midOffsetAtHalf
  if (op.customerAccount !== undefined) order.customerAccount = op.customerAccount
  if (op.professionalCustomer !== undefined) order.professionalCustomer = op.professionalCustomer
  if (op.bondAccruedInterest !== undefined) order.bondAccruedInterest = op.bondAccruedInterest
  if (op.includeOvernight !== undefined) order.includeOvernight = op.includeOvernight
  if (op.extOperator !== undefined) order.extOperator = op.extOperator
  if (op.manualOrderIndicator !== undefined) order.manualOrderIndicator = op.manualOrderIndicator
  if (op.submitter !== undefined) order.submitter = op.submitter
  if (op.imbalanceOnly !== undefined) order.imbalanceOnly = op.imbalanceOnly
  if (op.autoCancelDate !== undefined) order.autoCancelDate = op.autoCancelDate
  if (op.filledQuantity !== undefined) order.filledQuantity = new Decimal(op.filledQuantity)
  if (op.refFuturesConId !== undefined) order.refFuturesConId = op.refFuturesConId
  if (op.shareholder !== undefined) order.shareholder = op.shareholder
  if (op.routeMarketableToBbo !== undefined) order.routeMarketableToBbo = op.routeMarketableToBbo !== 0 ? true : false
  if (op.parentPermId !== undefined) order.parentPermId = op.parentPermId
  if (op.postOnly !== undefined) order.postOnly = op.postOnly
  if (op.allowPreOpen !== undefined) order.allowPreOpen = op.allowPreOpen
  if (op.ignoreOpenAuction !== undefined) order.ignoreOpenAuction = op.ignoreOpenAuction
  if (op.deactivate !== undefined) order.deactivate = op.deactivate
  if (op.activeStartTime !== undefined) order.activeStartTime = op.activeStartTime
  if (op.activeStopTime !== undefined) order.activeStopTime = op.activeStopTime
  if (op.seekPriceImprovement !== undefined) order.seekPriceImprovement = op.seekPriceImprovement !== 0 ? true : false
  if (op.whatIfType !== undefined) order.whatIfType = op.whatIfType

  return order
}

function decodeOrderStateFromProto(osp: OrderStateProto): OrderState {
  const os = new OrderState()
  if (osp.status !== undefined) os.status = osp.status
  if (osp.initMarginBefore !== undefined) os.initMarginBefore = decimalMaxString(new Decimal(osp.initMarginBefore))
  if (osp.maintMarginBefore !== undefined) os.maintMarginBefore = decimalMaxString(new Decimal(osp.maintMarginBefore))
  if (osp.equityWithLoanBefore !== undefined) os.equityWithLoanBefore = decimalMaxString(new Decimal(osp.equityWithLoanBefore))
  if (osp.initMarginChange !== undefined) os.initMarginChange = decimalMaxString(new Decimal(osp.initMarginChange))
  if (osp.maintMarginChange !== undefined) os.maintMarginChange = decimalMaxString(new Decimal(osp.maintMarginChange))
  if (osp.equityWithLoanChange !== undefined) os.equityWithLoanChange = decimalMaxString(new Decimal(osp.equityWithLoanChange))
  if (osp.initMarginAfter !== undefined) os.initMarginAfter = decimalMaxString(new Decimal(osp.initMarginAfter))
  if (osp.maintMarginAfter !== undefined) os.maintMarginAfter = decimalMaxString(new Decimal(osp.maintMarginAfter))
  if (osp.equityWithLoanAfter !== undefined) os.equityWithLoanAfter = decimalMaxString(new Decimal(osp.equityWithLoanAfter))
  if (osp.commissionAndFees !== undefined) os.commissionAndFees = osp.commissionAndFees
  if (osp.minCommissionAndFees !== undefined) os.minCommissionAndFees = osp.minCommissionAndFees
  if (osp.maxCommissionAndFees !== undefined) os.maxCommissionAndFees = osp.maxCommissionAndFees
  if (osp.commissionAndFeesCurrency !== undefined) os.commissionAndFeesCurrency = osp.commissionAndFeesCurrency
  if (osp.warningText !== undefined) os.warningText = osp.warningText
  if (osp.marginCurrency !== undefined) os.marginCurrency = osp.marginCurrency
  if (osp.initMarginBeforeOutsideRTH !== undefined) os.initMarginBeforeOutsideRTH = osp.initMarginBeforeOutsideRTH
  if (osp.maintMarginBeforeOutsideRTH !== undefined) os.maintMarginBeforeOutsideRTH = osp.maintMarginBeforeOutsideRTH
  if (osp.equityWithLoanBeforeOutsideRTH !== undefined) os.equityWithLoanBeforeOutsideRTH = osp.equityWithLoanBeforeOutsideRTH
  if (osp.initMarginChangeOutsideRTH !== undefined) os.initMarginChangeOutsideRTH = osp.initMarginChangeOutsideRTH
  if (osp.maintMarginChangeOutsideRTH !== undefined) os.maintMarginChangeOutsideRTH = osp.maintMarginChangeOutsideRTH
  if (osp.equityWithLoanChangeOutsideRTH !== undefined) os.equityWithLoanChangeOutsideRTH = osp.equityWithLoanChangeOutsideRTH
  if (osp.initMarginAfterOutsideRTH !== undefined) os.initMarginAfterOutsideRTH = osp.initMarginAfterOutsideRTH
  if (osp.maintMarginAfterOutsideRTH !== undefined) os.maintMarginAfterOutsideRTH = osp.maintMarginAfterOutsideRTH
  if (osp.equityWithLoanAfterOutsideRTH !== undefined) os.equityWithLoanAfterOutsideRTH = osp.equityWithLoanAfterOutsideRTH
  if (osp.suggestedSize !== undefined) os.suggestedSize = new Decimal(osp.suggestedSize)
  if (osp.rejectReason !== undefined) os.rejectReason = osp.rejectReason

  // order allocations
  if (osp.orderAllocations && osp.orderAllocations.length > 0) {
    const allocs: OrderAllocation[] = []
    for (const oap of osp.orderAllocations) {
      const oa = new OrderAllocation()
      if (oap.account !== undefined) oa.account = oap.account
      if (oap.position !== undefined) oa.position = new Decimal(oap.position)
      if (oap.positionDesired !== undefined) oa.positionDesired = new Decimal(oap.positionDesired)
      if (oap.positionAfter !== undefined) oa.positionAfter = new Decimal(oap.positionAfter)
      if (oap.desiredAllocQty !== undefined) oa.desiredAllocQty = new Decimal(oap.desiredAllocQty)
      if (oap.allowedAllocQty !== undefined) oa.allowedAllocQty = new Decimal(oap.allowedAllocQty)
      if (oap.isMonetary !== undefined) oa.isMonetary = oap.isMonetary
      allocs.push(oa)
    }
    os.orderAllocations = allocs
  }

  if (osp.completedTime !== undefined) os.completedTime = osp.completedTime
  if (osp.completedStatus !== undefined) os.completedStatus = osp.completedStatus

  return os
}

// ---------------------------------------------------------------------------
// Apply handlers
// ---------------------------------------------------------------------------

export function applyOrderHandlers(decoder: Decoder): void {
  // -----------------------------------------------------------------------
  // IN.ORDER_STATUS (3) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.ORDER_STATUS, (d, fields) => {
    decodeInt(fields) // msgId
    if (d.serverVersion < MIN_SERVER_VER_MARKET_CAP_PRICE) {
      decodeInt(fields) // version
    }
    const orderId = decodeInt(fields)
    const status = decodeStr(fields)
    const filled = decodeDecimal(fields)
    const remaining = decodeDecimal(fields)
    const avgFillPrice = decodeFloat(fields)

    const permId = decodeInt(fields) // ver 2
    const parentId = decodeInt(fields) // ver 3
    const lastFillPrice = decodeFloat(fields) // ver 4
    const clientId = decodeInt(fields) // ver 5
    const whyHeld = decodeStr(fields) // ver 6

    let mktCapPrice = 0
    if (d.serverVersion >= MIN_SERVER_VER_MARKET_CAP_PRICE) {
      mktCapPrice = decodeFloat(fields)
    }

    d.wrapper.orderStatus(
      orderId, status, filled, remaining, avgFillPrice,
      permId, parentId, lastFillPrice, clientId, whyHeld,
      mktCapPrice,
    )
  })

  // -----------------------------------------------------------------------
  // IN.ORDER_STATUS (3) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.ORDER_STATUS, (d, buf) => {
    const proto = OrderStatusProto.decode(buf)

    const orderId = proto.orderId ?? UNSET_INTEGER
    const status = proto.status ?? ''
    const filled = proto.filled !== undefined
      ? new Decimal(proto.filled)
      : UNSET_DECIMAL
    const remaining = proto.remaining !== undefined
      ? new Decimal(proto.remaining)
      : UNSET_DECIMAL
    const avgFillPrice = proto.avgFillPrice ?? UNSET_DOUBLE
    const permId = proto.permId ?? UNSET_INTEGER
    const parentId = proto.parentId ?? UNSET_INTEGER
    const lastFillPrice = proto.lastFillPrice ?? UNSET_DOUBLE
    const clientId = proto.clientId ?? UNSET_INTEGER
    const whyHeld = proto.whyHeld ?? ''
    const mktCapPrice = proto.mktCapPrice ?? UNSET_DOUBLE

    d.wrapper.orderStatus(
      orderId, status, filled, remaining, avgFillPrice,
      permId, parentId, lastFillPrice, clientId, whyHeld,
      mktCapPrice,
    )
  })

  // -----------------------------------------------------------------------
  // IN.OPEN_ORDER (5) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.OPEN_ORDER, (d, fields) => {
    decodeInt(fields) // msgId

    const order = new Order()
    const contract = new Contract()
    const orderState = new OrderState()

    let version: number
    if (d.serverVersion < MIN_SERVER_VER_ORDER_CONTAINER) {
      version = decodeInt(fields)
    } else {
      version = d.serverVersion
    }

    const od = new OrderDecoder(contract, order, orderState, version, d.serverVersion)

    od.decodeOrderId(fields)
    od.decodeContractFields(fields)
    od.decodeAction(fields)
    od.decodeTotalQuantity(fields)
    od.decodeOrderType(fields)
    od.decodeLmtPrice(fields)
    od.decodeAuxPrice(fields)
    od.decodeTIF(fields)
    od.decodeOcaGroup(fields)
    od.decodeAccount(fields)
    od.decodeOpenClose(fields)
    od.decodeOrigin(fields)
    od.decodeOrderRef(fields)
    od.decodeClientId(fields)
    od.decodePermId(fields)
    od.decodeOutsideRth(fields)
    od.decodeHidden(fields)
    od.decodeDiscretionaryAmt(fields)
    od.decodeGoodAfterTime(fields)
    od.skipSharesAllocation(fields)
    od.decodeFAParams(fields)
    od.decodeModelCode(fields)
    od.decodeGoodTillDate(fields)
    od.decodeRule80A(fields)
    od.decodePercentOffset(fields)
    od.decodeSettlingFirm(fields)
    od.decodeShortSaleParams(fields)
    od.decodeAuctionStrategy(fields)
    od.decodeBoxOrderParams(fields)
    od.decodePegToStkOrVolOrderParams(fields)
    od.decodeDisplaySize(fields)
    od.decodeBlockOrder(fields)
    od.decodeSweepToFill(fields)
    od.decodeAllOrNone(fields)
    od.decodeMinQty(fields)
    od.decodeOcaType(fields)
    od.skipETradeOnly(fields)
    od.skipFirmQuoteOnly(fields)
    od.skipNbboPriceCap(fields)
    od.decodeParentId(fields)
    od.decodeTriggerMethod(fields)
    od.decodeVolOrderParams(fields, true)
    od.decodeTrailParams(fields)
    od.decodeBasisPoints(fields)
    od.decodeComboLegs(fields)
    od.decodeSmartComboRoutingParams(fields)
    od.decodeScaleOrderParams(fields)
    od.decodeHedgeParams(fields)
    od.decodeOptOutSmartRouting(fields)
    od.decodeClearingParams(fields)
    od.decodeNotHeld(fields)
    od.decodeDeltaNeutral(fields)
    od.decodeAlgoParams(fields)
    od.decodeSolicited(fields)
    od.decodeWhatIfInfoAndCommissionAndFees(fields)
    od.decodeVolRandomizeFlags(fields)
    od.decodePegToBenchParams(fields)
    od.decodeConditions(fields)
    od.decodeAdjustedOrderParams(fields)
    od.decodeSoftDollarTier(fields)
    od.decodeCashQty(fields)
    od.decodeDontUseAutoPriceForHedge(fields)
    od.decodeIsOmsContainers(fields)
    od.decodeDiscretionaryUpToLimitPrice(fields)
    od.decodeUsePriceMgmtAlgo(fields)
    od.decodeDuration(fields)
    od.decodePostToAts(fields)
    od.decodeAutoCancelParent(fields, MIN_SERVER_VER_AUTO_CANCEL_PARENT)
    od.decodePegBestPegMidOrderAttributes(fields)
    od.decodeCustomerAccount(fields)
    od.decodeProfessionalCustomer(fields)
    od.decodeBondAccruedInterest(fields)
    od.decodeIncludeOvernight(fields)
    od.decodeCMETaggingFields(fields)
    od.decodeSubmitter(fields)
    od.decodeImbalanceOnly(fields, MIN_SERVER_VER_IMBALANCE_ONLY)

    d.wrapper.openOrder(order.orderId, contract, order, orderState)
  })

  // -----------------------------------------------------------------------
  // IN.OPEN_ORDER (5) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.OPEN_ORDER, (d, buf) => {
    const proto = OpenOrderProto.decode(buf)

    const orderId = proto.orderId ?? 0

    // decode contract fields
    if (!proto.contract) return
    const contract = decodeContractFromProto(proto.contract)

    // decode order fields
    if (!proto.order) return
    const order = decodeOrderFromProto(orderId, proto.contract, proto.order)

    // decode order state fields
    if (!proto.orderState) return
    const orderState = decodeOrderStateFromProto(proto.orderState)

    d.wrapper.openOrder(orderId, contract, order, orderState)
  })

  // -----------------------------------------------------------------------
  // IN.OPEN_ORDER_END (53) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.OPEN_ORDER_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    d.wrapper.openOrderEnd()
  })

  // -----------------------------------------------------------------------
  // IN.OPEN_ORDER_END (53) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.OPEN_ORDER_END, (d, buf) => {
    OpenOrdersEndProto.decode(buf)
    d.wrapper.openOrderEnd()
  })

  // -----------------------------------------------------------------------
  // IN.ORDER_BOUND (100) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.ORDER_BOUND, (d, fields) => {
    decodeInt(fields) // msgId
    const permId = decodeInt(fields)
    const clientId = decodeInt(fields)
    const orderId = decodeInt(fields)

    d.wrapper.orderBound(permId, clientId, orderId)
  })

  // -----------------------------------------------------------------------
  // IN.ORDER_BOUND (100) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.ORDER_BOUND, (d, buf) => {
    const proto = OrderBoundProto.decode(buf)

    const permId = proto.permId ?? UNSET_INTEGER
    const clientId = proto.clientId ?? UNSET_INTEGER
    const orderId = proto.orderId ?? UNSET_INTEGER

    d.wrapper.orderBound(permId, clientId, orderId)
  })

  // -----------------------------------------------------------------------
  // IN.COMPLETED_ORDER (101) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.COMPLETED_ORDER, (d, fields) => {
    decodeInt(fields) // msgId

    const order = new Order()
    const contract = new Contract()
    const orderState = new OrderState()

    const od = new OrderDecoder(contract, order, orderState, UNSET_INTEGER, d.serverVersion)

    od.decodeContractFields(fields)
    od.decodeAction(fields)
    od.decodeTotalQuantity(fields)
    od.decodeOrderType(fields)
    od.decodeLmtPrice(fields)
    od.decodeAuxPrice(fields)
    od.decodeTIF(fields)
    od.decodeOcaGroup(fields)
    od.decodeAccount(fields)
    od.decodeOpenClose(fields)
    od.decodeOrigin(fields)
    od.decodeOrderRef(fields)
    od.decodePermId(fields)
    od.decodeOutsideRth(fields)
    od.decodeHidden(fields)
    od.decodeDiscretionaryAmt(fields)
    od.decodeGoodAfterTime(fields)
    od.decodeFAParams(fields)
    od.decodeModelCode(fields)
    od.decodeGoodTillDate(fields)
    od.decodeRule80A(fields)
    od.decodePercentOffset(fields)
    od.decodeSettlingFirm(fields)
    od.decodeShortSaleParams(fields)
    od.decodeBoxOrderParams(fields)
    od.decodePegToStkOrVolOrderParams(fields)
    od.decodeDisplaySize(fields)
    od.decodeSweepToFill(fields)
    od.decodeAllOrNone(fields)
    od.decodeMinQty(fields)
    od.decodeOcaType(fields)
    od.decodeTriggerMethod(fields)
    od.decodeVolOrderParams(fields, false)
    od.decodeTrailParams(fields)
    od.decodeComboLegs(fields)
    od.decodeSmartComboRoutingParams(fields)
    od.decodeScaleOrderParams(fields)
    od.decodeHedgeParams(fields)
    od.decodeClearingParams(fields)
    od.decodeNotHeld(fields)
    od.decodeDeltaNeutral(fields)
    od.decodeAlgoParams(fields)
    od.decodeSolicited(fields)
    od.decodeOrderStatus(fields)
    od.decodeVolRandomizeFlags(fields)
    od.decodePegToBenchParams(fields)
    od.decodeConditions(fields)
    od.decodeStopPriceAndLmtPriceOffset(fields)
    od.decodeCashQty(fields)
    od.decodeDontUseAutoPriceForHedge(fields)
    od.decodeIsOmsContainers(fields)
    od.decodeAutoCancelDate(fields)
    od.decodeFilledQuantity(fields)
    od.decodeRefFuturesConId(fields)
    od.decodeAutoCancelParent(fields)
    od.decodeShareholder(fields)
    od.decodeImbalanceOnly(fields)
    od.decodeRouteMarketableToBbo(fields)
    od.decodeParentPermId(fields)
    od.decodeCompletedTime(fields)
    od.decodeCompletedStatus(fields)
    od.decodePegBestPegMidOrderAttributes(fields)
    od.decodeCustomerAccount(fields)
    od.decodeProfessionalCustomer(fields)
    od.decodeSubmitter(fields)

    d.wrapper.completedOrder(contract, order, orderState)
  })

  // -----------------------------------------------------------------------
  // IN.COMPLETED_ORDER (101) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.COMPLETED_ORDER, (d, buf) => {
    const proto = CompletedOrderProto.decode(buf)

    // decode contract fields
    if (!proto.contract) return
    const contract = decodeContractFromProto(proto.contract)

    // decode order fields
    if (!proto.order) return
    const order = decodeOrderFromProto(UNSET_INTEGER, proto.contract, proto.order)

    // decode order state fields
    if (!proto.orderState) return
    const orderState = decodeOrderStateFromProto(proto.orderState)

    d.wrapper.completedOrder(contract, order, orderState)
  })

  // -----------------------------------------------------------------------
  // IN.COMPLETED_ORDERS_END (102) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.COMPLETED_ORDERS_END, (d, fields) => {
    decodeInt(fields) // msgId
    d.wrapper.completedOrdersEnd()
  })

  // -----------------------------------------------------------------------
  // IN.COMPLETED_ORDERS_END (102) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.COMPLETED_ORDERS_END, (d, buf) => {
    CompletedOrdersEndProto.decode(buf)
    d.wrapper.completedOrdersEnd()
  })

  // -----------------------------------------------------------------------
  // IN.NEXT_VALID_ID (9) — text
  // -----------------------------------------------------------------------
  decoder.registerText(IN.NEXT_VALID_ID, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const orderId = decodeInt(fields)
    d.wrapper.nextValidId(orderId)
  })

  // -----------------------------------------------------------------------
  // IN.NEXT_VALID_ID (9) — protobuf
  // -----------------------------------------------------------------------
  decoder.registerProto(IN.NEXT_VALID_ID, (d, buf) => {
    const proto = NextValidIdProto.decode(buf)
    d.wrapper.nextValidId(proto.orderId ?? 0)
  })
}

