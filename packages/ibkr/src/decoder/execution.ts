/**
 * Execution-related decoder handlers (text + protobuf).
 *
 * Message types:
 *   IN.EXECUTION_DATA           (11)
 *   IN.EXECUTION_DATA_END       (55)
 *   IN.COMMISSION_AND_FEES_REPORT (59)
 */

import Decimal from 'decimal.js'
import type { Decoder } from './base.js'
import { IN } from '../message.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
  decodeDecimal,
} from '../utils.js'
import {
  MIN_SERVER_VER_LAST_LIQUIDITY,
  MIN_SERVER_VER_MODELS_SUPPORT,
  MIN_SERVER_VER_PENDING_PRICE_REVISION,
  MIN_SERVER_VER_SUBMITTER,
} from '../server-versions.js'
import { NO_VALID_ID } from '../const.js'
import { Contract, ComboLeg, DeltaNeutralContract, coerceSecType } from '../contract.js'
import { Execution, OptionExerciseType } from '../execution.js'
import { CommissionAndFeesReport } from '../commission-and-fees-report.js'

// Protobuf message types
import { ExecutionDetails as ExecutionDetailsProto } from '../protobuf/ExecutionDetails.js'
import { ExecutionDetailsEnd as ExecutionDetailsEndProto } from '../protobuf/ExecutionDetailsEnd.js'
import { CommissionAndFeesReport as CommissionAndFeesReportProto } from '../protobuf/CommissionAndFeesReport.js'
import type { Contract as ContractProtoType } from '../protobuf/Contract.js'
import type { Execution as ExecutionProtoType } from '../protobuf/Execution.js'

// ---------------------------------------------------------------------------
// Protobuf → domain helpers
// ---------------------------------------------------------------------------

function decodeContractFromProto(cp: ContractProtoType): Contract {
  const contract = new Contract()
  if (cp.conId !== undefined) contract.conId = cp.conId
  if (cp.symbol !== undefined) contract.symbol = cp.symbol
  if (cp.secType !== undefined) 
  if (cp.lastTradeDateOrContractMonth !== undefined) contract.lastTradeDateOrContractMonth = cp.lastTradeDateOrContractMonth
  if (cp.strike !== undefined) contract.strike = cp.strike
  if (cp.right !== undefined) contract.right = cp.right
  if (cp.multiplier !== undefined) contract.multiplier = String(cp.multiplier)
  if (cp.exchange !== undefined) contract.exchange = cp.exchange
  if (cp.currency !== undefined) contract.currency = cp.currency
  if (cp.localSymbol !== undefined) contract.localSymbol = cp.localSymbol
  if (cp.tradingClass !== undefined) contract.tradingClass = cp.tradingClass
  if (cp.comboLegsDescrip !== undefined) contract.comboLegsDescrip = cp.comboLegsDescrip

  if (cp.comboLegs && cp.comboLegs.length > 0) {
    contract.comboLegs = cp.comboLegs.map((clp) => {
      const leg = new ComboLeg()
      if (clp.conId !== undefined) leg.conId = clp.conId
      if (clp.ratio !== undefined) leg.ratio = clp.ratio
      if (clp.action !== undefined) leg.action = clp.action
      if (clp.exchange !== undefined) leg.exchange = clp.exchange
      if (clp.openClose !== undefined) leg.openClose = clp.openClose
      if (clp.shortSalesSlot !== undefined) leg.shortSaleSlot = clp.shortSalesSlot
      if (clp.designatedLocation !== undefined) leg.designatedLocation = clp.designatedLocation
      if (clp.exemptCode !== undefined) leg.exemptCode = clp.exemptCode
      return leg
    })
  }

  if (cp.deltaNeutralContract !== undefined) {
    const dnc = new DeltaNeutralContract()
    if (cp.deltaNeutralContract.conId !== undefined) dnc.conId = cp.deltaNeutralContract.conId
    if (cp.deltaNeutralContract.delta !== undefined) dnc.delta = cp.deltaNeutralContract.delta
    if (cp.deltaNeutralContract.price !== undefined) dnc.price = cp.deltaNeutralContract.price
    contract.deltaNeutralContract = dnc
  }

  if (cp.lastTradeDate !== undefined) contract.lastTradeDate = cp.lastTradeDate
  if (cp.primaryExch !== undefined) contract.primaryExchange = cp.primaryExch
  if (cp.issuerId !== undefined) contract.issuerId = cp.issuerId
  if (cp.description !== undefined) contract.description = cp.description

  return contract
}

function decodeExecutionFromProto(ep: ExecutionProtoType): Execution {
  const execution = new Execution()
  if (ep.orderId !== undefined) execution.orderId = ep.orderId
  if (ep.clientId !== undefined) execution.clientId = ep.clientId
  if (ep.execId !== undefined) execution.execId = ep.execId
  if (ep.time !== undefined) execution.time = ep.time
  if (ep.acctNumber !== undefined) execution.acctNumber = ep.acctNumber
  if (ep.exchange !== undefined) execution.exchange = ep.exchange
  if (ep.side !== undefined) execution.side = ep.side
  if (ep.shares !== undefined) execution.shares = new Decimal(ep.shares)
  if (ep.price !== undefined) execution.price = ep.price
  if (ep.permId !== undefined) execution.permId = ep.permId
  if (ep.isLiquidation !== undefined) execution.liquidation = ep.isLiquidation ? 1 : 0
  if (ep.cumQty !== undefined) execution.cumQty = new Decimal(ep.cumQty)
  if (ep.avgPrice !== undefined) execution.avgPrice = ep.avgPrice
  if (ep.orderRef !== undefined) execution.orderRef = ep.orderRef
  if (ep.evRule !== undefined) execution.evRule = ep.evRule
  if (ep.evMultiplier !== undefined) execution.evMultiplier = ep.evMultiplier
  if (ep.modelCode !== undefined) execution.modelCode = ep.modelCode
  if (ep.lastLiquidity !== undefined) execution.lastLiquidity = ep.lastLiquidity
  if (ep.isPriceRevisionPending !== undefined) execution.pendingPriceRevision = ep.isPriceRevisionPending
  if (ep.submitter !== undefined) execution.submitter = ep.submitter
  if (ep.optExerciseOrLapseType !== undefined) {
    const entry = Object.values(OptionExerciseType).find((e) => e.value === ep.optExerciseOrLapseType)
    if (entry) execution.optExerciseOrLapseType = entry
  }
  return execution
}

