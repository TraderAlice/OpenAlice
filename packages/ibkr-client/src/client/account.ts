/**
 * EClient account, positions, executions, contract details methods.
 * Mirrors: ibapi/client.py lines 3210-4840
 */

import { EClient } from './base.js'
import { makeField, makeFieldHandleEmpty } from '../comm.js'
import { OUT } from '@traderalice/ibkr-types'
import * as SV from '@traderalice/ibkr-types'
import { NO_VALID_ID, UNSET_INTEGER } from '@traderalice/ibkr-types'
import * as errors from '@traderalice/ibkr-types'
import { currentTimeMillis } from '../utils.js'
import type { Contract } from '@traderalice/ibkr-types'
import type { ExecutionFilter } from '@traderalice/ibkr-types'

declare module './base.js' {
  interface EClient {
    reqAccountUpdates(subscribe: boolean, acctCode: string): void
    reqAccountSummary(reqId: number, groupName: string, tags: string): void
    cancelAccountSummary(reqId: number): void
    reqPositions(): void
    cancelPositions(): void
    reqPositionsMulti(reqId: number, account: string, modelCode: string): void
    cancelPositionsMulti(reqId: number): void
    reqAccountUpdatesMulti(reqId: number, account: string, modelCode: string, ledgerAndNLV: boolean): void
    cancelAccountUpdatesMulti(reqId: number): void
    reqPnL(reqId: number, account: string, modelCode: string): void
    cancelPnL(reqId: number): void
    reqPnLSingle(reqId: number, account: string, modelCode: string, conid: number): void
    cancelPnLSingle(reqId: number): void
    reqExecutions(reqId: number, execFilter: ExecutionFilter): void
    reqContractDetails(reqId: number, contract: Contract): void
    cancelContractData(reqId: number): void
    reqMktDepthExchanges(): void
    reqMktDepth(reqId: number, contract: Contract, numRows: number, isSmartDepth: boolean, mktDepthOptions: unknown): void
    cancelMktDepth(reqId: number, isSmartDepth: boolean): void
    reqNewsBulletins(allMsgs: boolean): void
    cancelNewsBulletins(): void
    reqManagedAccts(): void
    requestFA(faData: number): void
    replaceFA(reqId: number, faData: number, cxml: string): void
  }
}

