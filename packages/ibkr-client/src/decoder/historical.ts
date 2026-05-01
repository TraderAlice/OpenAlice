/**
 * Historical data decoder handlers — text + protobuf.
 *
 * Mirrors: ibapi/decoder.py (historical data, real-time bars, ticks, schedule)
 */

import Decimal from 'decimal.js'
import type { Decoder } from './base.js'
import { IN } from '@traderalice/ibkr-types'
import { NO_VALID_ID, UNSET_DECIMAL } from '@traderalice/ibkr-types'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
  decodeDecimal,
} from '../utils.js'
import {
  MIN_SERVER_VER_SYNT_REALTIME_BARS,
  MIN_SERVER_VER_HISTORICAL_DATA_END,
} from '@traderalice/ibkr-types'
import {
  BarData,
  RealTimeBar,
  HistogramData,
  HistoricalTick,
  HistoricalTickBidAsk,
  HistoricalTickLast,
  HistoricalSession,
  TickAttribBidAsk,
  TickAttribLast,
} from '@traderalice/ibkr-types'
// Protobuf message types
import { HistoricalData as HistoricalDataProto } from '../protobuf/HistoricalData.js'
import { HistoricalDataUpdate as HistoricalDataUpdateProto } from '../protobuf/HistoricalDataUpdate.js'
import { HistoricalDataEnd as HistoricalDataEndProto } from '../protobuf/HistoricalDataEnd.js'
import { RealTimeBarTick as RealTimeBarTickProto } from '../protobuf/RealTimeBarTick.js'
import { HeadTimestamp as HeadTimestampProto } from '../protobuf/HeadTimestamp.js'
import { HistogramData as HistogramDataProto } from '../protobuf/HistogramData.js'
import { HistoricalTicks as HistoricalTicksProto } from '../protobuf/HistoricalTicks.js'
import { HistoricalTicksBidAsk as HistoricalTicksBidAskProto } from '../protobuf/HistoricalTicksBidAsk.js'
import { HistoricalTicksLast as HistoricalTicksLastProto } from '../protobuf/HistoricalTicksLast.js'
import { TickByTickData as TickByTickDataProto } from '../protobuf/TickByTickData.js'
import { HistoricalSchedule as HistoricalScheduleProto } from '../protobuf/HistoricalSchedule.js'
import type { HistoricalDataBar } from '../protobuf/HistoricalDataBar.js'
import type { HistogramDataEntry } from '../protobuf/HistogramDataEntry.js'
import type { HistoricalTick as HistoricalTickProto } from '../protobuf/HistoricalTick.js'
import type { HistoricalTickBidAsk as HistoricalTickBidAskProtoMsg } from '../protobuf/HistoricalTickBidAsk.js'
import type { HistoricalTickLast as HistoricalTickLastProtoMsg } from '../protobuf/HistoricalTickLast.js'

// ----------------------------------------------------------------
// Proto → domain helpers
// ----------------------------------------------------------------

function decodeHistoricalDataBar(proto: HistoricalDataBar): BarData {
  const bar = new BarData()
  if (proto.date !== undefined) bar.date = proto.date
  if (proto.open !== undefined) bar.open = proto.open
  if (proto.high !== undefined) bar.high = proto.high
  if (proto.low !== undefined) bar.low = proto.low
  if (proto.close !== undefined) bar.close = proto.close
  if (proto.volume !== undefined) bar.volume = new Decimal(proto.volume)
  if (proto.WAP !== undefined) bar.wap = new Decimal(proto.WAP)
  if (proto.barCount !== undefined) bar.barCount = proto.barCount
  return bar
}

function decodeHistogramDataEntry(proto: HistogramDataEntry): HistogramData {
  const hd = new HistogramData()
  if (proto.price !== undefined) hd.price = proto.price
  if (proto.size !== undefined) hd.size = new Decimal(proto.size)
  return hd
}

function decodeHistoricalTickProto(proto: HistoricalTickProto): HistoricalTick {
  const tick = new HistoricalTick()
  if (proto.time !== undefined) tick.time = proto.time
  if (proto.price !== undefined) tick.price = proto.price
  if (proto.size !== undefined) tick.size = new Decimal(proto.size)
  return tick
}

