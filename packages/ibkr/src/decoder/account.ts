/**
 * Account / position decoder handlers — text + protobuf.
 *
 * Mirrors: ibapi/decoder.py (account-related process methods)
 */

import { Decoder } from './base.js'
import { IN } from '../message.js'
import { NO_VALID_ID, UNSET_DOUBLE, UNSET_DECIMAL } from '../const.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeDecimal,
  floatMaxString,
} from '../utils.js'
import {
  MIN_SERVER_VER_UNREALIZED_PNL,
  MIN_SERVER_VER_REALIZED_PNL,
} from '../server-versions.js'
import { Contract } from '../contract.js'
import Decimal from 'decimal.js'

// Protobuf message types
import { AccountValue as AccountValueProto } from '../protobuf/AccountValue.js'
import { PortfolioValue as PortfolioValueProto } from '../protobuf/PortfolioValue.js'
import { AccountUpdateTime as AccountUpdateTimeProto } from '../protobuf/AccountUpdateTime.js'
import { AccountDataEnd as AccountDataEndProto } from '../protobuf/AccountDataEnd.js'
import { ManagedAccounts as ManagedAccountsProto } from '../protobuf/ManagedAccounts.js'
import { Position as PositionProto } from '../protobuf/Position.js'
import { PositionEnd as PositionEndProto } from '../protobuf/PositionEnd.js'
import { AccountSummary as AccountSummaryProto } from '../protobuf/AccountSummary.js'
import { AccountSummaryEnd as AccountSummaryEndProto } from '../protobuf/AccountSummaryEnd.js'
import { PositionMulti as PositionMultiProto } from '../protobuf/PositionMulti.js'
import { PositionMultiEnd as PositionMultiEndProto } from '../protobuf/PositionMultiEnd.js'
import { AccountUpdateMulti as AccountUpdateMultiProto } from '../protobuf/AccountUpdateMulti.js'
import { AccountUpdateMultiEnd as AccountUpdateMultiEndProto } from '../protobuf/AccountUpdateMultiEnd.js'
import { PnL as PnLProto } from '../protobuf/PnL.js'
import { PnLSingle as PnLSingleProto } from '../protobuf/PnLSingle.js'
import type { Contract as ContractProto } from '../protobuf/Contract.js'

