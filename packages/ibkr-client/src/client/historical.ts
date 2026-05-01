/**
 * EClient mixin — historical data, scanner, news, and misc methods.
 * Mirrors: ibapi/client.py (lines ~4842-7500)
 *
 * Applied via applyHistorical() which extends EClient.prototype.
 */

import { EClient } from './base.js'
import { makeField, makeFieldHandleEmpty } from '../comm.js'
import { OUT } from '@traderalice/ibkr-types'
import * as SV from '@traderalice/ibkr-types'
import { NO_VALID_ID, UNSET_INTEGER } from '@traderalice/ibkr-types'
import * as errors from '@traderalice/ibkr-types'
import { currentTimeMillis } from '../utils.js'
import type { Contract } from '@traderalice/ibkr-types'
import type { ScannerSubscription } from '@traderalice/ibkr-types'
import type { TagValueList } from '@traderalice/ibkr-types'
import type { WshEventData } from '@traderalice/ibkr-types'

declare module './base.js' {
  interface EClient {
    reqHistoricalData(reqId: number, contract: Contract, endDateTime: string, durationStr: string, barSizeSetting: string, whatToShow: string, useRTH: number, formatDate: number, keepUpToDate: boolean, chartOptions: TagValueList): void
    cancelHistoricalData(reqId: number): void
    reqHeadTimeStamp(reqId: number, contract: Contract, whatToShow: string, useRTH: number, formatDate: number): void
    cancelHeadTimeStamp(reqId: number): void
    reqHistogramData(tickerId: number, contract: Contract, useRTH: boolean, timePeriod: string): void
    cancelHistogramData(tickerId: number): void
    reqHistoricalTicks(reqId: number, contract: Contract, startDateTime: string, endDateTime: string, numberOfTicks: number, whatToShow: string, useRth: number, ignoreSize: boolean, miscOptions: TagValueList): void
    reqScannerParameters(): void
    reqScannerSubscription(reqId: number, subscription: ScannerSubscription, scannerSubscriptionOptions: TagValueList, scannerSubscriptionFilterOptions: TagValueList): void
    cancelScannerSubscription(reqId: number): void
    reqRealTimeBars(reqId: number, contract: Contract, barSize: number, whatToShow: string, useRTH: boolean, realTimeBarsOptions: TagValueList): void
    cancelRealTimeBars(reqId: number): void
    reqFundamentalData(reqId: number, contract: Contract, reportType: string, fundamentalDataOptions: TagValueList): void
    cancelFundamentalData(reqId: number): void
    reqNewsProviders(): void
    reqNewsArticle(reqId: number, providerCode: string, articleId: string, newsArticleOptions: TagValueList): void
    reqHistoricalNews(reqId: number, conId: number, providerCodes: string, startDateTime: string, endDateTime: string, totalResults: number, historicalNewsOptions: TagValueList): void
    queryDisplayGroups(reqId: number): void
    subscribeToGroupEvents(reqId: number, groupId: number): void
    updateDisplayGroup(reqId: number, contractInfo: string): void
    unsubscribeFromGroupEvents(reqId: number): void
    verifyRequest(apiName: string, apiVersion: string): void
    verifyMessage(apiData: string): void
    verifyAndAuthRequest(apiName: string, apiVersion: string, opaqueIsvKey: string): void
    verifyAndAuthMessage(apiData: string, xyzResponse: string): void
    reqSecDefOptParams(reqId: number, underlyingSymbol: string, futFopExchange: string, underlyingSecType: string, underlyingConId: number): void
    reqSoftDollarTiers(reqId: number): void
    reqFamilyCodes(): void
    reqMatchingSymbols(reqId: number, pattern: string): void
    reqWshMetaData(reqId: number): void
    cancelWshMetaData(reqId: number): void
    reqWshEventData(reqId: number, wshEventData: WshEventData): void
    cancelWshEventData(reqId: number): void
    reqUserInfo(reqId: number): void
    cancelContractData(reqId: number): void
    cancelHistoricalTicks(reqId: number): void
  }
}

