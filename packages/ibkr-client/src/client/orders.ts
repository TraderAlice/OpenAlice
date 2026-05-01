/**
 * EClient order methods — place, cancel, query orders.
 * Mirrors: ibapi/client.py lines 1820-3210, 6984-7025
 */

import { EClient } from './base.js'
import { makeField, makeFieldHandleEmpty } from '../comm.js'
import { OUT } from '@traderalice/ibkr-types'
import * as SV from '@traderalice/ibkr-types'
import { NO_VALID_ID, UNSET_DOUBLE, UNSET_INTEGER, UNSET_DECIMAL } from '@traderalice/ibkr-types'
import * as errors from '@traderalice/ibkr-types'
import { currentTimeMillis, isPegBenchOrder, isPegBestOrder, isPegMidOrder } from '../utils.js'
import { COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID } from '@traderalice/ibkr-types'
import type { Contract } from '@traderalice/ibkr-types'
import type { Order } from '@traderalice/ibkr-types'
import type { OrderCancel } from '@traderalice/ibkr-types'

declare module './base.js' {
  interface EClient {
    placeOrder(orderId: number, contract: Contract, order: Order): void
    cancelOrder(orderId: number, orderCancel: OrderCancel): void
    reqOpenOrders(): void
    reqAutoOpenOrders(bAutoBind: boolean): void
    reqAllOpenOrders(): void
    reqGlobalCancel(orderCancel: OrderCancel): void
    reqIds(numIds: number): void
    reqCompletedOrders(apiOnly: boolean): void
  }
}