export function applyAccount(Client: typeof EClient): void {

  Client.prototype.reqAccountUpdates = function (this: EClient, subscribe: boolean, acctCode: string): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_ACCT_DATA, makeField(2) + makeField(subscribe) + makeField(acctCode))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_ACCT.code(), errors.FAIL_SEND_ACCT.msg() + String(ex))
    }
  }

  Client.prototype.reqAccountSummary = function (this: EClient, reqId: number, groupName: string, tags: string): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_ACCOUNT_SUMMARY, makeField(1) + makeField(reqId) + makeField(groupName) + makeField(tags))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQACCOUNTDATA.code(), errors.FAIL_SEND_REQACCOUNTDATA.msg() + String(ex))
    }
  }

  Client.prototype.cancelAccountSummary = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_ACCOUNT_SUMMARY, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANACCOUNTDATA.code(), errors.FAIL_SEND_CANACCOUNTDATA.msg() + String(ex))
    }
  }

  Client.prototype.reqPositions = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_POSITIONS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQPOSITIONS.code(), errors.FAIL_SEND_REQPOSITIONS.msg() + String(ex))
    }
  }

  Client.prototype.cancelPositions = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_POSITIONS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_CANPOSITIONS.code(), errors.FAIL_SEND_CANPOSITIONS.msg() + String(ex))
    }
  }

  Client.prototype.reqPositionsMulti = function (this: EClient, reqId: number, account: string, modelCode: string): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_POSITIONS_MULTI, makeField(1) + makeField(reqId) + makeField(account) + makeField(modelCode))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQPOSITIONSMULTI.code(), errors.FAIL_SEND_REQPOSITIONSMULTI.msg() + String(ex))
    }
  }

  Client.prototype.cancelPositionsMulti = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_POSITIONS_MULTI, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANPOSITIONSMULTI.code(), errors.FAIL_SEND_CANPOSITIONSMULTI.msg() + String(ex))
    }
  }

  Client.prototype.reqAccountUpdatesMulti = function (this: EClient, reqId: number, account: string, modelCode: string, ledgerAndNLV: boolean): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_ACCOUNT_UPDATES_MULTI, makeField(1) + makeField(reqId) + makeField(account) + makeField(modelCode) + makeField(ledgerAndNLV))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQACCOUNTUPDATESMULTI.code(), errors.FAIL_SEND_REQACCOUNTUPDATESMULTI.msg() + String(ex))
    }
  }

  Client.prototype.cancelAccountUpdatesMulti = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_ACCOUNT_UPDATES_MULTI, makeField(1) + makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANACCOUNTUPDATESMULTI.code(), errors.FAIL_SEND_CANACCOUNTUPDATESMULTI.msg() + String(ex))
    }
  }

  Client.prototype.reqPnL = function (this: EClient, reqId: number, account: string, modelCode: string): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_PNL, makeField(reqId) + makeField(account) + makeField(modelCode))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQPNL.code(), errors.FAIL_SEND_REQPNL.msg() + String(ex))
    }
  }

  Client.prototype.cancelPnL = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_PNL, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCELPNL.code(), errors.FAIL_SEND_CANCELPNL.msg() + String(ex))
    }
  }

  Client.prototype.reqPnLSingle = function (this: EClient, reqId: number, account: string, modelCode: string, conid: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_PNL_SINGLE, makeField(reqId) + makeField(account) + makeField(modelCode) + makeField(conid))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQPNLSINGLE.code(), errors.FAIL_SEND_REQPNLSINGLE.msg() + String(ex))
    }
  }

  Client.prototype.cancelPnLSingle = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_PNL_SINGLE, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCELPNLSINGLE.code(), errors.FAIL_SEND_CANCELPNLSINGLE.msg() + String(ex))
    }
  }

  Client.prototype.reqExecutions = function (this: EClient, reqId: number, execFilter: ExecutionFilter): void {
    if (!this.requireConnected()) return
    try {
      const flds = [makeField(3)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_EXECUTION_DATA_CHAIN) flds.push(makeField(reqId))
      flds.push(
        makeField(execFilter.clientId), makeField(execFilter.acctCode), makeField(execFilter.time),
        makeField(execFilter.symbol), makeField(execFilter.secType), makeField(execFilter.exchange),
        makeField(execFilter.side),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_PARAMETRIZED_DAYS_OF_EXECUTIONS) {
        flds.push(makeField(execFilter.lastNDays))
        if (execFilter.specificDates != null) {
          flds.push(makeField(execFilter.specificDates.length))
          for (const d of execFilter.specificDates) flds.push(makeField(d))
        } else {
          flds.push(makeField(0))
        }
      }
      this.sendMsg(OUT.REQ_EXECUTIONS, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_EXEC.code(), errors.FAIL_SEND_EXEC.msg() + String(ex))
    }
  }

  Client.prototype.reqContractDetails = function (this: EClient, reqId: number, contract: Contract): void {
    if (!this.requireConnected()) return
    try {
      const flds = [makeField(8)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_CONTRACT_DATA_CHAIN) flds.push(makeField(reqId))
      flds.push(
        makeField(contract.conId), makeField(contract.symbol), makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth), makeFieldHandleEmpty(contract.strike),
        makeField(contract.right), makeField(contract.multiplier),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_PRIMARYEXCH) {
        flds.push(makeField(contract.exchange), makeField(contract.primaryExchange))
      } else if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) {
        if (contract.primaryExchange && (contract.exchange === 'BEST' || contract.exchange === 'SMART')) {
          flds.push(makeField(contract.exchange + ':' + contract.primaryExchange))
        } else {
          flds.push(makeField(contract.exchange))
        }
      }
      flds.push(makeField(contract.currency), makeField(contract.localSymbol))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.tradingClass))
      flds.push(makeField(contract.includeExpired))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SEC_ID_TYPE) flds.push(makeField(contract.secIdType), makeField(contract.secId))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_BOND_ISSUERID) flds.push(makeField(contract.issuerId))
      this.sendMsg(OUT.REQ_CONTRACT_DATA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQCONTRACT.code(), errors.FAIL_SEND_REQCONTRACT.msg() + String(ex))
    }
  }

  Client.prototype.cancelContractData = function (this: EClient, reqId: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_CONTRACT_DATA, makeField(reqId))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANCEL_CONTRACT_DATA.code(), errors.FAIL_SEND_CANCEL_CONTRACT_DATA.msg() + String(ex))
    }
  }

  Client.prototype.reqMktDepthExchanges = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_MKT_DEPTH_EXCHANGES, '')
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMKTDEPTHEXCHANGES.code(), errors.FAIL_SEND_REQMKTDEPTHEXCHANGES.msg() + String(ex))
    }
  }

  Client.prototype.reqMktDepth = function (
    this: EClient, reqId: number, contract: Contract, numRows: number,
    isSmartDepth: boolean, _mktDepthOptions: unknown,
  ): void {
    if (!this.requireConnected(reqId)) return
    try {
      const flds = [makeField(5), makeField(reqId)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.conId))
      flds.push(
        makeField(contract.symbol), makeField(contract.secType),
        makeField(contract.lastTradeDateOrContractMonth), makeFieldHandleEmpty(contract.strike),
        makeField(contract.right), makeField(contract.multiplier), makeField(contract.exchange),
      )
      if (this.serverVersion() >= SV.MIN_SERVER_VER_MKT_DEPTH_PRIM_EXCHANGE) flds.push(makeField(contract.primaryExchange))
      flds.push(makeField(contract.currency), makeField(contract.localSymbol))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) flds.push(makeField(contract.tradingClass))
      flds.push(makeField(numRows))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SMART_DEPTH) flds.push(makeField(isSmartDepth))
      if (this.serverVersion() >= SV.MIN_SERVER_VER_LINKING) flds.push(makeField(''))
      this.sendMsg(OUT.REQ_MKT_DEPTH, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_REQMKTDEPTH.code(), errors.FAIL_SEND_REQMKTDEPTH.msg() + String(ex))
    }
  }

  Client.prototype.cancelMktDepth = function (this: EClient, reqId: number, isSmartDepth: boolean): void {
    if (!this.requireConnected(reqId)) return
    try {
      const flds = [makeField(1), makeField(reqId)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_SMART_DEPTH) flds.push(makeField(isSmartDepth))
      this.sendMsg(OUT.CANCEL_MKT_DEPTH, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.FAIL_SEND_CANMKTDEPTH.code(), errors.FAIL_SEND_CANMKTDEPTH.msg() + String(ex))
    }
  }

  Client.prototype.reqNewsBulletins = function (this: EClient, allMsgs: boolean): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_NEWS_BULLETINS, makeField(1) + makeField(allMsgs))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMKT.code(), errors.FAIL_SEND_REQMKT.msg() + String(ex))
    }
  }

  Client.prototype.cancelNewsBulletins = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.CANCEL_NEWS_BULLETINS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMKT.code(), errors.FAIL_SEND_REQMKT.msg() + String(ex))
    }
  }

  Client.prototype.reqManagedAccts = function (this: EClient): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_MANAGED_ACCTS, makeField(1))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_REQMKT.code(), errors.FAIL_SEND_REQMKT.msg() + String(ex))
    }
  }

  Client.prototype.requestFA = function (this: EClient, faData: number): void {
    if (!this.requireConnected()) return
    try {
      this.sendMsg(OUT.REQ_FA, makeField(1) + makeField(faData))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_FA_REQUEST.code(), errors.FAIL_SEND_FA_REQUEST.msg() + String(ex))
    }
  }

  Client.prototype.replaceFA = function (this: EClient, reqId: number, faData: number, cxml: string): void {
    if (!this.requireConnected()) return
    try {
      const flds = [makeField(1), makeField(faData), makeField(cxml)]
      if (this.serverVersion() >= SV.MIN_SERVER_VER_REPLACE_FA_END) flds.push(makeField(reqId))
      this.sendMsg(OUT.REPLACE_FA, flds.join(''))
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_FA_REPLACE.code(), errors.FAIL_SEND_FA_REPLACE.msg() + String(ex))
    }
  }
}
