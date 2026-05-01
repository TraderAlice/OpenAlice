/**
 * EClient market data request methods.
 * Mirrors: ibapi/client.py lines 627-1820
 */

import { EClient } from './base.js'
import { encodeContractLegacy } from './encode.js'
import { makeField, makeFieldHandleEmpty } from '../comm.js'
import { OUT } from '@traderalice/ibkr-types'
import * as SV from '@traderalice/ibkr-types'
import { NO_VALID_ID } from '@traderalice/ibkr-types'
import * as errors from '@traderalice/ibkr-types'
import { currentTimeMillis } from '../utils.js'
import type { Contract } from '@traderalice/ibkr-types'
import type { TagValueList } from '@traderalice/ibkr-types'

declare module './base.js' {
  interface EClient {
    reqCurrentTime(): void
    reqCurrentTimeInMillis(): void
    setServerLogLevel(logLevel: number): void
    reqMktData(reqId: number, contract: Contract, genericTickList: string, snapshot: boolean, regulatorySnapshot: boolean, mktDataOptions: TagValueList): void
    cancelMktData(reqId: number): void
    reqMarketDataType(marketDataType: number): void
    reqSmartComponents(reqId: number, bboExchange: string): void
    reqMarketRule(marketRuleId: number): void
    reqTickByTickData(reqId: number, contract: Contract, tickType: string, numberOfTicks: number, ignoreSize: boolean): void
    cancelTickByTickData(reqId: number): void
    calculateImpliedVolatility(reqId: number, contract: Contract, optionPrice: number, underPrice: number, implVolOptions: TagValueList): void
    cancelCalculateImpliedVolatility(reqId: number): void
    calculateOptionPrice(reqId: number, contract: Contract, volatility: number, underPrice: number, optPrcOptions: TagValueList): void
    cancelCalculateOptionPrice(reqId: number): void
    exerciseOptions(reqId: number, contract: Contract, exerciseAction: number, exerciseQuantity: number, account: string, override: number, manualOrderTime: string, customerAccount: string, professionalCustomer: boolean): void
  }
}