export function applyOrders(Client: typeof EClient): void {

  Client.prototype.placeOrder = function (this: EClient, orderId: number, contract: Contract, order: Order): void {
    if (!this.requireConnected(orderId)) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_DELTA_NEUTRAL) {
      if (contract.deltaNeutralContract) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support delta-neutral orders.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SCALE_ORDERS2) {
      if (order.scaleSubsLevelSize !== UNSET_INTEGER) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support Subsequent Level Size for Scale orders.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ALGO_ORDERS) {
      if (order.algoStrategy) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support algo orders.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_NOT_HELD) {
      if (order.notHeld) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support notHeld parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SEC_ID_TYPE) {
      if (contract.secIdType || contract.secId) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support secIdType and secId parameters.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_PLACE_ORDER_CONID) {
      if (contract.conId && contract.conId > 0) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support conId parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SSHORTX) {
      if (order.exemptCode !== -1) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support exemptCode parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SSHORTX) {
      if (contract.comboLegs) {
        for (const comboLeg of contract.comboLegs) {
          if (comboLeg.exemptCode !== -1) {
            this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support exemptCode parameter.')
            return
          }
        }
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_HEDGE_ORDERS) {
      if (order.hedgeType) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support hedge orders.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_OPT_OUT_SMART_ROUTING) {
      if (order.optOutSmartRouting) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support optOutSmartRouting parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_DELTA_NEUTRAL_CONID) {
      if (
        order.deltaNeutralConId > 0 ||
        order.deltaNeutralSettlingFirm ||
        order.deltaNeutralClearingAccount ||
        order.deltaNeutralClearingIntent
      ) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support deltaNeutral parameters: ConId, SettlingFirm, ClearingAccount, ClearingIntent.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_DELTA_NEUTRAL_OPEN_CLOSE) {
      if (
        order.deltaNeutralOpenClose ||
        order.deltaNeutralShortSale ||
        order.deltaNeutralShortSaleSlot > 0 ||
        order.deltaNeutralDesignatedLocation
      ) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support deltaNeutral parameters: OpenClose, ShortSale, ShortSaleSlot, DesignatedLocation.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SCALE_ORDERS3) {
      if (order.scalePriceIncrement > 0 && order.scalePriceIncrement !== UNSET_DOUBLE) {
        if (
          order.scalePriceAdjustValue !== UNSET_DOUBLE ||
          order.scalePriceAdjustInterval !== UNSET_INTEGER ||
          order.scaleProfitOffset !== UNSET_DOUBLE ||
          order.scaleAutoReset ||
          order.scaleInitPosition !== UNSET_INTEGER ||
          order.scaleInitFillQty !== UNSET_INTEGER ||
          order.scaleRandomPercent
        ) {
          this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support Scale order parameters: PriceAdjustValue, PriceAdjustInterval, ProfitOffset, AutoReset, InitPosition, InitFillQty and RandomPercent')
          return
        }
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE && contract.secType === 'BAG') {
      if (order.orderComboLegs) {
        for (const orderComboLeg of order.orderComboLegs) {
          if (orderComboLeg.price !== UNSET_DOUBLE) {
            this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support per-leg prices for order combo legs.')
            return
          }
        }
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_TRAILING_PERCENT) {
      if (!order.trailingPercent.equals(UNSET_DECIMAL)) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support trailing percent parameter')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_TRADING_CLASS) {
      if (contract.tradingClass) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support tradingClass parameter in placeOrder.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SCALE_TABLE) {
      if (order.scaleTable || order.activeStartTime || order.activeStopTime) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support scaleTable, activeStartTime and activeStopTime parameters')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ALGO_ID) {
      if (order.algoId) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support algoId parameter')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ORDER_SOLICITED) {
      if (order.solicited) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support order solicited parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_MODELS_SUPPORT) {
      if (order.modelCode) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support model code parameter.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_EXT_OPERATOR) {
      if (order.extOperator) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support ext operator parameter')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_SOFT_DOLLAR_TIER) {
      if (order.softDollarTier.name || order.softDollarTier.val) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support soft dollar tier')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_CASH_QTY) {
      if (!order.cashQty.equals(UNSET_DECIMAL)) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support cash quantity parameter')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_DECISION_MAKER && (order.mifid2DecisionMaker !== '' || order.mifid2DecisionAlgo !== '')) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support MIFID II decision maker parameters')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_MIFID_EXECUTION && (order.mifid2ExecutionTrader !== '' || order.mifid2ExecutionAlgo !== '')) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support MIFID II execution parameters')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE && order.dontUseAutoPriceForHedge) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support dontUseAutoPriceForHedge parameter')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ORDER_CONTAINER && order.isOmsContainer) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support oms container parameter')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_PRICE_MGMT_ALGO && order.usePriceMgmtAlgo) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support Use price management algo requests')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_DURATION && order.duration !== UNSET_INTEGER) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support duration attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_POST_TO_ATS && order.postToAts !== UNSET_INTEGER) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support postToAts attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_AUTO_CANCEL_PARENT && order.autoCancelParent) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support autoCancelParent attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_ADVANCED_ORDER_REJECT && order.advancedErrorOverride) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support advanced error override attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_MANUAL_ORDER_TIME && order.manualOrderTime) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support manual order time attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS) {
      if (
        order.minTradeQty !== UNSET_INTEGER ||
        order.minCompeteSize !== UNSET_INTEGER ||
        order.competeAgainstBestOffset !== UNSET_DOUBLE ||
        order.midOffsetAtWhole !== UNSET_DOUBLE ||
        order.midOffsetAtHalf !== UNSET_DOUBLE
      ) {
        this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support PEG BEST / PEG MID order parameters: minTradeQty, minCompeteSize, competeAgainstBestOffset, midOffsetAtWhole and midOffsetAtHalf')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_CUSTOMER_ACCOUNT && order.customerAccount) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support customer account parameter')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_PROFESSIONAL_CUSTOMER && order.professionalCustomer) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support professional customer parameter')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_INCLUDE_OVERNIGHT && order.includeOvernight) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support include overnight parameter')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_CME_TAGGING_FIELDS && order.manualOrderIndicator !== UNSET_INTEGER) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support manual order indicator parameters')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_IMBALANCE_ONLY && order.imbalanceOnly) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support imbalance only parameter')
      return
    }

    try {
      const VERSION = this.serverVersion() < SV.MIN_SERVER_VER_NOT_HELD ? 27 : 45

      const flds: string[] = []

      if (this.serverVersion() < SV.MIN_SERVER_VER_ORDER_CONTAINER) {
        flds.push(makeField(VERSION))
      }

      flds.push(makeField(orderId))

      // send contract fields
      if (this.serverVersion() >= SV.MIN_SERVER_VER_PLACE_ORDER_CONID) {
        flds.push(makeField(contract.conId))
      }
      flds.push(
        makeField(contract.symbol),
        makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth),
        makeFieldHandleEmpty(contract.strike),
        makeField(contract.right),
        makeField(contract.multiplier),
        makeField(contract.exchange),
        makeField(contract.primaryExchange),
        makeField(contract.currency),
        makeField(contract.localSymbol),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
        flds.push(makeField(contract.tradingClass))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_SEC_ID_TYPE) {
        flds.push(makeField(contract.secIdType), makeField(contract.secId))
      }

      // send main order fields
      flds.push(makeField(order.action))

      if (this.serverVersion() >= SV.MIN_SERVER_VER_FRACTIONAL_POSITIONS) {
        flds.push(makeField(order.totalQuantity))
      } else {
        flds.push(makeField(order.totalQuantity.toNumber() | 0))
      }

      flds.push(makeField(order.orderType))
      if (this.serverVersion() < SV.MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE) {
        flds.push(makeField(!order.lmtPrice.equals(UNSET_DECIMAL) ? order.lmtPrice : 0))
      } else {
        flds.push(makeFieldHandleEmpty(order.lmtPrice))
      }
      if (this.serverVersion() < SV.MIN_SERVER_VER_TRAILING_PERCENT) {
        flds.push(makeField(!order.auxPrice.equals(UNSET_DECIMAL) ? order.auxPrice : 0))
      } else {
        flds.push(makeFieldHandleEmpty(order.auxPrice))
      }

      // send extended order fields
      flds.push(
        makeField(order.tif),
        makeField(order.ocaGroup),
        makeField(order.account),
        makeField(order.openClose),
        makeField(order.origin),
        makeField(order.orderRef),
        makeField(order.transmit),
        makeField(order.parentId),
        makeField(order.blockOrder),
        makeField(order.sweepToFill),
        makeField(order.displaySize),
        makeField(order.triggerMethod),
        makeField(order.outsideRth),
        makeField(order.hidden),
      )

      // Send combo legs for BAG requests
      if (contract.secType === 'BAG') {
        const comboLegsCount = contract.comboLegs?.length ?? 0
        flds.push(makeField(comboLegsCount))
        if (comboLegsCount > 0 && contract.comboLegs) {
          for (const comboLeg of contract.comboLegs) {
            flds.push(
              makeField(comboLeg.conId),
              makeField(comboLeg.ratio),
              makeField(comboLeg.action),
              makeField(comboLeg.exchange),
              makeField(comboLeg.openClose),
              makeField(comboLeg.shortSaleSlot),
              makeField(comboLeg.designatedLocation),
            )
            if (this.serverVersion() >= SV.MIN_SERVER_VER_SSHORTX_OLD) {
              flds.push(makeField(comboLeg.exemptCode))
            }
          }
        }
      }

      // Send order combo legs for BAG requests
      if (this.serverVersion() >= SV.MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE && contract.secType === 'BAG') {
        const orderComboLegsCount = order.orderComboLegs?.length ?? 0
        flds.push(makeField(orderComboLegsCount))
        if (orderComboLegsCount > 0 && order.orderComboLegs) {
          for (const orderComboLeg of order.orderComboLegs) {
            flds.push(makeFieldHandleEmpty(orderComboLeg.price))
          }
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_SMART_COMBO_ROUTING_PARAMS && contract.secType === 'BAG') {
        const smartComboRoutingParamsCount = order.smartComboRoutingParams?.length ?? 0
        flds.push(makeField(smartComboRoutingParamsCount))
        if (smartComboRoutingParamsCount > 0 && order.smartComboRoutingParams) {
          for (const tagValue of order.smartComboRoutingParams) {
            flds.push(makeField(tagValue.tag), makeField(tagValue.value))
          }
        }
      }

      // send deprecated sharesAllocation field
      flds.push(
        makeField(''),
        makeField(order.discretionaryAmt),
        makeField(order.goodAfterTime),
        makeField(order.goodTillDate),
        makeField(order.faGroup),
        makeField(order.faMethod),
        makeField(order.faPercentage),
      )
      if (this.serverVersion() < SV.MIN_SERVER_VER_FA_PROFILE_DESUPPORT) {
        flds.push(makeField('')) // send deprecated faProfile field
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_MODELS_SUPPORT) {
        flds.push(makeField(order.modelCode))
      }

      // institutional short sale slot data
      flds.push(
        makeField(order.shortSaleSlot),
        makeField(order.designatedLocation),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SSHORTX_OLD) {
        flds.push(makeField(order.exemptCode))
      }

      flds.push(makeField(order.ocaType))

      flds.push(
        makeField(order.rule80A),
        makeField(order.settlingFirm),
        makeField(order.allOrNone),
        makeFieldHandleEmpty(order.minQty),
        makeFieldHandleEmpty(order.percentOffset),
        makeField(false),
        makeField(false),
        makeFieldHandleEmpty(UNSET_DOUBLE),
        makeField(order.auctionStrategy),
        makeFieldHandleEmpty(order.startingPrice),
        makeFieldHandleEmpty(order.stockRefPrice),
        makeFieldHandleEmpty(order.delta),
        makeFieldHandleEmpty(order.stockRangeLower),
        makeFieldHandleEmpty(order.stockRangeUpper),
        makeField(order.overridePercentageConstraints),
        // Volatility orders
        makeFieldHandleEmpty(order.volatility),
        makeFieldHandleEmpty(order.volatilityType),
        makeField(order.deltaNeutralOrderType),
        makeFieldHandleEmpty(order.deltaNeutralAuxPrice),
      )

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DELTA_NEUTRAL_CONID && order.deltaNeutralOrderType) {
        flds.push(
          makeField(order.deltaNeutralConId),
          makeField(order.deltaNeutralSettlingFirm),
          makeField(order.deltaNeutralClearingAccount),
          makeField(order.deltaNeutralClearingIntent),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DELTA_NEUTRAL_OPEN_CLOSE && order.deltaNeutralOrderType) {
        flds.push(
          makeField(order.deltaNeutralOpenClose),
          makeField(order.deltaNeutralShortSale),
          makeField(order.deltaNeutralShortSaleSlot),
          makeField(order.deltaNeutralDesignatedLocation),
        )
      }

      flds.push(
        makeField(order.continuousUpdate),
        makeFieldHandleEmpty(order.referencePriceType),
        makeFieldHandleEmpty(order.trailStopPrice),
      )

      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRAILING_PERCENT) {
        flds.push(makeFieldHandleEmpty(order.trailingPercent))
      }

      // SCALE orders
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SCALE_ORDERS2) {
        flds.push(
          makeFieldHandleEmpty(order.scaleInitLevelSize),
          makeFieldHandleEmpty(order.scaleSubsLevelSize),
        )
      } else {
        flds.push(
          makeField(''), // for not supported scaleNumComponents
          makeFieldHandleEmpty(order.scaleInitLevelSize),
        )
      }

      flds.push(makeFieldHandleEmpty(order.scalePriceIncrement))

      if (
        this.serverVersion() >= SV.MIN_SERVER_VER_SCALE_ORDERS3 &&
        order.scalePriceIncrement !== UNSET_DOUBLE &&
        order.scalePriceIncrement > 0.0
      ) {
        flds.push(
          makeFieldHandleEmpty(order.scalePriceAdjustValue),
          makeFieldHandleEmpty(order.scalePriceAdjustInterval),
          makeFieldHandleEmpty(order.scaleProfitOffset),
          makeField(order.scaleAutoReset),
          makeFieldHandleEmpty(order.scaleInitPosition),
          makeFieldHandleEmpty(order.scaleInitFillQty),
          makeField(order.scaleRandomPercent),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_SCALE_TABLE) {
        flds.push(
          makeField(order.scaleTable),
          makeField(order.activeStartTime),
          makeField(order.activeStopTime),
        )
      }

      // HEDGE orders
      if (this.serverVersion() >= SV.MIN_SERVER_VER_HEDGE_ORDERS) {
        flds.push(makeField(order.hedgeType))
        if (order.hedgeType) {
          flds.push(makeField(order.hedgeParam))
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_OPT_OUT_SMART_ROUTING) {
        flds.push(makeField(order.optOutSmartRouting))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_PTA_ORDERS) {
        flds.push(
          makeField(order.clearingAccount),
          makeField(order.clearingIntent),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_NOT_HELD) {
        flds.push(makeField(order.notHeld))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DELTA_NEUTRAL) {
        if (contract.deltaNeutralContract) {
          flds.push(
            makeField(true),
            makeField(contract.deltaNeutralContract.conId),
            makeField(contract.deltaNeutralContract.delta),
            makeField(contract.deltaNeutralContract.price),
          )
        } else {
          flds.push(makeField(false))
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_ALGO_ORDERS) {
        flds.push(makeField(order.algoStrategy))
        if (order.algoStrategy) {
          const algoParamsCount = order.algoParams?.length ?? 0
          flds.push(makeField(algoParamsCount))
          if (algoParamsCount > 0 && order.algoParams) {
            for (const algoParam of order.algoParams) {
              flds.push(makeField(algoParam.tag), makeField(algoParam.value))
            }
          }
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_ALGO_ID) {
        flds.push(makeField(order.algoId))
      }

      flds.push(makeField(order.whatIf))

      // send miscOptions parameter
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        let miscOptionsStr = ''
        if (order.orderMiscOptions) {
          for (const tagValue of order.orderMiscOptions) {
            miscOptionsStr += String(tagValue)
          }
        }
        flds.push(makeField(miscOptionsStr))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_ORDER_SOLICITED) {
        flds.push(makeField(order.solicited))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_RANDOMIZE_SIZE_AND_PRICE) {
        flds.push(
          makeField(order.randomizeSize),
          makeField(order.randomizePrice),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_PEGGED_TO_BENCHMARK) {
        if (isPegBenchOrder(order.orderType)) {
          flds.push(
            makeField(order.referenceContractId),
            makeField(order.isPeggedChangeAmountDecrease),
            makeField(order.peggedChangeAmount),
            makeField(order.referenceChangeAmount),
            makeField(order.referenceExchangeId),
          )
        }

        flds.push(makeField(order.conditions.length))

        if (order.conditions.length > 0) {
          for (const cond of order.conditions) {
            flds.push(makeField(cond.type()))
            flds.push(...cond.makeFields())
          }

          flds.push(
            makeField(order.conditionsIgnoreRth),
            makeField(order.conditionsCancelOrder),
          )
        }

        flds.push(
          makeField(order.adjustedOrderType),
          makeField(order.triggerPrice),
          makeField(order.lmtPriceOffset),
          makeField(order.adjustedStopPrice),
          makeField(order.adjustedStopLimitPrice),
          makeField(order.adjustedTrailingAmount),
          makeField(order.adjustableTrailingUnit),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_EXT_OPERATOR) {
        flds.push(makeField(order.extOperator))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_SOFT_DOLLAR_TIER) {
        flds.push(
          makeField(order.softDollarTier.name),
          makeField(order.softDollarTier.val),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_CASH_QTY) {
        // Must handle UNSET: sending a raw UNSET_DECIMAL string
        // (~1.7e38) would make TWS think cashQty is actually set.
        flds.push(makeFieldHandleEmpty(order.cashQty))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DECISION_MAKER) {
        flds.push(makeField(order.mifid2DecisionMaker))
        flds.push(makeField(order.mifid2DecisionAlgo))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_MIFID_EXECUTION) {
        flds.push(makeField(order.mifid2ExecutionTrader))
        flds.push(makeField(order.mifid2ExecutionAlgo))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE) {
        flds.push(makeField(order.dontUseAutoPriceForHedge))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_ORDER_CONTAINER) {
        flds.push(makeField(order.isOmsContainer))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_D_PEG_ORDERS) {
        flds.push(makeField(order.discretionaryUpToLimitPrice))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_PRICE_MGMT_ALGO) {
        flds.push(makeFieldHandleEmpty(
          order.usePriceMgmtAlgo == null
            ? UNSET_INTEGER
            : order.usePriceMgmtAlgo ? 1 : 0
        ))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DURATION) {
        flds.push(makeField(order.duration))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_POST_TO_ATS) {
        flds.push(makeField(order.postToAts))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_AUTO_CANCEL_PARENT) {
        flds.push(makeField(order.autoCancelParent))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_ADVANCED_ORDER_REJECT) {
        flds.push(makeField(order.advancedErrorOverride))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_MANUAL_ORDER_TIME) {
        flds.push(makeField(order.manualOrderTime))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS) {
        let sendMidOffsets = false
        if (contract.exchange === 'IBKRATS') {
          flds.push(makeFieldHandleEmpty(order.minTradeQty))
        }
        if (isPegBestOrder(order.orderType)) {
          flds.push(makeFieldHandleEmpty(order.minCompeteSize))
          flds.push(makeFieldHandleEmpty(order.competeAgainstBestOffset))
          if (order.competeAgainstBestOffset === COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID) {
            sendMidOffsets = true
          }
        } else if (isPegMidOrder(order.orderType)) {
          sendMidOffsets = true
        }
        if (sendMidOffsets) {
          flds.push(makeFieldHandleEmpty(order.midOffsetAtWhole))
          flds.push(makeFieldHandleEmpty(order.midOffsetAtHalf))
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_CUSTOMER_ACCOUNT) {
        flds.push(makeField(order.customerAccount))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_PROFESSIONAL_CUSTOMER) {
        flds.push(makeField(order.professionalCustomer))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_RFQ_FIELDS && this.serverVersion() < SV.MIN_SERVER_VER_UNDO_RFQ_FIELDS) {
        flds.push(makeField(''))
        flds.push(makeField(UNSET_INTEGER))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_INCLUDE_OVERNIGHT) {
        flds.push(makeField(order.includeOvernight))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_CME_TAGGING_FIELDS) {
        flds.push(makeField(order.manualOrderIndicator))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_IMBALANCE_ONLY) {
        flds.push(makeField(order.imbalanceOnly))
      }

      this.sendMsg(OUT.PLACE_ORDER, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.FAIL_SEND_ORDER.code(), errors.FAIL_SEND_ORDER.msg() + String(ex))
    }
  }

  Client.prototype.cancelOrder = function (this: EClient, orderId: number, orderCancel: OrderCancel): void {
    if (!this.requireConnected(orderId)) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_MANUAL_ORDER_TIME && orderCancel.manualOrderCancelTime) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + '  It does not support manual order cancel time attribute')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_CME_TAGGING_FIELDS && (orderCancel.extOperator !== '' || orderCancel.manualOrderIndicator !== UNSET_INTEGER)) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support ext operator and manual order indicator parameters')
      return
    }

    try {
      const flds: string[] = []
      if (this.serverVersion() < SV.MIN_SERVER_VER_CME_TAGGING_FIELDS) {
        flds.push(makeField(1)) // VERSION
      }
      flds.push(makeField(orderId))

      if (this.serverVersion() >= SV.MIN_SERVER_VER_MANUAL_ORDER_TIME) {
        flds.push(makeField(orderCancel.manualOrderCancelTime))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_RFQ_FIELDS && this.serverVersion() < SV.MIN_SERVER_VER_UNDO_RFQ_FIELDS) {
        flds.push(makeField(''))
        flds.push(makeField(''))
        flds.push(makeField(UNSET_INTEGER))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_CME_TAGGING_FIELDS) {
        flds.push(makeField(orderCancel.extOperator))
        flds.push(makeField(orderCancel.manualOrderIndicator))
      }

      this.sendMsg(OUT.CANCEL_ORDER, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(orderId, currentTimeMillis(), errors.FAIL_SEND_CORDER.code(), errors.FAIL_SEND_CORDER.msg() + String(ex))
    }
  }

  Client.prototype.reqOpenOrders = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_OPEN_ORDERS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_OORDER.code(), errors.FAIL_SEND_OORDER.msg() + String(ex))
    }
  }

  Client.prototype.reqAutoOpenOrders = function (this: EClient, bAutoBind: boolean): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_AUTO_OPEN_ORDERS, makeField(1) + makeField(bAutoBind))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_OORDER.code(), errors.FAIL_SEND_OORDER.msg() + String(ex))
    }
  }

  Client.prototype.reqAllOpenOrders = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_ALL_OPEN_ORDERS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_OORDER.code(), errors.FAIL_SEND_OORDER.msg() + String(ex))
    }
  }

  Client.prototype.reqGlobalCancel = function (this: EClient, orderCancel: OrderCancel): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_CME_TAGGING_FIELDS && (orderCancel.extOperator !== '' || orderCancel.manualOrderIndicator !== UNSET_INTEGER)) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(), errors.UPDATE_TWS.msg() + ' It does not support ext operator and manual order indicator parameters')
      return
    }

    try {
      const flds: string[] = []
      if (this.serverVersion() < SV.MIN_SERVER_VER_CME_TAGGING_FIELDS) {
        flds.push(makeField(1)) // VERSION
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_CME_TAGGING_FIELDS) {
        flds.push(makeField(orderCancel.extOperator))
        flds.push(makeField(orderCancel.manualOrderIndicator))
      }

      this.sendMsg(OUT.REQ_GLOBAL_CANCEL, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQGLOBALCANCEL.code(), errors.FAIL_SEND_REQGLOBALCANCEL.msg() + String(ex))
    }
  }

  Client.prototype.reqIds = function (this: EClient, numIds: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_IDS, makeField(1) + makeField(numIds))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_CORDER.code(), errors.FAIL_SEND_CORDER.msg() + String(ex))
    }
  }

  Client.prototype.reqCompletedOrders = function (this: EClient, apiOnly: boolean): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_COMPLETED_ORDERS, makeField(apiOnly))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQCOMPLETEDORDERS.code(), errors.FAIL_SEND_REQCOMPLETEDORDERS.msg() + String(ex))
    }
  }
}