// ---------------------------------------------------------------------------
// Public: register all execution handlers
// ---------------------------------------------------------------------------

export function applyExecutionHandlers(decoder: Decoder): void {
  // ── Text handlers ──────────────────────────────────────────────────────

  // IN.EXECUTION_DATA (11)
  decoder.registerText(IN.EXECUTION_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    let version = d.serverVersion

    if (d.serverVersion < MIN_SERVER_VER_LAST_LIQUIDITY) {
      version = decodeInt(fields)
    }

    let reqId = -1
    if (version >= 7) {
      reqId = decodeInt(fields)
    }

    const orderId = decodeInt(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields) // ver 5
    contract.symbol = decodeStr(fields)
    contract.secType = coerceSecType(decodeStr(fields))
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    if (version >= 9) {
      contract.multiplier = decodeStr(fields)
    }
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    if (version >= 10) {
      contract.tradingClass = decodeStr(fields)
    }

    const execution = new Execution()
    execution.orderId = orderId
    execution.execId = decodeStr(fields)
    execution.time = decodeStr(fields)
    execution.acctNumber = decodeStr(fields)
    execution.exchange = decodeStr(fields)
    execution.side = decodeStr(fields)
    execution.shares = decodeDecimal(fields)
    execution.price = decodeFloat(fields)
    execution.permId = decodeInt(fields) // ver 2
    execution.clientId = decodeInt(fields) // ver 3
    execution.liquidation = decodeInt(fields) // ver 4

    if (version >= 6) {
      execution.cumQty = decodeDecimal(fields)
      execution.avgPrice = decodeFloat(fields)
    }

    if (version >= 8) {
      execution.orderRef = decodeStr(fields)
    }

    if (version >= 9) {
      execution.evRule = decodeStr(fields)
      execution.evMultiplier = decodeFloat(fields)
    }
    if (d.serverVersion >= MIN_SERVER_VER_MODELS_SUPPORT) {
      execution.modelCode = decodeStr(fields)
    }
    if (d.serverVersion >= MIN_SERVER_VER_LAST_LIQUIDITY) {
      execution.lastLiquidity = decodeInt(fields)
    }
    if (d.serverVersion >= MIN_SERVER_VER_PENDING_PRICE_REVISION) {
      execution.pendingPriceRevision = decodeBool(fields)
    }
    if (d.serverVersion >= MIN_SERVER_VER_SUBMITTER) {
      execution.submitter = decodeStr(fields)
    }

    d.wrapper.execDetails(reqId, contract, execution)
  })

  // IN.EXECUTION_DATA_END (55)
  decoder.registerText(IN.EXECUTION_DATA_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    d.wrapper.execDetailsEnd(reqId)
  })

  // IN.COMMISSION_AND_FEES_REPORT (59)
  decoder.registerText(IN.COMMISSION_AND_FEES_REPORT, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const report = new CommissionAndFeesReport()
    report.execId = decodeStr(fields)
    report.commissionAndFees = decodeFloat(fields)
    report.currency = decodeStr(fields)
    report.realizedPNL = decodeFloat(fields)
    report.yield_ = decodeFloat(fields)
    report.yieldRedemptionDate = decodeInt(fields)

    d.wrapper.commissionAndFeesReport(report)
  })

  // ── Protobuf handlers ─────────────────────────────────────────────────

  // IN.EXECUTION_DATA (11) — protobuf
  decoder.registerProto(IN.EXECUTION_DATA, (d, buf) => {
    const proto = ExecutionDetailsProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID

    if (!proto.contract) return
    const contract = decodeContractFromProto(proto.contract)

    if (!proto.execution) return
    const execution = decodeExecutionFromProto(proto.execution)

    d.wrapper.execDetails(reqId, contract, execution)
  })

  // IN.EXECUTION_DATA_END (55) — protobuf
  decoder.registerProto(IN.EXECUTION_DATA_END, (d, buf) => {
    const proto = ExecutionDetailsEndProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    d.wrapper.execDetailsEnd(reqId)
  })

  // IN.COMMISSION_AND_FEES_REPORT (59) — protobuf
  decoder.registerProto(IN.COMMISSION_AND_FEES_REPORT, (d, buf) => {
    const proto = CommissionAndFeesReportProto.decode(buf)

    const report = new CommissionAndFeesReport()
    report.execId = proto.execId ?? ''
    report.commissionAndFees = proto.commissionAndFees ?? 0.0
    report.currency = proto.currency ?? ''
    report.realizedPNL = proto.realizedPNL ?? 0.0
    report.yield_ = proto.bondYield ?? 0.0
    report.yieldRedemptionDate = proto.yieldRedemptionDate !== undefined
      ? parseInt(proto.yieldRedemptionDate, 10)
      : 0

    d.wrapper.commissionAndFeesReport(report)
  })
}