export function applyMarketData(Client: typeof EClient): void {

  Client.prototype.reqCurrentTime = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_CURRENT_TIME, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQCURRTIME.code(), errors.FAIL_SEND_REQCURRTIME.msg() + String(ex))
    }
  }

  Client.prototype.reqCurrentTimeInMillis = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_CURRENT_TIME_IN_MILLIS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQCURRTIMEINMILLIS.code(), errors.FAIL_SEND_REQCURRTIMEINMILLIS.msg() + String(ex))
    }
  }

  Client.prototype.setServerLogLevel = function (this: EClient, logLevel: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.SET_SERVER_LOGLEVEL, makeField(1) + makeField(logLevel))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_SERVER_LOG_LEVEL.code(), errors.FAIL_SEND_SERVER_LOG_LEVEL.msg() + String(ex))
    }
  }

  Client.prototype.reqMktData = function (
    this: EClient, reqId: number, contract: Contract, genericTickList: string,
    snapshot: boolean, regulatorySnapshot: boolean, mktDataOptions: TagValueList,
  ): void {
    if (!this.requireConnected(reqId)) return
    try {
      const VERSION = 11
      const flds: string[] = [makeField(VERSION), makeField(reqId)]

      if (this.serverVersion() >= SV.MIN_SERVER_VER_REQ_MKT_DATA_CONID) {
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

      // Combo legs for BAG
      if (contract.secType === 'BAG') {
        const comboLegsCount = contract.comboLegs?.length ?? 0
        flds.push(makeField(comboLegsCount))
        if (contract.comboLegs) {
          for (const leg of contract.comboLegs) {
            flds.push(makeField(leg.conId), makeField(leg.ratio), makeField(leg.action), makeField(leg.exchange))
          }
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_DELTA_NEUTRAL) {
        if (contract.deltaNeutralContract) {
          flds.push(makeField(true), makeField(contract.deltaNeutralContract.conId), makeField(contract.deltaNeutralContract.delta), makeField(contract.deltaNeutralContract.price))
        } else {
          flds.push(makeField(false))
        }
      }

      flds.push(makeField(genericTickList), makeField(snapshot))

      if (this.serverVersion() >= SV.MIN_SERVER_VER_REQ_SMART_COMPONENTS) {
        flds.push(makeField(regulatorySnapshot))
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        flds.push(makeField('')) // mktDataOptions — internal use only
      }

      this.sendMsg(OUT.REQ_MKT_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQMKT.code(), errors.FAIL_SEND_REQMKT.msg() + String(ex))
    }
  }

  Client.prototype.cancelMktData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return
    try {
      this.sendMsg(OUT.CANCEL_MKT_DATA, makeField(2) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANMKT.code(), errors.FAIL_SEND_CANMKT.msg() + String(ex))
    }
  }

  Client.prototype.reqMarketDataType = function (this: EClient, marketDataType: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_MARKET_DATA_TYPE, makeField(1) + makeField(marketDataType))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMARKETDATATYPE.code(), errors.FAIL_SEND_REQMARKETDATATYPE.msg() + String(ex))
    }
  }

  Client.prototype.reqSmartComponents = function (this: EClient, reqId: number, bboExchange: string): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_SMART_COMPONENTS, makeField(reqId) + makeField(bboExchange))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQSMARTCOMPONENTS.code(), errors.FAIL_SEND_REQSMARTCOMPONENTS.msg() + String(ex))
    }
  }

  Client.prototype.reqMarketRule = function (this: EClient, marketRuleId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_MARKET_RULE, makeField(marketRuleId))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMARKETRULE.code(), errors.FAIL_SEND_REQMARKETRULE.msg() + String(ex))
    }
  }

  Client.prototype.reqTickByTickData = function (
    this: EClient, reqId: number, contract: Contract, tickType: string,
    numberOfTicks: number, ignoreSize: boolean,
  ): void {
    if (!this.requireConnected()) return
    try {
      const flds = [
        makeField(reqId),
        ...encodeContractLegacy(this, contract),
        makeField(tickType),
      ]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TICK_BY_TICK_IGNORE_SIZE) {
        flds.push(makeField(numberOfTicks), makeField(ignoreSize))
      }
      this.sendMsg(OUT.REQ_TICK_BY_TICK_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQTICKBYTICKDATA.code(), errors.FAIL_SEND_REQTICKBYTICKDATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelTickByTickData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_TICK_BY_TICK_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCELTICKBYTICKDATA.code(), errors.FAIL_SEND_CANCELTICKBYTICKDATA.msg() + String(ex))
    }
  }

  Client.prototype.calculateImpliedVolatility = function (
    this: EClient, reqId: number, contract: Contract,
    optionPrice: number, underPrice: number, implVolOptions: TagValueList,
  ): void {
    if (!this.requireConnected(reqId)) return
    try {
      const flds = [
        makeField(3), makeField(reqId),
        makeField(contract.conId), makeField(contract.symbol), makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth), makeFieldHandleEmpty(contract.strike),
        makeField(contract.right), makeField(contract.multiplier), makeField(contract.exchange),
        makeField(contract.primaryExchange), makeField(contract.currency), makeField(contract.localSymbol),
      ]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.tradingClass))
      flds.push(makeField(optionPrice), makeField(underPrice))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) flds.push(makeField(''))
      this.sendMsg(OUT.REQ_CALC_IMPLIED_VOLAT, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQCALCIMPLIEDVOLAT.code(), errors.FAIL_SEND_REQCALCIMPLIEDVOLAT.msg() + String(ex))
    }
  }

  Client.prototype.cancelCalculateImpliedVolatility = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return
    try {
      this.sendMsg(OUT.CANCEL_CALC_IMPLIED_VOLAT, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCALCIMPLIEDVOLAT.code(), errors.FAIL_SEND_CANCALCIMPLIEDVOLAT.msg() + String(ex))
    }
  }

  Client.prototype.calculateOptionPrice = function (
    this: EClient, reqId: number, contract: Contract,
    volatility: number, underPrice: number, optPrcOptions: TagValueList,
  ): void {
    if (!this.requireConnected(reqId)) return
    try {
      const flds = [
        makeField(3), makeField(reqId),
        makeField(contract.conId), makeField(contract.symbol), makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth), makeFieldHandleEmpty(contract.strike),
        makeField(contract.right), makeField(contract.multiplier), makeField(contract.exchange),
        makeField(contract.primaryExchange), makeField(contract.currency), makeField(contract.localSymbol),
      ]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.tradingClass))
      flds.push(makeField(volatility), makeField(underPrice))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) flds.push(makeField(''))
      this.sendMsg(OUT.REQ_CALC_OPTION_PRICE, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQCALCOPTIONPRICE.code(), errors.FAIL_SEND_REQCALCOPTIONPRICE.msg() + String(ex))
    }
  }

  Client.prototype.cancelCalculateOptionPrice = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return
    try {
      this.sendMsg(OUT.CANCEL_CALC_OPTION_PRICE, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCALCOPTIONPRICE.code(), errors.FAIL_SEND_CANCALCOPTIONPRICE.msg() + String(ex))
    }
  }

  Client.prototype.exerciseOptions = function (
    this: EClient, reqId: number, contract: Contract, exerciseAction: number,
    exerciseQuantity: number, account: string, override: number,
    manualOrderTime: string, customerAccount: string, professionalCustomer: boolean,
  ): void {
    if (!this.requireConnected(reqId)) return
    try {
      const flds = [makeField(2), makeField(reqId)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.conId))
      flds.push(
        makeField(contract.symbol), makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth), makeFieldHandleEmpty(contract.strike),
        makeField(contract.right), makeField(contract.multiplier), makeField(contract.exchange),
        makeField(contract.currency), makeField(contract.localSymbol),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.tradingClass))
      flds.push(makeField(exerciseAction), makeField(exerciseQuantity), makeField(account), makeField(override))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_MANUAL_ORDER_TIME_EXERCISE_OPTIONS) flds.push(makeField(manualOrderTime))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_CUSTOMER_ACCOUNT) flds.push(makeField(customerAccount))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_PROFESSIONAL_CUSTOMER) flds.push(makeField(professionalCustomer))
      this.sendMsg(OUT.EXERCISE_OPTIONS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQMKT.code(), errors.FAIL_SEND_REQMKT.msg() + String(ex))
    }
  }
}
