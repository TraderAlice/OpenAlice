/**
 * Market data decoder handlers — text + protobuf.
 * Mirrors market-data related processXxxMsg / processXxxMsgProtoBuf from ibapi/decoder.py
 */

import type { Decoder } from './base.js'
import { IN } from '@traderalice/ibkr-types'
import { NO_VALID_ID, UNSET_INTEGER, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr-types'
import { decodeStr, decodeInt, decodeFloat, decodeBool, decodeDecimal } from '../utils.js'
import {
  MIN_SERVER_VER_PAST_LIMIT,
  MIN_SERVER_VER_PRE_OPEN_BID_ASK,
  MIN_SERVER_VER_SMART_DEPTH,
  MIN_SERVER_VER_PRICE_BASED_VOLATILITY,
} from '@traderalice/ibkr-types'
import { TickAttrib } from '@traderalice/ibkr-types'
import { TickTypeEnum } from '@traderalice/ibkr-types'
import Decimal from 'decimal.js'

// Proto imports
import { TickPrice as TickPriceProto } from '../protobuf/TickPrice.js'
import { TickSize as TickSizeProto } from '../protobuf/TickSize.js'
import { TickOptionComputation as TickOptionComputationProto } from '../protobuf/TickOptionComputation.js'
import { TickGeneric as TickGenericProto } from '../protobuf/TickGeneric.js'
import { TickString as TickStringProto } from '../protobuf/TickString.js'
import { TickSnapshotEnd as TickSnapshotEndProto } from '../protobuf/TickSnapshotEnd.js'
import { MarketDataType as MarketDataTypeProto } from '../protobuf/MarketDataType.js'
import { TickReqParams as TickReqParamsProto } from '../protobuf/TickReqParams.js'
import { MarketDepth as MarketDepthProto } from '../protobuf/MarketDepth.js'
import { MarketDepthL2 as MarketDepthL2Proto } from '../protobuf/MarketDepthL2.js'

export function applyMarketDataHandlers(decoder: Decoder): void {
  // ----------------------------------------------------------------
  // Text handlers
  // ----------------------------------------------------------------

  // IN.TICK_PRICE (1)
  decoder.registerText(IN.TICK_PRICE, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields) // ver 2 field
    const attrMask = decodeInt(fields) // ver 3 field

    const attrib = new TickAttrib()

    attrib.canAutoExecute = attrMask === 1

    if (d.serverVersion >= MIN_SERVER_VER_PAST_LIMIT) {
      attrib.canAutoExecute = (attrMask & 1) !== 0
      attrib.pastLimit = (attrMask & 2) !== 0
      if (d.serverVersion >= MIN_SERVER_VER_PRE_OPEN_BID_ASK) {
        attrib.preOpen = (attrMask & 4) !== 0
      }
    }

    d.wrapper.tickPrice(reqId, tickType, price, attrib)

    // process ver 2 fields
    let sizeTickType: number = TickTypeEnum.NOT_SET
    if (TickTypeEnum.BID === tickType) {
      sizeTickType = TickTypeEnum.BID_SIZE
    } else if (TickTypeEnum.ASK === tickType) {
      sizeTickType = TickTypeEnum.ASK_SIZE
    } else if (TickTypeEnum.LAST === tickType) {
      sizeTickType = TickTypeEnum.LAST_SIZE
    } else if (TickTypeEnum.DELAYED_BID === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_BID_SIZE
    } else if (TickTypeEnum.DELAYED_ASK === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_ASK_SIZE
    } else if (TickTypeEnum.DELAYED_LAST === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_LAST_SIZE
    }

    if (sizeTickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickSize(reqId, sizeTickType, size)
    }
  })

  // IN.TICK_SIZE (2)
  decoder.registerText(IN.TICK_SIZE, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const reqId = decodeInt(fields)
    const sizeTickType = decodeInt(fields)
    const size = decodeDecimal(fields)

    if (sizeTickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickSize(reqId, sizeTickType, size)
    }
  })

  // IN.TICK_OPTION_COMPUTATION (21)
  decoder.registerText(IN.TICK_OPTION_COMPUTATION, (d, fields) => {
    decodeInt(fields) // msgId
    let version = d.serverVersion
    let tickAttrib = 0
    let optPrice: number | null = null
    let pvDividend: number | null = null
    let gamma: number | null = null
    let vega: number | null = null
    let theta: number | null = null
    let undPrice: number | null = null

    if (d.serverVersion < MIN_SERVER_VER_PRICE_BASED_VOLATILITY) {
      version = decodeInt(fields)
    }

    const reqId = decodeInt(fields)
    const tickTypeInt = decodeInt(fields)

    if (d.serverVersion >= MIN_SERVER_VER_PRICE_BASED_VOLATILITY) {
      tickAttrib = decodeInt(fields)
    }

    let impliedVol: number | null = decodeFloat(fields)
    let delta: number | null = decodeFloat(fields)

    if (impliedVol! < 0) impliedVol = null // -1 = not computed
    if (delta === -2) delta = null // -2 = not computed

    if (
      version >= 6 ||
      tickTypeInt === TickTypeEnum.MODEL_OPTION ||
      tickTypeInt === TickTypeEnum.DELAYED_MODEL_OPTION
    ) {
      optPrice = decodeFloat(fields)
      pvDividend = decodeFloat(fields)

      if (optPrice === -1) optPrice = null
      if (pvDividend === -1) pvDividend = null
    }

    if (version >= 6) {
      gamma = decodeFloat(fields)
      vega = decodeFloat(fields)
      theta = decodeFloat(fields)
      undPrice = decodeFloat(fields)

      if (gamma === -2) gamma = null
      if (vega === -2) vega = null
      if (theta === -2) theta = null
      if (undPrice === -1) undPrice = null
    }

    d.wrapper.tickOptionComputation(
      reqId, tickTypeInt, tickAttrib,
      impliedVol, delta, optPrice, pvDividend,
      gamma, vega, theta, undPrice,
    )
  })

  // IN.TICK_GENERIC (45)
  decoder.registerText(IN.TICK_GENERIC, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const value = decodeFloat(fields)
    d.wrapper.tickGeneric(reqId, tickType, value)
  })

  // IN.TICK_STRING (46)
  decoder.registerText(IN.TICK_STRING, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const value = decodeStr(fields)
    d.wrapper.tickString(reqId, tickType, value)
  })

  // IN.TICK_EFP (47) — text only, no proto
  decoder.registerText(IN.TICK_EFP, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const basisPoints = decodeFloat(fields)
    const formattedBasisPoints = decodeStr(fields)
    const impliedFuturesPrice = decodeFloat(fields)
    const holdDays = decodeInt(fields)
    const futureLastTradeDate = decodeStr(fields)
    const dividendImpact = decodeFloat(fields)
    const dividendsToLastTradeDate = decodeFloat(fields)
    d.wrapper.tickEFP(
      reqId, tickType, basisPoints, formattedBasisPoints,
      impliedFuturesPrice, holdDays, futureLastTradeDate,
      dividendImpact, dividendsToLastTradeDate,
    )
  })

  // IN.TICK_SNAPSHOT_END (57)
  decoder.registerText(IN.TICK_SNAPSHOT_END, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    d.wrapper.tickSnapshotEnd(reqId)
  })

  // IN.MARKET_DATA_TYPE (58)
  decoder.registerText(IN.MARKET_DATA_TYPE, (d, fields) => {
    decodeInt(fields) // msgId (version)
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const marketDataType = decodeInt(fields)
    d.wrapper.marketDataType(reqId, marketDataType)
  })

  // IN.TICK_REQ_PARAMS (81)
  decoder.registerText(IN.TICK_REQ_PARAMS, (d, fields) => {
    decodeInt(fields) // msgId
    const tickerId = decodeInt(fields)
    const minTick = decodeFloat(fields)
    const bboExchange = decodeStr(fields)
    const snapshotPermissions = decodeInt(fields)
    d.wrapper.tickReqParams(tickerId, minTick, bboExchange, snapshotPermissions)
  })

  // IN.MARKET_DEPTH (12)
  decoder.registerText(IN.MARKET_DEPTH, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const position = decodeInt(fields)
    const operation = decodeInt(fields)
    const side = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields)

    d.wrapper.updateMktDepth(reqId, position, operation, side, price, size)
  })

  // IN.MARKET_DEPTH_L2 (13)
  decoder.registerText(IN.MARKET_DEPTH_L2, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const position = decodeInt(fields)
    const marketMaker = decodeStr(fields)
    const operation = decodeInt(fields)
    const side = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields)
    let isSmartDepth = false

    if (d.serverVersion >= MIN_SERVER_VER_SMART_DEPTH) {
      isSmartDepth = decodeBool(fields)
    }

    d.wrapper.updateMktDepthL2(
      reqId, position, marketMaker, operation, side, price, size, isSmartDepth,
    )
  })

  // IN.REROUTE_MKT_DATA_REQ (91)
  decoder.registerText(IN.REROUTE_MKT_DATA_REQ, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const conId = decodeInt(fields)
    const exchange = decodeStr(fields)
    d.wrapper.rerouteMktDataReq(reqId, conId, exchange)
  })

  // IN.REROUTE_MKT_DEPTH_REQ (92)
  decoder.registerText(IN.REROUTE_MKT_DEPTH_REQ, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const conId = decodeInt(fields)
    const exchange = decodeStr(fields)
    d.wrapper.rerouteMktDepthReq(reqId, conId, exchange)
  })

  // ----------------------------------------------------------------
  // Proto handlers
  // ----------------------------------------------------------------

  // IN.TICK_PRICE (1)
  decoder.registerProto(IN.TICK_PRICE, (d, buf) => {
    const proto = TickPriceProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const tickType = proto.tickType ?? UNSET_INTEGER
    const price = proto.price ?? UNSET_DOUBLE
    const size = proto.size !== undefined ? new Decimal(proto.size) : UNSET_DECIMAL
    const attrMask = proto.attrMask ?? UNSET_INTEGER

    const attrib = new TickAttrib()
    attrib.canAutoExecute = (attrMask & 1) !== 0
    attrib.pastLimit = (attrMask & 2) !== 0
    attrib.preOpen = (attrMask & 4) !== 0

    d.wrapper.tickPrice(reqId, tickType, price, attrib)

    let sizeTickType: number = TickTypeEnum.NOT_SET
    if (TickTypeEnum.BID === tickType) {
      sizeTickType = TickTypeEnum.BID_SIZE
    } else if (TickTypeEnum.ASK === tickType) {
      sizeTickType = TickTypeEnum.ASK_SIZE
    } else if (TickTypeEnum.LAST === tickType) {
      sizeTickType = TickTypeEnum.LAST_SIZE
    } else if (TickTypeEnum.DELAYED_BID === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_BID_SIZE
    } else if (TickTypeEnum.DELAYED_ASK === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_ASK_SIZE
    } else if (TickTypeEnum.DELAYED_LAST === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_LAST_SIZE
    }

    if (sizeTickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickSize(reqId, sizeTickType, size)
    }
  })

  // IN.TICK_SIZE (2)
  decoder.registerProto(IN.TICK_SIZE, (d, buf) => {
    const proto = TickSizeProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const tickType = proto.tickType ?? UNSET_INTEGER
    const size = proto.size !== undefined ? new Decimal(proto.size) : UNSET_DECIMAL

    if (tickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickSize(reqId, tickType, size)
    }
  })

  // IN.TICK_OPTION_COMPUTATION (21)
  decoder.registerProto(IN.TICK_OPTION_COMPUTATION, (d, buf) => {
    const proto = TickOptionComputationProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const tickType = proto.tickType ?? UNSET_INTEGER
    const tickAttrib = proto.tickAttrib ?? UNSET_INTEGER

    let impliedVol: number | null = proto.impliedVol ?? null
    if (impliedVol !== null && impliedVol < 0) impliedVol = null // -1 = not computed

    let delta: number | null = proto.delta ?? null
    if (delta !== null && delta === -2) delta = null // -2 = not computed

    let optPrice: number | null = proto.optPrice ?? null
    if (optPrice !== null && optPrice === -1) optPrice = null // -1 = not computed

    let pvDividend: number | null = proto.pvDividend ?? null
    if (pvDividend !== null && pvDividend === -1) pvDividend = null // -1 = not computed

    let gamma: number | null = proto.gamma ?? null
    if (gamma !== null && gamma === -2) gamma = null // -2 = not yet computed

    let vega: number | null = proto.vega ?? null
    if (vega !== null && vega === -2) vega = null // -2 = not yet computed

    let theta: number | null = proto.theta ?? null
    if (theta !== null && theta === -2) theta = null // -2 = not yet computed

    let undPrice: number | null = proto.undPrice ?? null
    if (undPrice !== null && undPrice === -1) undPrice = null // -1 = not computed

    d.wrapper.tickOptionComputation(
      reqId, tickType, tickAttrib,
      impliedVol, delta, optPrice, pvDividend,
      gamma, vega, theta, undPrice,
    )
  })

  // IN.TICK_GENERIC (45)
  decoder.registerProto(IN.TICK_GENERIC, (d, buf) => {
    const proto = TickGenericProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const tickType = proto.tickType ?? UNSET_INTEGER
    const value = proto.value ?? UNSET_DOUBLE

    if (tickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickGeneric(reqId, tickType, value)
    }
  })

  // IN.TICK_STRING (46)
  decoder.registerProto(IN.TICK_STRING, (d, buf) => {
    const proto = TickStringProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const tickType = proto.tickType ?? UNSET_INTEGER
    const value = proto.value ?? ''

    if (tickType !== TickTypeEnum.NOT_SET) {
      d.wrapper.tickString(reqId, tickType, value)
    }
  })

  // IN.TICK_SNAPSHOT_END (57)
  decoder.registerProto(IN.TICK_SNAPSHOT_END, (d, buf) => {
    const proto = TickSnapshotEndProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID

    d.wrapper.tickSnapshotEnd(reqId)
  })

  // IN.MARKET_DATA_TYPE (58)
  decoder.registerProto(IN.MARKET_DATA_TYPE, (d, buf) => {
    const proto = MarketDataTypeProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const marketDataType = proto.marketDataType ?? UNSET_INTEGER

    d.wrapper.marketDataType(reqId, marketDataType)
  })

  // IN.TICK_REQ_PARAMS (81)
  decoder.registerProto(IN.TICK_REQ_PARAMS, (d, buf) => {
    const proto = TickReqParamsProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID
    const minTick = proto.minTick !== undefined ? parseFloat(proto.minTick) : UNSET_DOUBLE
    const bboExchange = proto.bboExchange ?? ''
    const snapshotPermissions = proto.snapshotPermissions ?? UNSET_INTEGER

    d.wrapper.tickReqParams(reqId, minTick, bboExchange, snapshotPermissions)
  })

  // IN.MARKET_DEPTH (12)
  decoder.registerProto(IN.MARKET_DEPTH, (d, buf) => {
    const proto = MarketDepthProto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID

    // decode market depth fields
    if (proto.marketDepthData === undefined) return
    const data = proto.marketDepthData

    const position = data.position ?? UNSET_INTEGER
    const operation = data.operation ?? UNSET_INTEGER
    const side = data.side ?? UNSET_INTEGER
    const price = data.price ?? UNSET_DOUBLE
    const size = data.size !== undefined ? new Decimal(data.size) : UNSET_DECIMAL

    d.wrapper.updateMktDepth(reqId, position, operation, side, price, size)
  })

  // IN.MARKET_DEPTH_L2 (13)
  decoder.registerProto(IN.MARKET_DEPTH_L2, (d, buf) => {
    const proto = MarketDepthL2Proto.decode(buf)

    const reqId = proto.reqId ?? NO_VALID_ID

    // decode market depth fields
    if (proto.marketDepthData === undefined) return
    const data = proto.marketDepthData

    const position = data.position ?? 0
    const marketMaker = data.marketMaker ?? ''
    const operation = data.operation ?? UNSET_INTEGER
    const side = data.side ?? UNSET_INTEGER
    const price = data.price ?? UNSET_DOUBLE
    const size = data.size !== undefined ? new Decimal(data.size) : UNSET_DECIMAL
    const isSmartDepth = data.isSmartDepth ?? false

    d.wrapper.updateMktDepthL2(reqId, position, marketMaker, operation, side, price, size, isSmartDepth)
  })
}
