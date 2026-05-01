/**
 * Mirrors: ibapi/order.py
 */

import Decimal from 'decimal.js'
import { UNSET_DOUBLE, UNSET_INTEGER, UNSET_DECIMAL, DOUBLE_INFINITY } from './const.js'
import { SoftDollarTier } from './softdollartier.js'
import type { TagValueList } from './tag-value.js'
import type { OrderCondition } from './order-condition.js'

// enum Origin
export const CUSTOMER = 0
export const FIRM = 1
export const UNKNOWN = 2

// enum AuctionStrategy
export const AUCTION_UNSET = 0
export const AUCTION_MATCH = 1
export const AUCTION_IMPROVEMENT = 2
export const AUCTION_TRANSPARENT = 3

export const COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID = DOUBLE_INFINITY

function floatMaxString(val: number): string { return val === UNSET_DOUBLE ? '' : String(val) }
function intMaxString(val: number): string { return val === UNSET_INTEGER ? '' : String(val) }
function decimalMaxString(val: Decimal): string { return val.equals(UNSET_DECIMAL) ? '' : val.toString() }
function longMaxString(val: number): string { return val === UNSET_INTEGER ? '' : String(val) }

export class OrderComboLeg {
  price: number = UNSET_DOUBLE

  toString(): string {
    return `${floatMaxString(this.price)}`
  }
}

export class Order {
  softDollarTier: SoftDollarTier = new SoftDollarTier('', '', '')

  // order identifier
  orderId: number = 0
  clientId: number = 0
  permId: number = 0

  // main order fields
  action: string = ''
  totalQuantity: Decimal = UNSET_DECIMAL
  orderType: string = ''
  lmtPrice: Decimal = UNSET_DECIMAL
  auxPrice: Decimal = UNSET_DECIMAL

  // extended order fields
  tif: string = '' // "Time in Force" - DAY, GTC, etc.
  activeStartTime: string = '' // for GTC orders
  activeStopTime: string = '' // for GTC orders
  ocaGroup: string = '' // one cancels all group name
  ocaType: number = 0 // 1 = CANCEL_WITH_BLOCK, 2 = REDUCE_WITH_BLOCK, 3 = REDUCE_NON_BLOCK
  orderRef: string = ''
  transmit: boolean = true // if false, order will be created but not transmitted
  parentId: number = 0 // Parent order id, to associate Auto STP or TRAIL orders with the original order.
  blockOrder: boolean = false
  sweepToFill: boolean = false
  displaySize: number = 0
  triggerMethod: number = 0 // 0=Default, 1=Double_Bid_Ask, 2=Last, 3=Double_Last, 4=Bid_Ask, 7=Last_or_Bid_Ask, 8=Mid-point
  outsideRth: boolean = false
  hidden: boolean = false
  goodAfterTime: string = '' // Format: 20060505 08:00:00 {time zone}
  goodTillDate: string = '' // Format: 20060505 08:00:00 {time zone}
  rule80A: string = '' // Individual = 'I', Agency = 'A', AgentOtherMember = 'W', IndividualPTIA = 'J', AgencyPTIA = 'U', AgentOtherMemberPTIA = 'M', IndividualPT = 'K', AgencyPT = 'Y', AgentOtherMemberPT = 'N'
  allOrNone: boolean = false
  minQty: number = UNSET_INTEGER
  percentOffset: number = UNSET_DOUBLE // REL orders only
  overridePercentageConstraints: boolean = false
  trailStopPrice: Decimal = UNSET_DECIMAL
  trailingPercent: Decimal = UNSET_DECIMAL // TRAILLIMIT orders only

  // financial advisors only
  faGroup: string = ''
  faMethod: string = ''
  faPercentage: string = ''

  // institutional (ie non-cleared) only
  designatedLocation: string = '' // used only when shortSaleSlot=2
  openClose: string = '' // O=Open, C=Close
  origin: number = CUSTOMER // 0=Customer, 1=Firm
  shortSaleSlot: number = 0 // 1 if you hold the shares, 2 if they will be delivered from elsewhere. Only for Action=SSHORT
  exemptCode: number = -1

  // SMART routing only
  discretionaryAmt: number = 0
  optOutSmartRouting: boolean = false

  // BOX exchange orders only
  auctionStrategy: number = AUCTION_UNSET // AUCTION_MATCH, AUCTION_IMPROVEMENT, AUCTION_TRANSPARENT
  startingPrice: number = UNSET_DOUBLE
  stockRefPrice: number = UNSET_DOUBLE
  delta: number = UNSET_DOUBLE

  // pegged to stock and VOL orders only
  stockRangeLower: number = UNSET_DOUBLE
  stockRangeUpper: number = UNSET_DOUBLE

  randomizePrice: boolean = false
  randomizeSize: boolean = false

  // VOLATILITY ORDERS ONLY
  volatility: number = UNSET_DOUBLE
  volatilityType: number = UNSET_INTEGER // 1=daily, 2=annual
  deltaNeutralOrderType: string = ''
  deltaNeutralAuxPrice: number = UNSET_DOUBLE
  deltaNeutralConId: number = 0
  deltaNeutralSettlingFirm: string = ''
  deltaNeutralClearingAccount: string = ''
  deltaNeutralClearingIntent: string = ''
  deltaNeutralOpenClose: string = ''
  deltaNeutralShortSale: boolean = false
  deltaNeutralShortSaleSlot: number = 0
  deltaNeutralDesignatedLocation: string = ''
  continuousUpdate: boolean = false
  referencePriceType: number = UNSET_INTEGER // 1=Average, 2 = BidOrAsk