/** Helper: serialize a TagValueList into a wire string. */
function tagValueListToStr(list: TagValueList): string {
  if (!list) return ''
  let s = ''
  for (const tv of list) {
    s += String(tv)
  }
  return s
}

export function applyHistorical(Client: typeof EClient): void {

  // ─── Historical Data ───────────────────────────────────────────────

  Client.prototype.reqHistoricalData = function (
    this: EClient, reqId: number, contract: Contract, endDateTime: string,
    durationStr: string, barSizeSetting: string, whatToShow: string,
    useRTH: number, formatDate: number, keepUpToDate: boolean,
    chartOptions: TagValueList,
  ): void {
    if (!this.requireConnected(reqId)) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_TRADING_CLASS) {
      if (contract.tradingClass || contract.conId > 0) {
        this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
          errors.UPDATE_TWS.msg() + '  It does not support conId and tradingClass parameters in reqHistoricalData.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_HISTORICAL_SCHEDULE) {
      if (whatToShow === 'SCHEDULE') {
        this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
          errors.UPDATE_TWS.msg() + '  It does not support requesting of historical schedule.')
        return
      }
    }

    try {
      const VERSION = 6
      const flds: string[] = []

      if (this.serverVersion() < SV.MIN_SERVER_VER_SYNT_REALTIME_BARS) {
        flds.push(makeField(VERSION))
      }

      flds.push(makeField(reqId))

      // contract fields
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
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
      flds.push(
        makeField(contract.includeExpired),
        makeField(endDateTime),
        makeField(barSizeSetting),
        makeField(durationStr),
        makeField(useRTH),
        makeField(whatToShow),
        makeField(formatDate),
      )

      // combo legs for BAG
      if (contract.secType === 'BAG') {
        const comboLegsCount = contract.comboLegs?.length ?? 0
        flds.push(makeField(comboLegsCount))
        if (contract.comboLegs) {
          for (const leg of contract.comboLegs) {
            flds.push(makeField(leg.conId), makeField(leg.ratio), makeField(leg.action), makeField(leg.exchange))
          }
        }
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_SYNT_REALTIME_BARS) {
        flds.push(makeField(keepUpToDate))
      }

      // chartOptions
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        flds.push(makeField(tagValueListToStr(chartOptions)))
      }

      this.sendMsg(OUT.REQ_HISTORICAL_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQHISTDATA.code(), errors.FAIL_SEND_REQHISTDATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelHistoricalData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_HISTORICAL_DATA, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANHISTDATA.code(), errors.FAIL_SEND_CANHISTDATA.msg() + String(ex))
    }
  }

  // ─── Head Time Stamp ───────────────────────────────────────────────

  Client.prototype.reqHeadTimeStamp = function (
    this: EClient, reqId: number, contract: Contract,
    whatToShow: string, useRTH: number, formatDate: number,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_HEAD_TIMESTAMP) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support head time stamp requests.')
      return
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(contract.conId),
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
        makeField(contract.tradingClass),
        makeField(contract.includeExpired),
        makeField(useRTH),
        makeField(whatToShow),
        makeField(formatDate),
      ]
      this.sendMsg(OUT.REQ_HEAD_TIMESTAMP, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQHEADTIMESTAMP.code(), errors.FAIL_SEND_REQHEADTIMESTAMP.msg() + String(ex))
    }
  }

  Client.prototype.cancelHeadTimeStamp = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_CANCEL_HEADTIMESTAMP) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support head time stamp requests.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_HEAD_TIMESTAMP, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_CANCELHEADTIMESTAMP.code(), errors.FAIL_SEND_CANCELHEADTIMESTAMP.msg() + String(ex))
    }
  }

  // ─── Histogram Data ────────────────────────────────────────────────

  Client.prototype.reqHistogramData = function (
    this: EClient, tickerId: number, contract: Contract,
    useRTH: boolean, timePeriod: string,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_HISTOGRAM) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support histogram requests..')
      return
    }

    try {
      const flds = [
        makeField(tickerId),
        makeField(contract.conId),
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
        makeField(contract.tradingClass),
        makeField(contract.includeExpired),
        makeField(useRTH),
        makeField(timePeriod),
      ]
      this.sendMsg(OUT.REQ_HISTOGRAM_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(tickerId, currentTimeMillis(), errors.FAIL_SEND_REQHISTOGRAMDATA.code(), errors.FAIL_SEND_REQHISTOGRAMDATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelHistogramData = function (this: EClient, tickerId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_HISTOGRAM) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support histogram requests..')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_HISTOGRAM_DATA, makeField(tickerId))
    } catch (ex: any) {
      this.wrapper.error(tickerId, currentTimeMillis(), errors.FAIL_SEND_CANCELHISTOGRAMDATA.code(), errors.FAIL_SEND_CANCELHISTOGRAMDATA.msg() + String(ex))
    }
  }

  // ─── Historical Ticks ──────────────────────────────────────────────

  Client.prototype.reqHistoricalTicks = function (
    this: EClient, reqId: number, contract: Contract,
    startDateTime: string, endDateTime: string, numberOfTicks: number,
    whatToShow: string, useRth: number, ignoreSize: boolean,
    miscOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_HISTORICAL_TICKS) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support historical ticks requests..')
      return
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(contract.conId),
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
        makeField(contract.tradingClass),
        makeField(contract.includeExpired),
        makeField(startDateTime),
        makeField(endDateTime),
        makeField(numberOfTicks),
        makeField(whatToShow),
        makeField(useRth),
        makeField(ignoreSize),
        makeField(tagValueListToStr(miscOptions)),
      ]

      this.sendMsg(OUT.REQ_HISTORICAL_TICKS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQHISTORICALTICKS.code(), errors.FAIL_SEND_REQHISTORICALTICKS.msg() + String(ex))
    }
  }

  // ─── Market Scanners ───────────────────────────────────────────────

  Client.prototype.reqScannerParameters = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_SCANNER_PARAMETERS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQSCANNERPARAMETERS.code(), errors.FAIL_SEND_REQSCANNERPARAMETERS.msg() + String(ex))
    }
  }

  Client.prototype.reqScannerSubscription = function (
    this: EClient, reqId: number, subscription: ScannerSubscription,
    scannerSubscriptionOptions: TagValueList,
    scannerSubscriptionFilterOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_SCANNER_GENERIC_OPTS && scannerSubscriptionFilterOptions != null) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support API scanner subscription generic filter options')
      return
    }

    try {
      const VERSION = 4
      const flds: string[] = []

      if (this.serverVersion() < SV.MIN_SERVER_VER_SCANNER_GENERIC_OPTS) {
        flds.push(makeField(VERSION))
      }

      flds.push(
        makeField(reqId),
        makeFieldHandleEmpty(subscription.numberOfRows),
        makeField(subscription.instrument),
        makeField(subscription.locationCode),
        makeField(subscription.scanCode),
        makeFieldHandleEmpty(subscription.abovePrice),
        makeFieldHandleEmpty(subscription.belowPrice),
        makeFieldHandleEmpty(subscription.aboveVolume),
        makeFieldHandleEmpty(subscription.marketCapAbove),
        makeFieldHandleEmpty(subscription.marketCapBelow),
        makeField(subscription.moodyRatingAbove),
        makeField(subscription.moodyRatingBelow),
        makeField(subscription.spRatingAbove),
        makeField(subscription.spRatingBelow),
        makeField(subscription.maturityDateAbove),
        makeField(subscription.maturityDateBelow),
        makeFieldHandleEmpty(subscription.couponRateAbove),
        makeFieldHandleEmpty(subscription.couponRateBelow),
        makeField(subscription.excludeConvertible),
        makeFieldHandleEmpty(subscription.averageOptionVolumeAbove),
        makeField(subscription.scannerSettingPairs),
        makeField(subscription.stockTypeFilter),
      )

      // scannerSubscriptionFilterOptions
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SCANNER_GENERIC_OPTS) {
        flds.push(makeField(tagValueListToStr(scannerSubscriptionFilterOptions)))
      }

      // scannerSubscriptionOptions
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        flds.push(makeField(tagValueListToStr(scannerSubscriptionOptions)))
      }

      this.sendMsg(OUT.REQ_SCANNER_SUBSCRIPTION, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQSCANNER.code(), errors.FAIL_SEND_REQSCANNER.msg() + String(ex))
    }
  }

  Client.prototype.cancelScannerSubscription = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_SCANNER_SUBSCRIPTION, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANSCANNER.code(), errors.FAIL_SEND_CANSCANNER.msg() + String(ex))
    }
  }

  // ─── Real Time Bars ────────────────────────────────────────────────

  Client.prototype.reqRealTimeBars = function (
    this: EClient, reqId: number, contract: Contract, barSize: number,
    whatToShow: string, useRTH: boolean, realTimeBarsOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_TRADING_CLASS) {
      if (contract.tradingClass) {
        this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
          errors.UPDATE_TWS.msg() + '  It does not support conId and tradingClass parameter in reqRealTimeBars.')
        return
      }
    }

    try {
      const VERSION = 3
      const flds: string[] = [makeField(VERSION), makeField(reqId)]

      // contract fields
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
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
      flds.push(makeField(barSize), makeField(whatToShow), makeField(useRTH))

      // realTimeBarsOptions
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        flds.push(makeField(tagValueListToStr(realTimeBarsOptions)))
      }

      this.sendMsg(OUT.REQ_REAL_TIME_BARS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQRTBARS.code(), errors.FAIL_SEND_REQRTBARS.msg() + String(ex))
    }
  }

  Client.prototype.cancelRealTimeBars = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return
    try {
      this.sendMsg(OUT.CANCEL_REAL_TIME_BARS, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANRTBARS.code(), errors.FAIL_SEND_CANRTBARS.msg() + String(ex))
    }
  }

  // ─── Fundamental Data ──────────────────────────────────────────────

  Client.prototype.reqFundamentalData = function (
    this: EClient, reqId: number, contract: Contract,
    reportType: string, fundamentalDataOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_FUNDAMENTAL_DATA) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support fundamental data request.')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_TRADING_CLASS) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support conId parameter in reqFundamentalData.')
      return
    }

    try {
      const VERSION = 2
      const flds: string[] = [makeField(VERSION), makeField(reqId)]

      // contract fields (no strike, no lastTradeDate, no right, no multiplier — fundamental data specific)
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
        flds.push(makeField(contract.conId))
      }
      flds.push(
        makeField(contract.symbol),
        makeField(contract.secType),
        makeField(contract.exchange),
        makeField(contract.primaryExchange),
        makeField(contract.currency),
        makeField(contract.localSymbol),
        makeField(reportType),
      )

      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        const tagValuesCount = fundamentalDataOptions?.length ?? 0
        flds.push(makeField(tagValuesCount), makeField(tagValueListToStr(fundamentalDataOptions)))
      }

      this.sendMsg(OUT.REQ_FUNDAMENTAL_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQFUNDDATA.code(), errors.FAIL_SEND_REQFUNDDATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelFundamentalData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_FUNDAMENTAL_DATA) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support fundamental data request.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_FUNDAMENTAL_DATA, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANFUNDDATA.code(), errors.FAIL_SEND_CANFUNDDATA.msg() + String(ex))
    }
  }

  // ─── News ──────────────────────────────────────────────────────────

  Client.prototype.reqNewsProviders = function (this: EClient): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_NEWS_PROVIDERS) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support news providers request.')
      return
    }

    try {
      this.sendMsg(OUT.REQ_NEWS_PROVIDERS, '')
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQNEWSPROVIDERS.code(), errors.FAIL_SEND_REQNEWSPROVIDERS.msg() + String(ex))
    }
  }

  Client.prototype.reqNewsArticle = function (
    this: EClient, reqId: number, providerCode: string,
    articleId: string, newsArticleOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_NEWS_ARTICLE) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support news article request.')
      return
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(providerCode),
        makeField(articleId),
      ]

      if (this.serverVersion() >= SV.MIN_SERVER_VER_NEWS_QUERY_ORIGINS) {
        flds.push(makeField(tagValueListToStr(newsArticleOptions)))
      }

      this.sendMsg(OUT.REQ_NEWS_ARTICLE, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQNEWSARTICLE.code(), errors.FAIL_SEND_REQNEWSARTICLE.msg() + String(ex))
    }
  }

  Client.prototype.reqHistoricalNews = function (
    this: EClient, reqId: number, conId: number, providerCodes: string,
    startDateTime: string, endDateTime: string, totalResults: number,
    historicalNewsOptions: TagValueList,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_HISTORICAL_NEWS) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support historical news request.')
      return
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(conId),
        makeField(providerCodes),
        makeField(startDateTime),
        makeField(endDateTime),
        makeField(totalResults),
      ]

      if (this.serverVersion() >= SV.MIN_SERVER_VER_NEWS_QUERY_ORIGINS) {
        flds.push(makeField(tagValueListToStr(historicalNewsOptions)))
      }

      this.sendMsg(OUT.REQ_HISTORICAL_NEWS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQHISTORICALNEWS.code(), errors.FAIL_SEND_REQHISTORICALNEWS.msg() + String(ex))
    }
  }

  // ─── Display Groups ────────────────────────────────────────────────

  Client.prototype.queryDisplayGroups = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support queryDisplayGroups request.')
      return
    }

    try {
      this.sendMsg(OUT.QUERY_DISPLAY_GROUPS, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_QUERYDISPLAYGROUPS.code(), errors.FAIL_SEND_QUERYDISPLAYGROUPS.msg() + String(ex))
    }
  }

  Client.prototype.subscribeToGroupEvents = function (this: EClient, reqId: number, groupId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support subscribeToGroupEvents request.')
      return
    }

    try {
      this.sendMsg(OUT.SUBSCRIBE_TO_GROUP_EVENTS, makeField(1) + makeField(reqId) + makeField(groupId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_SUBSCRIBETOGROUPEVENTS.code(), errors.FAIL_SEND_SUBSCRIBETOGROUPEVENTS.msg() + String(ex))
    }
  }

  Client.prototype.updateDisplayGroup = function (this: EClient, reqId: number, contractInfo: string): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support updateDisplayGroup request.')
      return
    }

    try {
      this.sendMsg(OUT.UPDATE_DISPLAY_GROUP, makeField(1) + makeField(reqId) + makeField(contractInfo))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_UPDATEDISPLAYGROUP.code(), errors.FAIL_SEND_UPDATEDISPLAYGROUP.msg() + String(ex))
    }
  }

  Client.prototype.unsubscribeFromGroupEvents = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support unsubscribeFromGroupEvents request.')
      return
    }

    try {
      this.sendMsg(OUT.UNSUBSCRIBE_FROM_GROUP_EVENTS, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.code(), errors.FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.msg() + String(ex))
    }
  }

  // ─── Verification ──────────────────────────────────────────────────

  Client.prototype.verifyRequest = function (this: EClient, apiName: string, apiVersion: string): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support verification request.')
      return
    }

    if (!this.extraAuth) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYMESSAGE.code(),
        errors.FAIL_SEND_VERIFYMESSAGE.msg() + '  Intent to authenticate needs to be expressed during initial connect request.')
      return
    }

    try {
      this.sendMsg(OUT.VERIFY_REQUEST, makeField(1) + makeField(apiName) + makeField(apiVersion))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYREQUEST.code(), errors.FAIL_SEND_VERIFYREQUEST.msg() + String(ex))
    }
  }

  Client.prototype.verifyMessage = function (this: EClient, apiData: string): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support verification request.')
      return
    }

    try {
      this.sendMsg(OUT.VERIFY_MESSAGE, makeField(1) + makeField(apiData))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYMESSAGE.code(), errors.FAIL_SEND_VERIFYMESSAGE.msg() + String(ex))
    }
  }

  Client.prototype.verifyAndAuthRequest = function (
    this: EClient, apiName: string, apiVersion: string, opaqueIsvKey: string,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support verification request.')
      return
    }

    if (!this.extraAuth) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYANDAUTHREQUEST.code(),
        errors.FAIL_SEND_VERIFYANDAUTHREQUEST.msg() + '  Intent to authenticate needs to be expressed during initial connect request.')
      return
    }

    try {
      this.sendMsg(OUT.VERIFY_AND_AUTH_REQUEST, makeField(1) + makeField(apiName) + makeField(apiVersion) + makeField(opaqueIsvKey))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYANDAUTHREQUEST.code(), errors.FAIL_SEND_VERIFYANDAUTHREQUEST.msg() + String(ex))
    }
  }

  Client.prototype.verifyAndAuthMessage = function (this: EClient, apiData: string, xyzResponse: string): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_LINKING) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support verification request.')
      return
    }

    try {
      this.sendMsg(OUT.VERIFY_AND_AUTH_MESSAGE, makeField(1) + makeField(apiData) + makeField(xyzResponse))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_VERIFYANDAUTHMESSAGE.code(), errors.FAIL_SEND_VERIFYANDAUTHMESSAGE.msg() + String(ex))
    }
  }

  // ─── Security Definition Option Params ─────────────────────────────

  Client.prototype.reqSecDefOptParams = function (
    this: EClient, reqId: number, underlyingSymbol: string,
    futFopExchange: string, underlyingSecType: string, underlyingConId: number,
  ): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_SEC_DEF_OPT_PARAMS_REQ) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support security definition option request.')
      return
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(underlyingSymbol),
        makeField(futFopExchange),
        makeField(underlyingSecType),
        makeField(underlyingConId),
      ]
      this.sendMsg(OUT.REQ_SEC_DEF_OPT_PARAMS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQSECDEFOPTPARAMS.code(), errors.FAIL_SEND_REQSECDEFOPTPARAMS.msg() + String(ex))
    }
  }

  // ─── Soft Dollar Tiers ─────────────────────────────────────────────

  Client.prototype.reqSoftDollarTiers = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_SOFT_DOLLAR_TIERS, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQSOFTDOLLARTIERS.code(), errors.FAIL_SEND_REQSOFTDOLLARTIERS.msg() + String(ex))
    }
  }

  // ─── Family Codes ──────────────────────────────────────────────────

  Client.prototype.reqFamilyCodes = function (this: EClient): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_FAMILY_CODES) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support family codes request.')
      return
    }

    try {
      this.sendMsg(OUT.REQ_FAMILY_CODES, '')
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQFAMILYCODES.code(), errors.FAIL_SEND_REQFAMILYCODES.msg() + String(ex))
    }
  }

  // ─── Matching Symbols ──────────────────────────────────────────────

  Client.prototype.reqMatchingSymbols = function (this: EClient, reqId: number, pattern: string): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_REQ_MATCHING_SYMBOLS) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support matching symbols request.')
      return
    }

    try {
      this.sendMsg(OUT.REQ_MATCHING_SYMBOLS, makeField(reqId) + makeField(pattern))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQMATCHINGSYMBOLS.code(), errors.FAIL_SEND_REQMATCHINGSYMBOLS.msg() + String(ex))
    }
  }

  // ─── WSH Meta Data / Event Data ────────────────────────────────────

  Client.prototype.reqWshMetaData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSHE_CALENDAR) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support WSHE Calendar API.')
      return
    }

    try {
      this.sendMsg(OUT.REQ_WSH_META_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQ_WSH_META_DATA.code(), errors.FAIL_SEND_REQ_WSH_META_DATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelWshMetaData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSHE_CALENDAR) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support WSHE Calendar API.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_WSH_META_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CAN_WSH_META_DATA.code(), errors.FAIL_SEND_CAN_WSH_META_DATA.msg() + String(ex))
    }
  }

  Client.prototype.reqWshEventData = function (this: EClient, reqId: number, wshEventData: WshEventData): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSHE_CALENDAR) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support WSHE Calendar API.')
      return
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS) {
      if (wshEventData.filter !== '' || wshEventData.fillWatchlist || wshEventData.fillPortfolio || wshEventData.fillCompetitors) {
        this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
          errors.UPDATE_TWS.msg() + ' It does not support WSH event data filters.')
        return
      }
    }

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS_DATE) {
      if (wshEventData.startDate !== '' || wshEventData.endDate !== '' || wshEventData.totalLimit !== UNSET_INTEGER) {
        this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
          errors.UPDATE_TWS.msg() + ' It does not support WSH event data date filters.')
        return
      }
    }

    try {
      const flds = [
        makeField(reqId),
        makeField(wshEventData.conId),
      ]

      if (this.serverVersion() >= SV.MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS) {
        flds.push(
          makeField(wshEventData.filter),
          makeField(wshEventData.fillWatchlist),
          makeField(wshEventData.fillPortfolio),
          makeField(wshEventData.fillCompetitors),
        )
      }

      if (this.serverVersion() >= SV.MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS_DATE) {
        flds.push(
          makeField(wshEventData.startDate),
          makeField(wshEventData.endDate),
          makeField(wshEventData.totalLimit),
        )
      }

      this.sendMsg(OUT.REQ_WSH_EVENT_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQ_WSH_EVENT_DATA.code(), errors.FAIL_SEND_REQ_WSH_EVENT_DATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelWshEventData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_WSHE_CALENDAR) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support WSHE Calendar API.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_WSH_EVENT_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CAN_WSH_EVENT_DATA.code(), errors.FAIL_SEND_CAN_WSH_EVENT_DATA.msg() + String(ex))
    }
  }

  // ─── User Info ─────────────────────────────────────────────────────

  Client.prototype.reqUserInfo = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_USER_INFO) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + ' It does not support user info requests.')
      return
    }

    try {
      this.sendMsg(OUT.REQ_USER_INFO, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQ_USER_INFO.code(), errors.FAIL_SEND_REQ_USER_INFO.msg() + String(ex))
    }
  }

  // ─── Cancel Contract Data ──────────────────────────────────────────

  Client.prototype.cancelContractData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_CANCEL_CONTRACT_DATA) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support contract data cancels.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_CONTRACT_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCEL_CONTRACT_DATA.code(), errors.FAIL_SEND_CANCEL_CONTRACT_DATA.msg() + String(ex))
    }
  }

  // ─── Cancel Historical Ticks ───────────────────────────────────────

  Client.prototype.cancelHistoricalTicks = function (this: EClient, reqId: number): void {
    if (!this.requireConnected(reqId)) return

    if (this.serverVersion() < SV.MIN_SERVER_VER_CANCEL_CONTRACT_DATA) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.UPDATE_TWS.code(),
        errors.UPDATE_TWS.msg() + '  It does not support historical ticks cancels.')
      return
    }

    try {
      this.sendMsg(OUT.CANCEL_HISTORICAL_TICKS, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCEL_HISTORICAL_TICKS.code(), errors.FAIL_SEND_CANCEL_HISTORICAL_TICKS.msg() + String(ex))
    }
  }
}