function decodeHistoricalTickBidAskProto(proto: HistoricalTickBidAskProtoMsg): HistoricalTickBidAsk {
  const tick = new HistoricalTickBidAsk()
  if (proto.time !== undefined) tick.time = proto.time

  const attr = new TickAttribBidAsk()
  if (proto.tickAttribBidAsk !== undefined) {
    if (proto.tickAttribBidAsk.bidPastLow !== undefined) attr.bidPastLow = proto.tickAttribBidAsk.bidPastLow
    if (proto.tickAttribBidAsk.askPastHigh !== undefined) attr.askPastHigh = proto.tickAttribBidAsk.askPastHigh
  }
  tick.tickAttribBidAsk = attr

  if (proto.priceBid !== undefined) tick.priceBid = proto.priceBid
  if (proto.priceAsk !== undefined) tick.priceAsk = proto.priceAsk
  if (proto.sizeBid !== undefined) tick.sizeBid = new Decimal(proto.sizeBid)
  if (proto.sizeAsk !== undefined) tick.sizeAsk = new Decimal(proto.sizeAsk)
  return tick
}

function decodeHistoricalTickLastProto(proto: HistoricalTickLastProtoMsg): HistoricalTickLast {
  const tick = new HistoricalTickLast()
  if (proto.time !== undefined) tick.time = proto.time

  const attr = new TickAttribLast()
  if (proto.tickAttribLast !== undefined) {
    if (proto.tickAttribLast.pastLimit !== undefined) attr.pastLimit = proto.tickAttribLast.pastLimit
    if (proto.tickAttribLast.unreported !== undefined) attr.unreported = proto.tickAttribLast.unreported
  }
  tick.tickAttribLast = attr

  if (proto.price !== undefined) tick.price = proto.price
  if (proto.size !== undefined) tick.size = new Decimal(proto.size)
  if (proto.exchange !== undefined) tick.exchange = proto.exchange
  if (proto.specialConditions !== undefined) tick.specialConditions = proto.specialConditions
  return tick
}

// ----------------------------------------------------------------
// Text handlers
// ----------------------------------------------------------------

function processHistoricalDataMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  if (d.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS) {
    decodeInt(fields) // version
  }

  const reqId = decodeInt(fields)

  let startDateStr = ''
  let endDateStr = ''
  if (d.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END) {
    startDateStr = decodeStr(fields) // ver 2
    endDateStr = decodeStr(fields) // ver 2
  }

  const itemCount = decodeInt(fields)

  for (let i = 0; i < itemCount; i++) {
    const bar = new BarData()
    bar.date = decodeStr(fields)
    bar.open = decodeFloat(fields)
    bar.high = decodeFloat(fields)
    bar.low = decodeFloat(fields)
    bar.close = decodeFloat(fields)
    bar.volume = decodeDecimal(fields)
    bar.wap = decodeDecimal(fields)

    if (d.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS) {
      decodeStr(fields) // hasGaps
    }

    bar.barCount = decodeInt(fields) // ver 3

    d.wrapper.historicalData(reqId, bar)
  }

  if (d.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END) {
    d.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)
  }
}

function processHistoricalDataEndMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const startDateStr = decodeStr(fields)
  const endDateStr = decodeStr(fields)

  d.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)
}

function processHistoricalDataUpdateMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const bar = new BarData()
  bar.barCount = decodeInt(fields)
  bar.date = decodeStr(fields)
  bar.open = decodeFloat(fields)
  bar.close = decodeFloat(fields)
  bar.high = decodeFloat(fields)
  bar.low = decodeFloat(fields)
  bar.wap = decodeDecimal(fields)
  bar.volume = decodeDecimal(fields)
  d.wrapper.historicalDataUpdate(reqId, bar)
}

function processRealTimeBarMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  decodeInt(fields) // version
  const reqId = decodeInt(fields)

  const bar = new RealTimeBar()
  bar.time = decodeInt(fields)
  bar.open_ = decodeFloat(fields)
  bar.high = decodeFloat(fields)
  bar.low = decodeFloat(fields)
  bar.close = decodeFloat(fields)
  bar.volume = decodeDecimal(fields)
  bar.wap = decodeDecimal(fields)
  bar.count = decodeInt(fields)

  d.wrapper.realtimeBar(
    reqId, bar.time, bar.open_, bar.high, bar.low, bar.close,
    bar.volume, bar.wap, bar.count,
  )
}