  // COMBO ORDERS ONLY
  basisPoints: number = UNSET_DOUBLE // EFP orders only
  basisPointsType: number = UNSET_INTEGER // EFP orders only

  // SCALE ORDERS ONLY
  scaleInitLevelSize: number = UNSET_INTEGER
  scaleSubsLevelSize: number = UNSET_INTEGER
  scalePriceIncrement: number = UNSET_DOUBLE
  scalePriceAdjustValue: number = UNSET_DOUBLE
  scalePriceAdjustInterval: number = UNSET_INTEGER
  scaleProfitOffset: number = UNSET_DOUBLE
  scaleAutoReset: boolean = false
  scaleInitPosition: number = UNSET_INTEGER
  scaleInitFillQty: number = UNSET_INTEGER
  scaleRandomPercent: boolean = false
  scaleTable: string = ''

  // HEDGE ORDERS
  hedgeType: string = '' // 'D' - delta, 'B' - beta, 'F' - FX, 'P' - pair
  hedgeParam: string = '' // 'beta=X' value for beta hedge, 'ratio=Y' for pair hedge

  // Clearing info
  account: string = '' // IB account
  settlingFirm: string = ''
  clearingAccount: string = '' // True beneficiary of the order
  clearingIntent: string = '' // "" (Default), "IB", "Away", "PTA" (PostTrade)

  // ALGO ORDERS ONLY
  algoStrategy: string = ''

  algoParams: TagValueList = null
  smartComboRoutingParams: TagValueList = null

  algoId: string = ''

  // What-if
  whatIf: boolean = false

  // Not Held
  notHeld: boolean = false
  solicited: boolean = false

  // models
  modelCode: string = ''

  // order combo legs
  orderComboLegs: OrderComboLeg[] | null = null

  orderMiscOptions: TagValueList = null

  // VER PEG2BENCH fields:
  referenceContractId: number = 0
  peggedChangeAmount: number = 0.0
  isPeggedChangeAmountDecrease: boolean = false
  referenceChangeAmount: number = 0.0
  referenceExchangeId: string = ''
  adjustedOrderType: string = ''

  triggerPrice: number = UNSET_DOUBLE
  adjustedStopPrice: number = UNSET_DOUBLE
  adjustedStopLimitPrice: number = UNSET_DOUBLE
  adjustedTrailingAmount: number = UNSET_DOUBLE
  adjustableTrailingUnit: number = 0
  lmtPriceOffset: number = UNSET_DOUBLE

  conditions: OrderCondition[] = []
  conditionsCancelOrder: boolean = false
  conditionsIgnoreRth: boolean = false

  // ext operator
  extOperator: string = ''

  // native cash quantity
  cashQty: Decimal = UNSET_DECIMAL

  mifid2DecisionMaker: string = ''
  mifid2DecisionAlgo: string = ''
  mifid2ExecutionTrader: string = ''
  mifid2ExecutionAlgo: string = ''

  dontUseAutoPriceForHedge: boolean = false

  isOmsContainer: boolean = false

  discretionaryUpToLimitPrice: boolean = false

  autoCancelDate: string = ''
  filledQuantity: Decimal = UNSET_DECIMAL
  refFuturesConId: number = 0
  autoCancelParent: boolean = false
  shareholder: string = ''
  imbalanceOnly: boolean = false
  routeMarketableToBbo: boolean | null = null
  parentPermId: number = 0

  usePriceMgmtAlgo: boolean | null = null
  duration: number = UNSET_INTEGER
  postToAts: number = UNSET_INTEGER
  advancedErrorOverride: string = ''
  manualOrderTime: string = ''
  minTradeQty: number = UNSET_INTEGER
  minCompeteSize: number = UNSET_INTEGER
  competeAgainstBestOffset: number = UNSET_DOUBLE
  midOffsetAtWhole: number = UNSET_DOUBLE
  midOffsetAtHalf: number = UNSET_DOUBLE
  customerAccount: string = ''
  professionalCustomer: boolean = false
  bondAccruedInterest: string = ''
  includeOvernight: boolean = false
  manualOrderIndicator: number = UNSET_INTEGER
  submitter: string = ''
  postOnly: boolean = false
  allowPreOpen: boolean = false
  ignoreOpenAuction: boolean = false
  deactivate: boolean = false
  seekPriceImprovement: boolean | null = null
  whatIfType: number = UNSET_INTEGER

  // attached orders
  slOrderId: number = UNSET_INTEGER
  slOrderType: string = ''
  ptOrderId: number = UNSET_INTEGER
  ptOrderType: string = ''

  toString(): string {
    let s = `${intMaxString(this.orderId)},${intMaxString(this.clientId)},${longMaxString(this.permId)}:`

    s += ` ${this.orderType} ${this.action} ${decimalMaxString(this.totalQuantity)}@${decimalMaxString(this.lmtPrice)}`

    s += ` ${this.tif}`

    if (this.orderComboLegs) {
      s += ' CMB('
      for (const leg of this.orderComboLegs) {
        s += leg.toString() + ','
      }
      s += ')'
    }

    if (this.conditions.length > 0) {
      s += ' COND('
      for (const cond of this.conditions) {
        s += String(cond) + ','
      }
      s += ')'
    }

    return s
  }
}