// ---------------------------------------------------------------------------
// Helper: convert a protobuf Contract message to our Contract class
// Mirrors: ibapi/decoder_utils.py decodeContract()
// ---------------------------------------------------------------------------
function decodeContractProto(cp: ContractProto): Contract {
  const c = new Contract()
  if (cp.conId !== undefined) c.conId = cp.conId
  if (cp.symbol !== undefined) c.symbol = cp.symbol
  if (cp.secType !== undefined) c.secType = cp.secType
  if (cp.lastTradeDateOrContractMonth !== undefined) c.lastTradeDateOrContractMonth = cp.lastTradeDateOrContractMonth
  if (cp.strike !== undefined) c.strike = cp.strike
  if (cp.right !== undefined) c.right = cp.right
  if (cp.multiplier !== undefined) c.multiplier = floatMaxString(cp.multiplier)
  if (cp.exchange !== undefined) c.exchange = cp.exchange
  if (cp.currency !== undefined) c.currency = cp.currency
  if (cp.localSymbol !== undefined) c.localSymbol = cp.localSymbol
  if (cp.tradingClass !== undefined) c.tradingClass = cp.tradingClass
  if (cp.comboLegsDescrip !== undefined) c.comboLegsDescrip = cp.comboLegsDescrip
  if (cp.lastTradeDate !== undefined) c.lastTradeDate = cp.lastTradeDate
  if (cp.primaryExch !== undefined) c.primaryExchange = cp.primaryExch
  if (cp.issuerId !== undefined) c.issuerId = cp.issuerId
  if (cp.description !== undefined) c.description = cp.description
  return c
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function applyAccountHandlers(decoder: Decoder): void {
  // ===========================================================================
  // IN.ACCT_VALUE (6)
  // ===========================================================================

  decoder.registerText(IN.ACCT_VALUE, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const key = decodeStr(fields)
    const val = decodeStr(fields)
    const currency = decodeStr(fields)
    const accountName = decodeStr(fields)
    d.wrapper.updateAccountValue(key, val, currency, accountName)
  })

  decoder.registerProto(IN.ACCT_VALUE, (d, buf) => {
    const proto = AccountValueProto.decode(buf)
    const key = proto.key ?? ''
    const value = proto.value ?? ''
    const currency = proto.currency ?? ''
    const accountName = proto.accountName ?? ''
    d.wrapper.updateAccountValue(key, value, currency, accountName)
  })

  // ===========================================================================
  // IN.PORTFOLIO_VALUE (7)
  // ===========================================================================

  decoder.registerText(IN.PORTFOLIO_VALUE, (d, fields) => {
    decodeInt(fields) // msgId
    const version = decodeInt(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields) // ver 6
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)

    if (version >= 7) {
      contract.multiplier = decodeStr(fields)
      contract.primaryExchange = decodeStr(fields)
    }

    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields) // ver 2
    if (version >= 8) {
      contract.tradingClass = decodeStr(fields)
    }

    const position = decodeDecimal(fields)
    const marketPrice = decodeDecimal(fields).toString()
    const marketValue = decodeDecimal(fields).toString()
    const averageCost = decodeDecimal(fields).toString() // ver 3
    const unrealizedPNL = decodeDecimal(fields).toString() // ver 3
    const realizedPNL = decodeDecimal(fields).toString() // ver 3
    const accountName = decodeStr(fields) // ver 4

    if (version === 6 && d.serverVersion === 39) {
      contract.primaryExchange = decodeStr(fields)
    }

    d.wrapper.updatePortfolio(
      contract, position, marketPrice, marketValue,
      averageCost, unrealizedPNL, realizedPNL, accountName,
    )
  })

  decoder.registerProto(IN.PORTFOLIO_VALUE, (d, buf) => {
    const proto = PortfolioValueProto.decode(buf)

    if (!proto.contract) return
    const contract = decodeContractProto(proto.contract)

    const position = proto.position !== undefined ? new Decimal(proto.position) : UNSET_DECIMAL
    const marketPrice = String(proto.marketPrice ?? 0)
    const marketValue = String(proto.marketValue ?? 0)
    const averageCost = String(proto.averageCost ?? 0)
    const unrealizedPNL = String(proto.unrealizedPNL ?? 0)
    const realizedPNL = String(proto.realizedPNL ?? 0)
    const accountName = proto.accountName ?? ''

    d.wrapper.updatePortfolio(
      contract, position, marketPrice, marketValue,
      averageCost, unrealizedPNL, realizedPNL, accountName,
    )
  })

  // ===========================================================================
  // IN.ACCT_UPDATE_TIME (8)
  // ===========================================================================

  decoder.registerText(IN.ACCT_UPDATE_TIME, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const timeStamp = decodeStr(fields)
    d.wrapper.updateAccountTime(timeStamp)
  })

  decoder.registerProto(IN.ACCT_UPDATE_TIME, (d, buf) => {
    const proto = AccountUpdateTimeProto.decode(buf)
    const timeStamp = proto.timeStamp ?? ''
    d.wrapper.updateAccountTime(timeStamp)
  })

  // ===========================================================================
  // IN.ACCT_DOWNLOAD_END (54)
  // ===========================================================================

  decoder.registerText(IN.ACCT_DOWNLOAD_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const accountName = decodeStr(fields)
    d.wrapper.accountDownloadEnd(accountName)
  })

  decoder.registerProto(IN.ACCT_DOWNLOAD_END, (d, buf) => {
    const proto = AccountDataEndProto.decode(buf)
    const accountName = proto.accountName ?? ''
    d.wrapper.accountDownloadEnd(accountName)
  })

  // ===========================================================================
  // IN.MANAGED_ACCTS (15)
  // ===========================================================================

  decoder.registerText(IN.MANAGED_ACCTS, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const accountsList = decodeStr(fields)
    d.wrapper.managedAccounts(accountsList)
  })

  decoder.registerProto(IN.MANAGED_ACCTS, (d, buf) => {
    const proto = ManagedAccountsProto.decode(buf)
    d.wrapper.managedAccounts(proto.accountsList ?? '')
  })

  // ===========================================================================
  // IN.POSITION_DATA (61)
  // ===========================================================================

  decoder.registerText(IN.POSITION_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    const version = decodeInt(fields)

    const account = decodeStr(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields)
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    contract.multiplier = decodeStr(fields)
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    if (version >= 2) {
      contract.tradingClass = decodeStr(fields)
    }

    const position = decodeDecimal(fields)

    let avgCost = 0.0
    if (version >= 3) {
      avgCost = decodeFloat(fields)
    }

    d.wrapper.position(account, contract, position, avgCost)
  })

  decoder.registerProto(IN.POSITION_DATA, (d, buf) => {
    const proto = PositionProto.decode(buf)

    if (!proto.contract) return
    const contract = decodeContractProto(proto.contract)

    const position = proto.position !== undefined ? new Decimal(proto.position) : UNSET_DECIMAL
    const avgCost = proto.avgCost ?? 0
    const account = proto.account ?? ''

    d.wrapper.position(account, contract, position, avgCost)
  })

  // ===========================================================================
  // IN.POSITION_END (62)
  // ===========================================================================

  decoder.registerText(IN.POSITION_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    d.wrapper.positionEnd()
  })

  decoder.registerProto(IN.POSITION_END, (_d, buf) => {
    PositionEndProto.decode(buf)
    _d.wrapper.positionEnd()
  })

  // ===========================================================================
  // IN.ACCOUNT_SUMMARY (63)
  // ===========================================================================

  decoder.registerText(IN.ACCOUNT_SUMMARY, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)
    const tag = decodeStr(fields)
    const value = decodeStr(fields)
    const currency = decodeStr(fields)
    d.wrapper.accountSummary(reqId, account, tag, value, currency)
  })

  decoder.registerProto(IN.ACCOUNT_SUMMARY, (d, buf) => {
    const proto = AccountSummaryProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const account = proto.account ?? ''
    const tag = proto.tag ?? ''
    const value = proto.value ?? ''
    const currency = proto.currency ?? ''
    d.wrapper.accountSummary(reqId, account, tag, value, currency)
  })

  // ===========================================================================
  // IN.ACCOUNT_SUMMARY_END (64)
  // ===========================================================================

  decoder.registerText(IN.ACCOUNT_SUMMARY_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    d.wrapper.accountSummaryEnd(reqId)
  })

  decoder.registerProto(IN.ACCOUNT_SUMMARY_END, (d, buf) => {
    const proto = AccountSummaryEndProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    d.wrapper.accountSummaryEnd(reqId)
  })

  // ===========================================================================
  // IN.POSITION_MULTI (71)
  // ===========================================================================

  decoder.registerText(IN.POSITION_MULTI, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields)
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    contract.multiplier = decodeStr(fields)
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    contract.tradingClass = decodeStr(fields)
    const position = decodeDecimal(fields)
    const avgCost = decodeFloat(fields)
    const modelCode = decodeStr(fields)

    d.wrapper.positionMulti(reqId, account, modelCode, contract, position, avgCost)
  })

  decoder.registerProto(IN.POSITION_MULTI, (d, buf) => {
    const proto = PositionMultiProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const account = proto.account ?? ''
    const modelCode = proto.modelCode ?? ''

    if (!proto.contract) return
    const contract = decodeContractProto(proto.contract)

    const position = proto.position !== undefined ? new Decimal(proto.position) : UNSET_DECIMAL
    const avgCost = proto.avgCost ?? 0

    d.wrapper.positionMulti(reqId, account, modelCode, contract, position, avgCost)
  })

  // ===========================================================================
  // IN.POSITION_MULTI_END (72)
  // ===========================================================================

  decoder.registerText(IN.POSITION_MULTI_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    d.wrapper.positionMultiEnd(reqId)
  })

  decoder.registerProto(IN.POSITION_MULTI_END, (d, buf) => {
    const proto = PositionMultiEndProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    d.wrapper.positionMultiEnd(reqId)
  })

  // ===========================================================================
  // IN.ACCOUNT_UPDATE_MULTI (73)
  // ===========================================================================

  decoder.registerText(IN.ACCOUNT_UPDATE_MULTI, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)
    const modelCode = decodeStr(fields)
    const key = decodeStr(fields)
    const value = decodeStr(fields)
    const currency = decodeStr(fields)
    d.wrapper.accountUpdateMulti(reqId, account, modelCode, key, value, currency)
  })

  decoder.registerProto(IN.ACCOUNT_UPDATE_MULTI, (d, buf) => {
    const proto = AccountUpdateMultiProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const account = proto.account ?? ''
    const modelCode = proto.modelCode ?? ''
    const key = proto.key ?? ''
    const value = proto.value ?? ''
    const currency = proto.currency ?? ''
    d.wrapper.accountUpdateMulti(reqId, account, modelCode, key, value, currency)
  })

  // ===========================================================================
  // IN.ACCOUNT_UPDATE_MULTI_END (74)
  // ===========================================================================

  decoder.registerText(IN.ACCOUNT_UPDATE_MULTI_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    d.wrapper.accountUpdateMultiEnd(reqId)
  })

  decoder.registerProto(IN.ACCOUNT_UPDATE_MULTI_END, (d, buf) => {
    const proto = AccountUpdateMultiEndProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    d.wrapper.accountUpdateMultiEnd(reqId)
  })

  // ===========================================================================
  // IN.PNL (94)
  // ===========================================================================

  decoder.registerText(IN.PNL, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dailyPnL = decodeFloat(fields)
    let unrealizedPnL: number | null = null
    let realizedPnL: number | null = null

    if (d.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL) {
      unrealizedPnL = decodeFloat(fields)
    }

    if (d.serverVersion >= MIN_SERVER_VER_REALIZED_PNL) {
      realizedPnL = decodeFloat(fields)
    }

    d.wrapper.pnl(reqId, dailyPnL, unrealizedPnL, realizedPnL)
  })

  decoder.registerProto(IN.PNL, (d, buf) => {
    const proto = PnLProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const dailyPnL = proto.dailyPnL ?? UNSET_DOUBLE
    const unrealizedPnL = proto.unrealizedPnL ?? UNSET_DOUBLE
    const realizedPnL = proto.realizedPnL ?? UNSET_DOUBLE
    d.wrapper.pnl(reqId, dailyPnL, unrealizedPnL, realizedPnL)
  })

  // ===========================================================================
  // IN.PNL_SINGLE (95)
  // ===========================================================================

  decoder.registerText(IN.PNL_SINGLE, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const pos = decodeDecimal(fields)
    const dailyPnL = decodeFloat(fields)
    let unrealizedPnL: number | null = null
    let realizedPnL: number | null = null

    if (d.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL) {
      unrealizedPnL = decodeFloat(fields)
    }

    if (d.serverVersion >= MIN_SERVER_VER_REALIZED_PNL) {
      realizedPnL = decodeFloat(fields)
    }

    const value = decodeFloat(fields)

    d.wrapper.pnlSingle(reqId, pos, dailyPnL, unrealizedPnL, realizedPnL, value)
  })

  decoder.registerProto(IN.PNL_SINGLE, (d, buf) => {
    const proto = PnLSingleProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const pos = proto.position !== undefined ? new Decimal(proto.position) : UNSET_DECIMAL
    const dailyPnL = proto.dailyPnL ?? UNSET_DOUBLE
    const unrealizedPnL = proto.unrealizedPnL ?? UNSET_DOUBLE
    const realizedPnL = proto.realizedPnL ?? UNSET_DOUBLE
    const value = proto.value ?? UNSET_DOUBLE
    d.wrapper.pnlSingle(reqId, pos, dailyPnL, unrealizedPnL, realizedPnL, value)
  })
}