function processHeadTimestamp(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const headTimestamp = decodeStr(fields)
  d.wrapper.headTimestamp(reqId, headTimestamp)
}

function processHistogramData(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const numPoints = decodeInt(fields)

  const histogram: HistogramData[] = []
  for (let i = 0; i < numPoints; i++) {
    const dataPoint = new HistogramData()
    dataPoint.price = decodeFloat(fields)
    dataPoint.size = decodeDecimal(fields)
    histogram.push(dataPoint)
  }

  d.wrapper.histogramData(reqId, histogram)
}

function processHistoricalTicks(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const tickCount = decodeInt(fields)

  const ticks: HistoricalTick[] = []

  for (let i = 0; i < tickCount; i++) {
    const historicalTick = new HistoricalTick()
    historicalTick.time = decodeInt(fields)
    fields.next() // skip for consistency
    historicalTick.price = decodeFloat(fields)
    historicalTick.size = decodeDecimal(fields)
    ticks.push(historicalTick)
  }

  const done = decodeBool(fields)

  d.wrapper.historicalTicks(reqId, ticks, done)
}

function processHistoricalTicksBidAsk(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const tickCount = decodeInt(fields)

  const ticks: HistoricalTickBidAsk[] = []

  for (let i = 0; i < tickCount; i++) {
    const historicalTickBidAsk = new HistoricalTickBidAsk()
    historicalTickBidAsk.time = decodeInt(fields)
    const mask = decodeInt(fields)
    const tickAttribBidAsk = new TickAttribBidAsk()
    tickAttribBidAsk.askPastHigh = (mask & 1) !== 0
    tickAttribBidAsk.bidPastLow = (mask & 2) !== 0
    historicalTickBidAsk.tickAttribBidAsk = tickAttribBidAsk
    historicalTickBidAsk.priceBid = decodeFloat(fields)
    historicalTickBidAsk.priceAsk = decodeFloat(fields)
    historicalTickBidAsk.sizeBid = decodeDecimal(fields)
    historicalTickBidAsk.sizeAsk = decodeDecimal(fields)
    ticks.push(historicalTickBidAsk)
  }

  const done = decodeBool(fields)

  d.wrapper.historicalTicksBidAsk(reqId, ticks, done)
}

function processHistoricalTicksLast(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const tickCount = decodeInt(fields)

  const ticks: HistoricalTickLast[] = []

  for (let i = 0; i < tickCount; i++) {
    const historicalTickLast = new HistoricalTickLast()
    historicalTickLast.time = decodeInt(fields)
    const mask = decodeInt(fields)
    const tickAttribLast = new TickAttribLast()
    tickAttribLast.pastLimit = (mask & 1) !== 0
    tickAttribLast.unreported = (mask & 2) !== 0
    historicalTickLast.tickAttribLast = tickAttribLast
    historicalTickLast.price = decodeFloat(fields)
    historicalTickLast.size = decodeDecimal(fields)
    historicalTickLast.exchange = decodeStr(fields)
    historicalTickLast.specialConditions = decodeStr(fields)
    ticks.push(historicalTickLast)
  }

  const done = decodeBool(fields)

  d.wrapper.historicalTicksLast(reqId, ticks, done)
}

function processTickByTickMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const tickType = decodeInt(fields)
  const time = decodeInt(fields)

  if (tickType === 0) {
    // None
  } else if (tickType === 1 || tickType === 2) {
    // Last or AllLast
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields)
    const mask = decodeInt(fields)

    const tickAttribLast = new TickAttribLast()
    tickAttribLast.pastLimit = (mask & 1) !== 0
    tickAttribLast.unreported = (mask & 2) !== 0
    const exchange = decodeStr(fields)
    const specialConditions = decodeStr(fields)

    d.wrapper.tickByTickAllLast(
      reqId, tickType, time, price, size,
      tickAttribLast, exchange, specialConditions,
    )
  } else if (tickType === 3) {
    // BidAsk
    const bidPrice = decodeFloat(fields)
    const askPrice = decodeFloat(fields)
    const bidSize = decodeDecimal(fields)
    const askSize = decodeDecimal(fields)
    const mask = decodeInt(fields)
    const tickAttribBidAsk = new TickAttribBidAsk()
    tickAttribBidAsk.bidPastLow = (mask & 1) !== 0
    tickAttribBidAsk.askPastHigh = (mask & 2) !== 0

    d.wrapper.tickByTickBidAsk(
      reqId, time, bidPrice, askPrice, bidSize, askSize, tickAttribBidAsk,
    )
  } else if (tickType === 4) {
    // MidPoint
    const midPoint = decodeFloat(fields)
    d.wrapper.tickByTickMidPoint(reqId, time, midPoint)
  }
}

function processHistoricalSchedule(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const startDateTime = decodeStr(fields)
  const endDateTime = decodeStr(fields)
  const timeZone = decodeStr(fields)
  const sessionsCount = decodeInt(fields)

  const sessions: HistoricalSession[] = []

  for (let i = 0; i < sessionsCount; i++) {
    const historicalSession = new HistoricalSession()
    historicalSession.startDateTime = decodeStr(fields)
    historicalSession.endDateTime = decodeStr(fields)
    historicalSession.refDate = decodeStr(fields)
    sessions.push(historicalSession)
  }

  d.wrapper.historicalSchedule(reqId, startDateTime, endDateTime, timeZone, sessions)
}

// ----------------------------------------------------------------
// Protobuf handlers
// ----------------------------------------------------------------

function processHistoricalDataMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalDataProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  if (!proto.historicalDataBars || proto.historicalDataBars.length === 0) return

  for (const barProto of proto.historicalDataBars) {
    const bar = decodeHistoricalDataBar(barProto)
    d.wrapper.historicalData(reqId, bar)
  }
}

function processHistoricalDataEndMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalDataEndProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const startDateStr = proto.startDateStr ?? ''
  const endDateStr = proto.endDateStr ?? ''

  d.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)
}

function processHistoricalDataUpdateMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalDataUpdateProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  if (proto.historicalDataBar === undefined) return

  const bar = decodeHistoricalDataBar(proto.historicalDataBar)
  d.wrapper.historicalDataUpdate(reqId, bar)
}

function processRealTimeBarMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = RealTimeBarTickProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const time = proto.time ?? 0
  const open_ = proto.open ?? 0.0
  const high = proto.high ?? 0.0
  const low = proto.low ?? 0.0
  const close = proto.close ?? 0.0
  const volume = proto.volume !== undefined ? new Decimal(proto.volume) : UNSET_DECIMAL
  const wap = proto.WAP !== undefined ? new Decimal(proto.WAP) : UNSET_DECIMAL
  const count = proto.count ?? 0

  d.wrapper.realtimeBar(reqId, time, open_, high, low, close, volume, wap, count)
}

function processHeadTimestampMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HeadTimestampProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const headTimestamp = proto.headTimestamp ?? ''

  d.wrapper.headTimestamp(reqId, headTimestamp)
}

function processHistogramDataMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistogramDataProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  const histogram: HistogramData[] = []
  if (proto.histogramDataEntries) {
    for (const entry of proto.histogramDataEntries) {
      histogram.push(decodeHistogramDataEntry(entry))
    }
  }

  d.wrapper.histogramData(reqId, histogram)
}

function processHistoricalTicksMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalTicksProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const isDone = proto.isDone ?? false

  const ticks: HistoricalTick[] = []
  if (proto.historicalTicks) {
    for (const tickProto of proto.historicalTicks) {
      ticks.push(decodeHistoricalTickProto(tickProto))
    }
  }

  d.wrapper.historicalTicks(reqId, ticks, isDone)
}

function processHistoricalTicksBidAskMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalTicksBidAskProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const isDone = proto.isDone ?? false

  const ticks: HistoricalTickBidAsk[] = []
  if (proto.historicalTicksBidAsk) {
    for (const tickProto of proto.historicalTicksBidAsk) {
      ticks.push(decodeHistoricalTickBidAskProto(tickProto))
    }
  }

  d.wrapper.historicalTicksBidAsk(reqId, ticks, isDone)
}

function processHistoricalTicksLastMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalTicksLastProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const isDone = proto.isDone ?? false

  const ticks: HistoricalTickLast[] = []
  if (proto.historicalTicksLast) {
    for (const tickProto of proto.historicalTicksLast) {
      ticks.push(decodeHistoricalTickLastProto(tickProto))
    }
  }

  d.wrapper.historicalTicksLast(reqId, ticks, isDone)
}

function processTickByTickMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = TickByTickDataProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const tickType = proto.tickType ?? 0

  if (tickType === 0) {
    // None
  } else if (tickType === 1 || tickType === 2) {
    // Last or AllLast
    if (proto.historicalTickLast !== undefined) {
      const tick = decodeHistoricalTickLastProto(proto.historicalTickLast)
      d.wrapper.tickByTickAllLast(
        reqId, tickType, tick.time, tick.price, tick.size,
        tick.tickAttribLast, tick.exchange, tick.specialConditions,
      )
    }
  } else if (tickType === 3) {
    // BidAsk
    if (proto.historicalTickBidAsk !== undefined) {
      const tick = decodeHistoricalTickBidAskProto(proto.historicalTickBidAsk)
      d.wrapper.tickByTickBidAsk(
        reqId, tick.time, tick.priceBid, tick.priceAsk,
        tick.sizeBid, tick.sizeAsk, tick.tickAttribBidAsk,
      )
    }
  } else if (tickType === 4) {
    // MidPoint
    if (proto.historicalTickMidPoint !== undefined) {
      const tick = decodeHistoricalTickProto(proto.historicalTickMidPoint)
      d.wrapper.tickByTickMidPoint(reqId, tick.time, tick.price)
    }
  }
}

function processHistoricalScheduleMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = HistoricalScheduleProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID
  const startDateTime = proto.startDateTime ?? ''
  const endDateTime = proto.endDateTime ?? ''
  const timeZone = proto.timeZone ?? ''

  const sessions: HistoricalSession[] = []
  if (proto.historicalSessions) {
    for (const sessionProto of proto.historicalSessions) {
      const session = new HistoricalSession()
      session.startDateTime = sessionProto.startDateTime ?? ''
      session.endDateTime = sessionProto.endDateTime ?? ''
      session.refDate = sessionProto.refDate ?? ''
      sessions.push(session)
    }
  }

  d.wrapper.historicalSchedule(reqId, startDateTime, endDateTime, timeZone, sessions)
}

// ----------------------------------------------------------------
// Registration
// ----------------------------------------------------------------

export function applyHistoricalHandlers(decoder: Decoder): void {
  // Text handlers
  decoder.registerText(IN.HISTORICAL_DATA, processHistoricalDataMsg)
  decoder.registerText(IN.HISTORICAL_DATA_UPDATE, processHistoricalDataUpdateMsg)
  decoder.registerText(IN.HISTORICAL_DATA_END, processHistoricalDataEndMsg)
  decoder.registerText(IN.REAL_TIME_BARS, processRealTimeBarMsg)
  decoder.registerText(IN.HEAD_TIMESTAMP, processHeadTimestamp)
  decoder.registerText(IN.HISTOGRAM_DATA, processHistogramData)
  decoder.registerText(IN.HISTORICAL_TICKS, processHistoricalTicks)
  decoder.registerText(IN.HISTORICAL_TICKS_BID_ASK, processHistoricalTicksBidAsk)
  decoder.registerText(IN.HISTORICAL_TICKS_LAST, processHistoricalTicksLast)
  decoder.registerText(IN.TICK_BY_TICK, processTickByTickMsg)
  decoder.registerText(IN.HISTORICAL_SCHEDULE, processHistoricalSchedule)

  // Protobuf handlers
  decoder.registerProto(IN.HISTORICAL_DATA, processHistoricalDataMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_DATA_UPDATE, processHistoricalDataUpdateMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_DATA_END, processHistoricalDataEndMsgProtoBuf)
  decoder.registerProto(IN.REAL_TIME_BARS, processRealTimeBarMsgProtoBuf)
  decoder.registerProto(IN.HEAD_TIMESTAMP, processHeadTimestampMsgProtoBuf)
  decoder.registerProto(IN.HISTOGRAM_DATA, processHistogramDataMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_TICKS, processHistoricalTicksMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_TICKS_BID_ASK, processHistoricalTicksBidAskMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_TICKS_LAST, processHistoricalTicksLastMsgProtoBuf)
  decoder.registerProto(IN.TICK_BY_TICK, processTickByTickMsgProtoBuf)
  decoder.registerProto(IN.HISTORICAL_SCHEDULE, processHistoricalScheduleMsgProtoBuf)
}
